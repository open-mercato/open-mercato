# Compilation And Route Warmup Speedup (30–50%)

## TLDR

**Key Points:**
- The April 2, 2026 cold-start work (`.ai/specs/implemented/2026-04-02-dev-structural-regeneration-and-cold-start-optimization.md`) already solved the worst architectural offenders: lazy route manifests, partitioned bootstrap, generator watch, and a background warmup. Two further May 28, 2026 develop commits hardened the dev-cache path on top of it: `4100aa7fb` (dev-watch structural restart; extracted `calculateGenerateWatchStructureChecksum` into `packages/cli/src/lib/generate-watch-structure.ts`) and `502719d15` (greenfield warmup cache handling, issue #1950). This spec targets the **next 30–50%** on top of all of that, in two independent workstreams, without duplicating it.
- **Workstream A — build/generate compilation pipeline.** `yarn build` runs `build:packages` **twice** (`package.json:30`), `yarn generate` runs 8 generators **strictly sequentially** with `cache: false` (`runGeneratorSuite`, `packages/cli/src/mercato.ts:689-710`; `turbo.json:43-45`), and there are **no tsc project references / shared incremental graph** so cross-package typecheck/compile never skips unchanged work. These are the dominant repeatable-compile costs for `build`, `generate`, and `typecheck`.
- **Workstream B — dev Turbopack cache (warmup left intentionally narrow).** Per maintainer direction, the dev warmup stays exactly the **three** requests it warms today — `GET /login`, `POST /api/auth/login`, `GET /backend` — issued **sequentially** by `runTargetedRouteWarmup` (`apps/mercato/scripts/dev.mjs:845`). This spec does **not** broaden the default warmup set. `instrumentation.ts` is a no-op (`apps/mercato/src/instrumentation.ts`). Develop already preserves the Turbopack compiler cache during greenfield cleanup and between warmup requests (`502719d15`, `scripts/dev-cache-purge.mjs`); the **remaining** Workstream B gap is that a no-op `yarn generate` on a dev restart still runs an unconditional structural cache purge (`runPostGenerateStructuralCachePurge`, `packages/cli/src/mercato.ts:644`) that bumps every `.generated.ts` mtime and discards an otherwise-reusable Turbopack cache.
- The fix is additive and flag-gated: parallelize the generator suite, content-gate generated writes so unchanged output preserves the Turbopack cache, add a checksum skip for no-op `generate` (reusing the develop `generate-watch-structure` checksum), collapse the redundant second `build:packages` pass via stable cache inputs, keep the warmup set unchanged while making the no-op-restart cache reusable, and tune the Turbopack/Next dev levers. Each lands behind a flag and is validated with the existing `yarn dev:profile` harness plus a documented cold-compile procedure.

**Scope:**
- Speed up `yarn build`, `yarn generate`, and `yarn typecheck` repeatable-compile time by 30–50% without changing generated-file contracts.
- Preserve the Turbopack filesystem cache across dev restarts when module sources are unchanged, by making a no-op `yarn generate` stop invalidating it.
- Keep the dev warmup set unchanged (the existing three requests); do **not** broaden the default warmup.
- Keep monorepo and standalone (`create-app`) behavior aligned.

**Concerns:**
- Generated-file contracts (`modules.generated.ts`, route manifests, entity-id maps) are FROZEN/STABLE — changes must be additive and byte-identical where consumers depend on shape.
- Parallel generators must preserve output determinism and the existing run order's data dependencies (entity IDs feed the registry).
- The no-op-generate cache fix must not mask a needed regeneration; it reuses the already-trusted develop structural checksum, and any real structural change must still invalidate the cache.
- tsc project references are a larger, higher-risk change (touches every package `tsconfig`) and are deliberately phased last and behind verification.

## Assumptions

This spec was authored autonomously from static source analysis; the following scope assumptions are recorded so a reviewer can correct them before implementation:

1. **"Compilation"** means the repeatable build/generate/typecheck pipeline (`yarn build`, `yarn generate`, `yarn typecheck`, `yarn build:app`) **and** dev-mode Turbopack route compilation — not a one-time `yarn install`.
2. **"Route warmup"** means the dev-runner background pre-compilation flow in `apps/mercato/scripts/dev.mjs`, not production prerendering.
3. The 30–50% target is measured against the **April 2, 2026 baselines** restated below and re-measured on `develop` before merge using the existing harness. No new measured numbers are claimed in this draft; the "Measured" columns are gated on implementation.
4. Backward compatibility outweighs raw speed: every lever ships additively and flag-gated, defaulting to current behavior until a profiling gate proves the win.

## Overview

Open Mercato's module system trades flexibility for a large generated registry and a broad module graph. The April 2, 2026 spec attacked the first-request architectural bottleneck and won big (API cold `15.0s → 1.86s`; backend cold `19.4s → 3.9s` *with* warmup), and two May 28, 2026 develop commits (`4100aa7fb`, `502719d15`) further hardened dev-watch restarts and the greenfield cache path. But two cost centers remain only partially addressed:

1. The **build/generate/typecheck pipeline** still does redundant and fully-sequential work on every invocation. This is what a developer pays on `yarn build`, what CI pays per affected package, and what `yarn generate` costs on every structural change.
2. The **dev Turbopack cache** is still invalidated by a no-op `yarn generate`. The warmup itself is deliberately narrow — it warms the login path and the `/backend` shell, and **this spec keeps it that way** (per maintainer direction); the heavy catch-all entrypoints the April trace flagged (`/api/[...slug]` at `~15s`, backend CRUD list pages at `~19.4s`) stay cold-on-first-hit by design, trading a one-time first-navigation cost for bounded idle RSS. Develop's `502719d15` already stopped greenfield cleanup and between-warmup-request handling from discarding the Turbopack compiler cache; what is still missing is preventing a no-op `yarn generate` on restart from bumping every `.generated.ts` mtime and throwing the cache away.

### Restated April 2, 2026 baselines (reference)

| Measurement | Result |
|-------------|--------|
| `yarn generate` | `5.52s` real, `~528 MB` max RSS |
| `yarn build:packages` (single pass) | `4.78s` real |
| `apps/mercato` dev ready time | `982ms` |
| Cold `GET /api/customers/people` (warmup off) | `1.86s` (post-April-work) |
| Cold `GET /backend/customers/people` (warmup off) | `14.4s` (post-April-work) |
| Cold `GET /login` (warmup off) | `8.1s` (post-April-work) |
| Cold `GET /backend/customers/people` (after warmup) | `3.9s` |
| Cold `GET /login` (after warmup) | `2.0s` |

> The warmup-off cold times (`/login` `8.1s`, `/backend/...` `14.4s`) are informational: warmup already compiles `/login` and `/backend` (two of the three warmed requests), so a developer rarely pays them. Workstream A attacks the build/generate numbers; Workstream B keeps those already-warm surfaces cache-warm across no-op dev restarts rather than recompiling them.

> **Reference Material**:
> - Next.js memory & dev guidance: <https://nextjs.org/docs/app/guides/memory-usage>
> - Turbopack filesystem cache: <https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache>
> - Turborepo caching & inputs: <https://turbo.build/repo/docs/crafting-your-repository/caching>
> - TypeScript project references: <https://www.typescriptlang.org/docs/handbook/project-references.html>
> - Develop cache-handling commits this spec builds on: `4100aa7fb` (dev-watch structural restart + `generate-watch-structure.ts`), `502719d15` (greenfield warmup cache handling, issue #1950).

## Problem Statement

### A. Build/generate/typecheck does redundant and serial work

1. **Double package build.** `yarn build` is `yarn build:packages && yarn generate && yarn build:packages && yarn build:app` (`package.json:30`). The second `build:packages` exists because generators write into package `generated/` trees that are declared `build` inputs (`turbo.json:9` — `inputs: ["$TURBO_DEFAULT$", "generated/**"]`). Today that second pass rebuilds packages whose generated inputs are byte-unchanged because generator output is not content-stable, so Turbo treats it as a cache miss.
2. **Strictly sequential generators.** `runGeneratorSuite` awaits 8 generators one-by-one (`packages/cli/src/mercato.ts:689-710`): entity IDs → module registry → app registry → CLI registry → entities → DI → package sources → OpenAPI. Several have no data dependency on each other and could run concurrently. The Turbo `generate` task is `cache: false` (`turbo.json:44`), so the full suite re-runs even when no module source changed. The develop in-process watcher already skips regeneration when nothing structural changed (via `calculateGenerateWatchStructureChecksum` in `packages/cli/src/lib/generate-watch-structure.ts`), but the one-shot `mercato generate all` command has no equivalent skip.
3. **No incremental cross-package compilation.** Packages compile via esbuild with `bundle: false` (`scripts/build-package.mjs`) and typecheck via per-package `tsc --noEmit` (`turbo.json:32-35`) with **no `composite` / `references` / shared `tsBuildInfoFile`**. Turbo caches whole-task outputs, but a single edit in a shared package (e.g. `@open-mercato/shared`) forces a from-scratch typecheck of every dependent package rather than an incremental delta.

### B. The Turbopack cache is invalidated by a no-op generate (warmup stays narrow by design)

1. **Warmup covers 3 surfaces, sequentially — intentionally.** `runTargetedRouteWarmup` (`apps/mercato/scripts/dev.mjs:845`) issues `GET /login` → `POST /api/auth/login` → `GET /backend`, each awaiting the previous (the login + auth steps must precede the authenticated `/backend` hit). It does not warm the `/api/[...slug]` catch-all, a backend CRUD **list page**, or the frontend storefront catch-all, and `instrumentation.ts` is a no-op (`apps/mercato/src/instrumentation.ts`). **This is a deliberate trade**: the heavy catch-alls stay cold on first navigation in exchange for bounded idle RSS (the April warmup already adds `~460 MB`). This spec does not change the warmup set.
2. **Turbopack filesystem cache is un-tuned and self-invalidated on a no-op generate.** `next.config.ts` sets `serverMinification: false`, `turbopackMinify: false`, `optimizePackageImports: ['lucide-react','recharts','date-fns']`, and dev `preloadEntriesOnStart: false` (`next.config.ts:23-40`) — but no explicit `turbopackFileSystemCache`. Develop's `502719d15` (issue #1950) fixed the worst cache-eviction cases: greenfield cleanup now removes only stale route/middleware manifests + locks while preserving `.mercato/next/dev/cache/turbopack` (`scripts/dev-cache-purge.mjs` `GREENFIELD_PURGE_TARGETS`), and warmup no longer purges the cache between requests. **The remaining gap**: a one-shot `yarn generate` still ends with an unconditional `runPostGenerateStructuralCachePurge` (`packages/cli/src/mercato.ts:644`, invoked at `:1664-1665`) that runs `configs cache structural` and bumps every `.generated.ts` mtime (documented in root `AGENTS.md`), so a no-op `yarn generate` on dev restart still throws away an otherwise-reusable compile cache. `dev:reset` (and the one-shot corrupted-cache recovery at `dev.mjs:1698`) remain the explicit hard resets that clear `.mercato/next/dev`.

## Proposed Solution

Two independent workstreams, each landing additively behind flags.

### Workstream A: Pipeline compilation speedups

| Lever | Change | Where |
|-------|--------|-------|
| A1 — Parallel generator suite | Group independent generators into bounded `Promise.all` stages, preserving the entity-IDs→registry data dependency. | `runGeneratorSuite`, `packages/cli/src/mercato.ts:689-710` |
| A2 — Content-stable generated writes | Write generated files only when output bytes change; never `touch` unchanged files. Make the post-generate structural purge conditional on a real change. Makes Turbo `build` inputs stable and preserves the Turbopack cache. | generators under `packages/cli/src/lib/generators/*`; `runPostGenerateStructuralCachePurge` (`packages/cli/src/mercato.ts:644`) |
| A3 — No-op generate skip | Checksum module sources; skip the whole suite when nothing structural changed, reusing the develop watcher's `calculateGenerateWatchStructureChecksum`. | `packages/cli/src/mercato.ts`, `packages/cli/src/lib/generate-watch-structure.ts` |
| A4 — Collapse the second `build:packages` | With A2 making generated output byte-stable, the second pass becomes Turbo cache hits for unchanged packages. Verify and, if proven, document/optionally fold generation into a single ordered Turbo graph. | `package.json:30`, `turbo.json` |
| A5 — Incremental tsc (phased, opt-in) | Introduce `composite: true` + `references` + persistent `tsBuildInfoFile` so `typecheck`/declaration builds skip unchanged packages incrementally. | package `tsconfig*.json`, root references |

### Workstream B: Dev Turbopack cache (warmup set unchanged)

The default warmup stays exactly the three requests it warms today; this spec does not broaden it. Workstream B is about keeping the Turbopack compiler cache reusable across no-op dev restarts and an optional, opt-out-by-default lever sweep.

| Lever | Change | Where |
|-------|--------|-------|
| B1 — Persist Turbopack cache across no-op restarts | Pair with A2/A3: a no-op `yarn generate` on restart must not bump `.generated.ts` mtimes (no unconditional structural purge), so `.mercato/next/dev/cache/turbopack` survives and the first post-restart hit is a cache hit. Builds on develop's `502719d15` (greenfield purge already preserves the cache). Optionally set `turbopackFileSystemCache` explicitly. | `runPostGenerateStructuralCachePurge` (`packages/cli/src/mercato.ts:644`), `next.config.ts` |
| B2 — Optional warmup route override (opt-in) | `OM_DEV_WARMUP_ROUTES` (comma-separated) lets a team append their own hot paths after auth. **Default unset → the existing three requests only.** No broadening of defaults. | `apps/mercato/scripts/dev.mjs` |
| B3 — Dev lever sweep | Benchmark `preloadEntriesOnStart`, expand `optimizePackageImports` to additional barrel-heavy deps, and confirm `serverComponentsHmrCache` defaults — keep only levers that profile positively. | `apps/mercato/next.config.ts:23-40` |

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Two independent workstreams, separately shippable | Pipeline and dev Turbopack-cache wins are orthogonal; bundling them would slow review and muddy attribution. |
| Everything additive + flag-gated, defaulting to current behavior | Build/generate is a contract-adjacent hot path; a regression here blocks every developer and CI run. Flags let us gate on a profiling result. |
| Reuse the existing checksum + profiling infrastructure | The develop in-process generate watcher already computes a structural checksum (`calculateGenerateWatchStructureChecksum`, `packages/cli/src/lib/generate-watch-structure.ts`); `scripts/profile-dev-rss.mjs` / `yarn dev:profile` already samples the process tree. Build on them, don't reinvent. |
| Keep the default warmup to the existing **three** requests (login page, auth POST, `/backend`) | Per maintainer direction. Broadening warmup raises idle RSS for every dev session (the April warmup already adds `~460 MB`) to avoid a one-time first-navigation compile of the heavy catch-alls — not a worthwhile default. Teams that want more opt in via `OM_DEV_WARMUP_ROUTES`. |
| Phase tsc project references last | It edits every package `tsconfig`, risks declaration-emit/`isolatedModules` fallout, and is the least certain win — it must follow a clean profiling baseline. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Enable `turbopackMinify` / `serverMinification` | These are deliberately **off** in dev to speed compilation (`next.config.ts:25-26`); enabling them slows the very path we want faster. |
| Replace esbuild with `tsc` build for packages | esbuild is already the fast path; the bottleneck is redundancy and serialization, not the per-file compiler. |
| Drop the second `build:packages` outright | Unsafe until A2 proves generated output is byte-stable; otherwise packages consuming fresh generated inputs would compile against stale `dist/`. |
| Broaden the default warmup to the heavy catch-all routes | Raises idle RSS for every dev session to avoid a one-time first-navigation compile; the heavy catch-alls are paid once, not per session. Out of scope per maintainer direction — warmup stays the existing three requests; teams opt into more via `OM_DEV_WARMUP_ROUTES`. |
| HTTP-warm every backend page | Reintroduces eager-graph breadth and huge idle RSS; defeats the April lazy-manifest design. |
| Rebuild the dev server on every structural change | Already rejected by the April spec; generator watch + cache preservation is the correct model. |

## Architecture

### Profiling Methodology (reused, not invented)

Workstream B memory/latency is validated with the existing harness:

```bash
# Dev-mode process-tree RSS sampling (existing)
yarn dev:profile baseline        # spawn dev, sample 90s, write .mercato/dev-rss/baseline.json
yarn dev:profile after-change
yarn dev:profile:report          # markdown delta table
```

Cold-compile latency reuses the April 2 procedure:

```bash
rm -rf apps/mercato/.mercato/next       # cold cache
cd apps/mercato && NEXT_CPU_PROF=1 yarn dev
# with OM_DEV_WARMUP disabled, time the first hit per surface:
curl -s -o /dev/null -w '%{time_total}\n' http://localhost:3000/login
curl -s -o /dev/null -w '%{time_total}\n' 'http://localhost:3000/api/customers/people?page=1&pageSize=20'
curl -s -o /dev/null -w '%{time_total}\n' http://localhost:3000/backend/customers/people
# primary evidence artifact:
#   apps/mercato/.mercato/next/dev/trace  (compile-path / ensure-page events)
```

Pipeline latency (Workstream A) is timed with wall-clock around `yarn generate`, `yarn build`, and `yarn typecheck` on (a) a clean tree and (b) a single-shared-package edit, comparing flag-off vs flag-on.

### A1 — Parallel generator suite

Current (`runGeneratorSuite`, `packages/cli/src/mercato.ts:689-710`) is a serial `await` chain. Reshape into dependency-ordered stages:

```
Stage 0 (must be first):  generateEntityIds            // entity-id map feeds the registry
Stage 1 (parallel):       generateModuleRegistry
                          generateModuleEntities
                          generateModuleDi
Stage 2 (parallel):       generateModuleRegistryApp     // depend on Stage 1 registry output
                          generateModuleRegistryCli
                          generateModulePackageSources
Stage 3:                  generateOpenApi               // depends on route manifests
```

Concurrency is bounded (e.g. `min(stage.length, os.cpus().length)`) and each generator keeps writing through temp-file + atomic rename. Determinism is enforced by stable iteration order over the resolver's module list (no reliance on `Promise.all` completion order for output content).

### A2 — Content-stable generated writes

Today each one-shot `yarn generate` ends with `runPostGenerateStructuralCachePurge` (`packages/cli/src/mercato.ts:644`), which runs `configs cache structural` and bumps every `.generated.ts` mtime to force Turbopack invalidation. Replace unconditional writes/touches with a read-compare-write:

```ts
function writeIfChanged(path: string, next: string): boolean {
  const prev = readIfExists(path)
  if (prev === next) return false        // no write, no mtime bump → Turbopack cache preserved
  atomicWrite(path, next)
  return true
}
```

`runPostGenerateStructuralCachePurge` then runs only when at least one generated output actually changed. This is the linchpin that makes A4 and B1 safe.

### A3 — No-op generate skip

The develop in-process generate watcher already maintains a structural checksum via `calculateGenerateWatchStructureChecksum` (`packages/cli/src/lib/generate-watch-structure.ts`, wired through `createGenerateWatchChecksumFn` at `packages/cli/src/mercato.ts:713`). Expose the same checksum to the one-shot `mercato generate all` command: persist the last checksum (e.g. `.mercato/generated/.suite-checksum`), and short-circuit `runGeneratorSuite` + the structural purge when the current structural checksum matches — unless `--force`.

### A4 — Collapse the redundant second `build:packages`

With A2, generated outputs are byte-stable, so Turbo's `build` task (`cache: true`, `inputs` include `generated/**`, `turbo.json:7-11`) becomes a cache hit for every package whose generated inputs did not change. The second `build:packages` then costs near-zero on unchanged trees. Validate this empirically; only after it holds, optionally restructure `package.json:30` into a single ordered graph (`build:packages:pre → generate → build:packages:post → build:app`) so Turbo schedules it as one DAG.

### A5 — Incremental tsc (phased, opt-in)

Add `composite: true`, `declaration: true`, `declarationMap: true`, and a per-package `tsBuildInfoFile` under a gitignored cache dir, plus a root `tsconfig.refs.json` enumerating `references`. `typecheck` switches to `tsc -b` (build mode) which skips packages whose inputs/`.tsbuildinfo` are unchanged. Gated behind `OM_TSC_PROJECT_REFS=1` during rollout so the default path is unchanged until verified across the full package set.

### B1 — Persist Turbopack cache across no-op restarts

The default warmup is unchanged: `runTargetedRouteWarmup` (`apps/mercato/scripts/dev.mjs:845`) keeps warming `GET /login` → `POST /api/auth/login` → `GET /backend` sequentially, using the existing `fetchWarmupWithRetry` helper, retry/timeout state machine (`dev.mjs:119`, `:730`), and tenant-resolution fallback.

Develop's `502719d15` already keeps greenfield cleanup and between-warmup-request handling from discarding `.mercato/next/dev/cache/turbopack`. The remaining piece: once A2/A3 land, a dev restart with no structural change performs a no-op generate that touches nothing (no `runPostGenerateStructuralCachePurge` mtime bump), so the Turbopack cache stays valid and the first post-restart warmup hit is a cache hit rather than a recompile. Optionally set `turbopackFileSystemCache` explicitly in `next.config.ts` for clarity. `dev:reset` and the corrupted-cache recovery path (`dev.mjs:1698`) remain the explicit "blow away the cache" escape hatches.

### B2 — Optional warmup route override (opt-in)

Add an opt-in `OM_DEV_WARMUP_ROUTES` (comma-separated) that, when set, appends the listed routes to the existing three after auth completes:

```
default (OM_DEV_WARMUP_ROUTES unset): the three requests only
  GET  /login
  POST /api/auth/login
  GET  /backend
opt-in example: OM_DEV_WARMUP_ROUTES="/backend/sales/orders,/api/catalog/products?pageSize=1"
```

Appended routes reuse the existing `fetchWarmupWithRetry` helper and tenant-resolution fallback, and run after the sequential login+auth steps. This adds **no** new default warmup surface — the default behavior is byte-for-byte the current three requests. Warmup remains fully opt-out via the existing master flag (disabling warmup keeps the app `ready` exactly as today).

### B3 — Dev lever sweep

Benchmark, keep only what profiles positively:
- `preloadEntriesOnStart` (currently `false` in dev) — re-measure against the cache-persistence change.
- Extend `optimizePackageImports` beyond the current 3 to other barrel-heavy deps surfaced by the trace.
- Confirm `serverComponentsHmrCache` and Turbopack defaults are optimal for this app shape.

## Data Models

No persistent database schema changes.

New non-DB artifacts:
- `.mercato/generated/.suite-checksum` — last structural checksum for the no-op generate skip (ephemeral, gitignored).
- Per-package `*.tsbuildinfo` under a gitignored cache dir (A5 only).

## API Contracts

No user-facing HTTP API URLs change. No generated-file export shapes change (writes become content-gated but identical in shape).

New/changed CLI surface (additive):
- `mercato generate [--force]` — `--force` bypasses the A3 no-op skip. Default behavior unchanged when sources changed.
- Generated-file contracts in `.mercato/generated/*` keep their existing exports; only the write strategy (content-gated) changes.

## Internationalization (i18n)

Developer-facing CLI/splash log strings only (e.g. "Skipped generate — sources unchanged", "Reusing Turbopack cache — no structural change"). No end-user product strings; route through the existing dev-runner logging, prefixed `[internal]` where they are pure developer diagnostics. The existing warmup splash line ("🔥 Precompiling /login, login POST, and /backend") is unchanged.

## UI/UX

No end-user workflow change. Developer-visible improvements:
- Faster `yarn build` / `yarn generate` / `yarn typecheck` on repeat runs.
- Dev restarts reuse the Turbopack cache when nothing structural changed (the warmed `/login` and `/backend` come back from cache instead of recompiling).
- The warmup set is unchanged (the existing three requests); teams can opt into additional warmup routes via `OM_DEV_WARMUP_ROUTES`.

## Configuration

All additive; defaults preserve current behavior.

| Setting | Default | Purpose |
|---------|---------|---------|
| `OM_GENERATE_PARALLEL` | `1` (on) | Toggle the parallel generator suite (A1). |
| `OM_GENERATE_SKIP_UNCHANGED` | `1` (on) | No-op generate skip via structural checksum (A3); `mercato generate --force` overrides. |
| `OM_DEV_WARMUP_ROUTES` | unset | Opt-in comma-separated routes appended to the default three warmup requests (B2). **Unset → the existing three requests only.** |
| `OM_DEV_WARMUP` (existing behavior) | on | Master opt-out for warmup (unchanged). |
| `OM_TSC_PROJECT_REFS` | `0` (off) | Opt-in incremental tsc project references (A5). |

Existing flags preserved: `OM_DEV_WARMUP_TENANT_ID` (`dev.mjs:173`), `OM_PACKAGE_WATCH_MODE`, `OM_WATCH_PACKAGES_MODE`, `OM_DEV_GENERATE_WATCH_MODE`.

## Migration & Compatibility

### Backward Compatibility
- Auto-discovery file conventions: unchanged.
- API URLs, event IDs, ACL feature IDs, DI names, widget spot IDs: unchanged.
- Generated-file export shapes: unchanged (content-gated writes only).
- `yarn dev`, `yarn build`, `yarn generate`, `yarn typecheck` command names: unchanged.
- Standalone `create-app` template: the same dev runner and generators apply; template `dev.mjs` mirrors monorepo changes.

### Rollout Strategy
1. Land Workstream A behind `OM_GENERATE_PARALLEL` / `OM_GENERATE_SKIP_UNCHANGED` defaulting on, A5 defaulting off.
2. Land Workstream B with the warmup set unchanged: the no-op-restart cache persistence (B1, depends on A2/A3) and the opt-in `OM_DEV_WARMUP_ROUTES` (B2, default unset).
3. Re-measure against the April baselines via the harness; gate the PR on hitting the 30–50% targets.
4. Keep `--force`, `dev:reset`, and the corrupted-cache recovery path as escape hatches; keep A5 opt-in until verified across all packages.

## Implementation Plan

### Phase 1 — Measurement harness baseline
1. Capture current `yarn generate`, `yarn build`, `yarn typecheck` wall-clock on a clean tree and on a single shared-package edit; record in the spec.
2. Capture cold first-hit times for `/login`, `/api/customers/people`, `/backend/customers/people` with warmup off, and warm times with warmup on; record `.mercato/next/dev/trace`.

### Phase 2 — Generator suite (A1–A3)
1. Add content-gated `writeIfChanged` to the generator write path; make the structural-cache purge conditional on a real change.
2. Reshape `runGeneratorSuite` into dependency-ordered parallel stages behind `OM_GENERATE_PARALLEL`.
3. Add the no-op generate skip (checksum persistence + `--force`) behind `OM_GENERATE_SKIP_UNCHANGED`.
4. Unit tests: stage ordering preserves entity-IDs→registry dependency; `writeIfChanged` no-write on identical content; skip fires only when checksum matches.

### Phase 3 — Build pipeline (A4)
1. Verify the second `build:packages` is mostly Turbo cache hits once generated output is byte-stable.
2. If verified, restructure `package.json` build into a single ordered Turbo graph; otherwise document why the double pass stays.

### Phase 4 — Dev Turbopack cache (B1–B2)
1. Make the Turbopack cache survive a no-op generate on restart (depends on Phase 2 content-gating + no-op skip); optionally set `turbopackFileSystemCache`. Leave the warmup set unchanged.
2. Add the opt-in `OM_DEV_WARMUP_ROUTES` override (default unset → the existing three requests).
3. Unit tests: default warmup set is byte-for-byte the current three requests; route-override parsing appends only when the flag is set. Integration: a no-op dev restart serves the warmed `/login`/`/backend` from the Turbopack cache instead of recompiling.

### Phase 5 — Lever sweep + optional incremental tsc (B3, A5)
1. Benchmark `preloadEntriesOnStart`, `optimizePackageImports` expansion, Turbopack defaults; keep only positive levers.
2. Prototype `OM_TSC_PROJECT_REFS` incremental typecheck on a subset; expand only if it profiles positively and typecheck stays correct.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/mercato.ts` | Modify | Parallel generator stages (A1), no-op skip + `--force` + conditional structural purge (A2/A3) |
| `packages/cli/src/lib/generators/*` | Modify | Content-gated `writeIfChanged` (A2) |
| `packages/cli/src/lib/generate-watch-structure.ts` | Reuse | Structural checksum shared with one-shot generate (A3) |
| `package.json` | Modify | Optional single-graph build restructure (A4) |
| `turbo.json` | Modify | Build graph wiring if A4 restructures |
| `apps/mercato/scripts/dev.mjs` | Modify | Opt-in `OM_DEV_WARMUP_ROUTES` (B2); warmup set otherwise unchanged |
| `apps/mercato/next.config.ts` | Modify | Optional `turbopackFileSystemCache` + lever sweep (B1, B3) |
| `packages/create-app/template/scripts/dev.mjs` | Modify | Mirror the opt-in warmup override for standalone |
| package `tsconfig*.json`, root `tsconfig.refs.json` | Add/Modify | Incremental tsc project references (A5, opt-in) |

### Testing Strategy
- Unit: generator stage ordering + determinism; `writeIfChanged` semantics; no-op skip checksum; default warmup set unchanged (the three requests) + `OM_DEV_WARMUP_ROUTES` parsing appends only when set.
- Integration: structural change during `yarn dev` still regenerates without restart; a no-op dev restart serves the warmed `/login`/`/backend` from the Turbopack cache instead of recompiling; standalone app keeps the same (unchanged) warmup and honors the opt-in override.
- Regression: `yarn build`, `yarn generate`, `yarn typecheck`, `yarn build:app` all pass with flags on and off; generated file bytes identical to pre-change output for an unchanged tree.

### Integration Coverage

| Scenario | Coverage |
|----------|----------|
| `yarn generate` parallel vs serial → identical generated bytes | Unit + smoke |
| No-op `yarn generate` skips suite + structural purge; `--force` overrides | Unit |
| Second `build:packages` is cache hits on unchanged tree | CI smoke |
| Default warmup is unchanged (the three requests) | Unit |
| `OM_DEV_WARMUP_ROUTES` opt-in override appends custom routes | Integration |
| Turbopack cache survives no-op restart | Manual + trace |
| Standalone app warmup parity (unchanged set + opt-in override) | Integration |

### Acceptance Criteria

The 30–50% target is carried by Workstream A (build/generate/typecheck) plus the no-op-restart Turbopack cache hit. The warmup set is unchanged, so the warmup-off cold-route times below are informational baselines, not targets this spec attacks directly.

| Metric | Baseline (Apr 2, 2026) | Target | Measured |
|--------|------------------------|--------|----------|
| `yarn generate` (clean repeat) | `5.52s` | `≤ 3.5s` (≥30%) | TBD — gate before merge |
| `yarn generate` (no structural change) | `5.52s` | near-zero (skip) | TBD |
| `yarn build` total (unchanged tree) | 2× `build:packages` + generate + app | drop ~one `build:packages` pass | TBD |
| `yarn typecheck` (single shared-package edit, A5 opt-in) | full re-typecheck of dependents | incremental skip of unchanged packages | TBD |
| Dev restart first hit (no structural change) | recompile today | Turbopack cache hit | TBD |
| Cold `/login` / `/backend/customers/people` (warmup off) | `8.1s` / `14.4s` | informational; no regression (improve only if lever sweep B3 profiles positively) | TBD |
| Idle RSS (warmup set unchanged) | `~+460 MB` warmup delta (April) | no regression vs current | TBD |

## Risks & Impact Review

#### Parallel generators produce non-deterministic or interleaved output
- **Scenario**: Concurrent generators write overlapping files or depend on each other's fresh output, producing drift vs the serial suite.
- **Severity**: High
- **Affected area**: every generated registry; downstream compile/runtime.
- **Mitigation**: Stage by data dependency (entity-IDs first, registry before app/cli registries); atomic temp-file writes; a regression test asserting byte-identical output vs serial on a fixed fixture.
- **Residual risk**: Low once parity tests cover the full generator set.

#### Content-gating skips a write that a consumer needed
- **Scenario**: `writeIfChanged` skips a file whose dependents expected an mtime bump.
- **Severity**: Medium
- **Affected area**: Turbopack invalidation, Turbo cache keys.
- **Mitigation**: Gate only on exact byte equality; keep the structural purge whenever any file changed; `--force` + `dev:reset` escape hatches.
- **Residual risk**: Low.

#### No-op generate skip masks a needed regeneration
- **Scenario**: A structural change the checksum doesn't cover is skipped, leaving stale generated files.
- **Severity**: High
- **Affected area**: dev correctness, missing routes/registrations.
- **Mitigation**: Reuse the already-trusted develop `calculateGenerateWatchStructureChecksum` inputs (`packages/cli/src/lib/generate-watch-structure.ts`, which already drives live dev regeneration); `--force` override; default-on but easily disabled via `OM_GENERATE_SKIP_UNCHANGED=0`.
- **Residual risk**: Low–Medium until the checksum input set is confirmed to cover every structural file.

#### Opt-in warmup override raises idle RSS on a team's machine
- **Scenario**: A team sets `OM_DEV_WARMUP_ROUTES` to warm heavy routes, raising idle RSS beyond the April `~460 MB` warmup delta.
- **Severity**: Low
- **Affected area**: long dev sessions on machines that opted in.
- **Mitigation**: The default is unchanged (the three requests) — no RSS regression for anyone who does nothing. The override is opt-in per-developer and can be trimmed or unset; the master warmup opt-out still applies. Profile with `yarn dev:profile`.
- **Residual risk**: Low — only affects developers who explicitly opt in.

#### Collapsing the second build:packages compiles against stale dist
- **Scenario**: Removing/short-circuiting the second pass before generated output is byte-stable leaves packages built against stale generated inputs.
- **Severity**: High
- **Affected area**: production `yarn build`, standalone packaging.
- **Mitigation**: A4 strictly depends on A2; keep the double pass until cache-hit behavior is empirically verified; restructure only as a single ordered Turbo DAG.
- **Residual risk**: Low if sequenced correctly.

#### tsc project references break declaration emit / isolatedModules
- **Scenario**: `composite`/`references` surface latent type-only import or circular-reference issues across packages.
- **Severity**: Medium
- **Affected area**: typecheck/build of every package.
- **Mitigation**: Ship A5 opt-in behind `OM_TSC_PROJECT_REFS`, prototype on a subset, keep the existing per-package `tsc --noEmit` as the default until parity is proven.
- **Residual risk**: Medium during rollout; Low once the full graph compiles clean.

#### Turbopack cache persistence serves stale compiled chunks
- **Scenario**: Preserving the cache across restarts serves a stale chunk after an edit the watcher didn't catch.
- **Severity**: Medium
- **Affected area**: dev correctness after structural deletes (a known April caveat).
- **Mitigation**: Cache survives only no-op generates; any real change still touches outputs and invalidates; `dev:reset` remains the documented hard reset.
- **Residual risk**: Low.

## Final Compliance Report — 2026-05-28

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/lessons.md` (develop cache-preservation lesson from `502719d15`)

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | Check existing specs before non-trivial changes | Compliant | Built on the April 2 cold-start spec + the dev-mode memory/lazy-load specs; explicitly avoids duplicating them. |
| `.ai/specs/AGENTS.md` | `{date}-{title}.md` naming, no `SPEC-*` prefix | Compliant | `2026-05-28-compile-and-route-warmup-speedup.md`. |
| root `AGENTS.md` | Keep command/contract changes additive | Compliant | All flags additive; generated-file shapes unchanged; command names unchanged. |
| `BACKWARD_COMPATIBILITY.md` | Generated files & CLI commands are stable/frozen | Compliant | Content-gated writes keep export shapes; `--force` is additive. |
| `packages/cli/AGENTS.md` | Generators must support monorepo + standalone | Compliant | Changes ride the existing resolver; standalone template mirrored. |
| `.ai/lessons.md` | Preserve the Turbopack compiler cache during dev warmup; only `dev:reset`/corrupted-cache recovery clears `.mercato/next/dev` | Compliant | Workstream B builds on `502719d15` (greenfield purge already preserves the cache) and only stops the no-op-generate structural purge from invalidating it; `dev:reset` and the corrupted-cache recovery path are kept as the explicit hard resets. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Problem statement grounded in source | Pass | Every claim cites a file:line verified against the tree. |
| Targets tied to a baseline + harness | Pass | April baselines restated; `yarn dev:profile` + cold-trace procedure reused; measured columns gated. |
| Compatibility strategy explicit | Pass | Additive flags, unchanged contracts, escape hatches. |
| Monorepo + standalone covered | Pass | Template `dev.mjs` mirrored. |
| Risks cover correctness + perf regressions | Pass | Generator drift, skip masking, RSS budget, stale dist, tsc refs, cache staleness. |

### Non-Compliant Items
- None identified for the specification itself.

### Verdict
- **Draft — ready for implementation review.** Pre-implementation measurement (Phase 1) must capture fresh baselines on `develop` before the 30–50% gate is enforced.

## Changelog

### 2026-07-16
- Implemented a focused post-generation bootstrap reduction: automatic structural invalidation now reads tenant metadata from the configured stock cache backend in one pass and refreshes generated artifacts directly, avoiding generated CLI/module imports, ORM tenant discovery, request containers, and the application bootstrap graph. The explicit `mercato configs cache structural --all-tenants` command remains unchanged as the DI-aware operator path.

### 2026-05-28
- Initial specification. Targets a further 30–50% on compilation (build/generate/typecheck pipeline) and dev route warmup, building on the implemented April 2, 2026 cold-start work without duplicating it. Grounded in static source analysis; measured columns gated on Phase 1.
- Revised per maintainer review: Workstream B no longer broadens the dev warmup. The default warmup stays the existing three requests (`GET /login`, `POST /api/auth/login`, `GET /backend`); the broaden-warmup lever and the bounded-parallel batch (and `OM_DEV_WARMUP_CONCURRENCY`) are dropped. `OM_DEV_WARMUP_ROUTES` is retained as an opt-in (default unset) override only. Workstream B is now scoped to the no-op-restart Turbopack cache and the lever sweep.
- Re-grounded against develop commits `4100aa7fb` and `502719d15`: the structural checksum now lives in `packages/cli/src/lib/generate-watch-structure.ts` (`calculateGenerateWatchStructureChecksum`); the post-generate touch is the named `runPostGenerateStructuralCachePurge` (`packages/cli/src/mercato.ts:644`); `runGeneratorSuite` moved to `mercato.ts:689-710`; warmup is `runTargetedRouteWarmup` at `dev.mjs:845`. `502719d15` (issue #1950) already preserves `.mercato/next/dev/cache/turbopack` during greenfield cleanup and between warmup requests, so B1 now targets only the remaining no-op-generate invalidation. Drifted file:line references updated throughout.
