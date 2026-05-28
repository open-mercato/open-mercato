# Compilation And Route Warmup Speedup (30–50%)

## TLDR

**Key Points:**
- The April 2, 2026 cold-start work (`.ai/specs/implemented/2026-04-02-dev-structural-regeneration-and-cold-start-optimization.md`) already solved the worst architectural offenders: lazy route manifests, partitioned bootstrap, generator watch, and a background warmup. This spec targets the **next 30–50%** on top of that, in two independent workstreams.
- **Workstream A — build/generate compilation pipeline.** `yarn build` runs `build:packages` **twice** (`package.json:30`), `yarn generate` runs 8 generators **strictly sequentially** with `cache: false` (`packages/cli/src/mercato.ts:659-680`, `turbo.json:43-46`), and there are **no tsc project references / shared incremental graph** so cross-package typecheck/compile never skips unchanged work. These are the dominant repeatable-compile costs for `build`, `generate`, and `typecheck`.
- **Workstream B — dev route warmup + Turbopack cache.** The only warmup that exists today is the HTTP flow in `apps/mercato/scripts/dev.mjs:787-998`, which warms exactly three things **sequentially**: `GET /login`, `POST /api/auth/login`, `GET /backend`. The heaviest cold compile measured in April — the `/api/[...slug]` catch-all (`~15s`) and a real backend CRUD list page like `/backend/customers/people` (`~19.4s`) — are **never explicitly warmed**. `instrumentation.ts` is now a no-op (`apps/mercato/src/instrumentation.ts`). The Turbopack filesystem cache is also un-tuned and is invalidated on every `yarn generate` because the post-generate step touches all `.generated.ts` files unconditionally.
- The fix is additive and flag-gated: parallelize the generator suite, content-gate generated writes so unchanged output preserves the Turbopack cache, add a checksum skip for no-op `generate`, collapse the redundant second `build:packages` pass via stable cache inputs, broaden + parallelize warmup to cover one representative route per catch-all kind, and tune the Turbopack/Next dev levers. Each lands behind a flag and is validated with the existing `yarn dev:profile` harness plus a documented cold-compile procedure.

**Scope:**
- Speed up `yarn build`, `yarn generate`, and `yarn typecheck` repeatable-compile time by 30–50% without changing generated-file contracts.
- Speed up dev-mode first-real-request latency by broadening and parallelizing route warmup so all three catch-all entrypoints are compiled in the background before the developer navigates.
- Preserve the Turbopack filesystem cache across dev restarts when module sources are unchanged.
- Keep monorepo and standalone (`create-app`) behavior aligned.

**Concerns:**
- Generated-file contracts (`modules.generated.ts`, route manifests, entity-id maps) are FROZEN/STABLE — changes must be additive and byte-identical where consumers depend on shape.
- Parallel generators must preserve output determinism and the existing run order's data dependencies (entity IDs feed the registry).
- Broader warmup trades idle RSS for lower first-hit latency; it must stay opt-out and concurrency-bounded (the April work already noted warmup adds `~460 MB` RSS).
- tsc project references are a larger, higher-risk change (touches every package `tsconfig`) and are deliberately phased last and behind verification.

## Assumptions

This spec was authored autonomously from static source analysis; the following scope assumptions are recorded so a reviewer can correct them before implementation:

1. **"Compilation"** means the repeatable build/generate/typecheck pipeline (`yarn build`, `yarn generate`, `yarn typecheck`, `yarn build:app`) **and** dev-mode Turbopack route compilation — not a one-time `yarn install`.
2. **"Route warmup"** means the dev-runner background pre-compilation flow in `apps/mercato/scripts/dev.mjs`, not production prerendering.
3. The 30–50% target is measured against the **April 2, 2026 baselines** restated below and re-measured on `develop` before merge using the existing harness. No new measured numbers are claimed in this draft; the "Measured" columns are gated on implementation.
4. Backward compatibility outweighs raw speed: every lever ships additively and flag-gated, defaulting to current behavior until a profiling gate proves the win.

## Overview

Open Mercato's module system trades flexibility for a large generated registry and a broad module graph. The April 2, 2026 spec attacked the first-request architectural bottleneck and won big (API cold `15.0s → 1.86s`; backend cold `19.4s → 3.9s` *with* warmup). But two cost centers were left only partially addressed:

1. The **build/generate/typecheck pipeline** still does redundant and fully-sequential work on every invocation. This is what a developer pays on `yarn build`, what CI pays per affected package, and what `yarn generate` costs on every structural change.
2. The **dev warmup** is narrow. It compiles the login path and the `/backend` shell, but not the catch-all entrypoints that the April trace proved are the heaviest (`/api/[...slug]` at `~15s`, backend CRUD list pages at `~19.4s`). So the first time a developer opens a real list page or calls a real API, they still pay a cold compile.

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

> The remaining warmup-off cold times (`/login` `8.1s`, `/backend/...` `14.4s`) are exactly the surfaces this spec broadens warmup to cover, and the build/generate numbers are the surfaces Workstream A attacks.

> **Reference Material**:
> - Next.js memory & dev guidance: <https://nextjs.org/docs/app/guides/memory-usage>
> - Turbopack filesystem cache: <https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache>
> - Turborepo caching & inputs: <https://turbo.build/repo/docs/crafting-your-repository/caching>
> - TypeScript project references: <https://www.typescriptlang.org/docs/handbook/project-references.html>

## Problem Statement

### A. Build/generate/typecheck does redundant and serial work

1. **Double package build.** `yarn build` is `yarn build:packages && yarn generate && yarn build:packages && yarn build:app` (`package.json:30`). The second `build:packages` exists because generators write into package `generated/` trees that are declared `build` inputs (`turbo.json:9` — `inputs: ["$TURBO_DEFAULT$", "generated/**"]`). Today that second pass rebuilds packages whose generated inputs are byte-unchanged because generator output is not content-stable, so Turbo treats it as a cache miss.
2. **Strictly sequential generators.** `runGeneratorSuite` awaits 8 generators one-by-one (`packages/cli/src/mercato.ts:659-680`): entity IDs → module registry → app registry → CLI registry → entities → DI → package sources → OpenAPI. Several have no data dependency on each other and could run concurrently. The Turbo `generate` task is `cache: false` (`turbo.json:44`), so the full suite re-runs even when no module source changed.
3. **No incremental cross-package compilation.** Packages compile via esbuild with `bundle: false` (`scripts/build-package.mjs`) and typecheck via per-package `tsc --noEmit` (`turbo.json:32-35`) with **no `composite` / `references` / shared `tsBuildInfoFile`**. Turbo caches whole-task outputs, but a single edit in a shared package (e.g. `@open-mercato/shared`) forces a from-scratch typecheck of every dependent package rather than an incremental delta.

### B. Dev warmup is narrow and serial; the Turbopack cache is fragile

1. **Warmup covers only 3 surfaces, sequentially.** `runTargetedRouteWarmup` (`apps/mercato/scripts/dev.mjs:787-998`) issues `GET /login` → `POST /api/auth/login` → `GET /backend`, each awaiting the previous. It never warms the `/api/[...slug]` catch-all with a real data endpoint, never warms a real backend CRUD **list page** (the `/backend/customers/people` `19.4s` case), and never warms the frontend storefront catch-all. `instrumentation.ts` is a no-op (`apps/mercato/src/instrumentation.ts`), so there is no background module-import warmup either.
2. **Warmup tuning is conservative.** Timeouts are `[45000, 120000]ms` (`dev.mjs:113`), retries cap at `3` (`dev.mjs:114`) with a fixed `2000ms` delay (`dev.mjs:956`). There is no bounded-parallel authenticated batch.
3. **Turbopack filesystem cache is un-tuned and self-invalidated.** `next.config.ts` sets `serverMinification: false`, `turbopackMinify: false`, `optimizePackageImports: ['lucide-react','recharts','date-fns']`, and dev `preloadEntriesOnStart: false` (`next.config.ts:25-40`) — but no explicit `turbopackFileSystemCache`. Worse, the post-`generate` step touches **all** `.generated.ts` files unconditionally to bust Turbopack (documented in root `AGENTS.md` and the April spec), so a no-op `yarn generate` on dev restart throws away an otherwise-reusable compile cache. `dev:reset` clears `.mercato/next/dev` and the turbopack/webpack caches (`apps/mercato/scripts/dev-reset.mjs`).

## Proposed Solution

Two independent workstreams, each landing additively behind flags.

### Workstream A: Pipeline compilation speedups

| Lever | Change | Where |
|-------|--------|-------|
| A1 — Parallel generator suite | Group independent generators into bounded `Promise.all` stages, preserving the entity-IDs→registry data dependency. | `packages/cli/src/mercato.ts:659-680` |
| A2 — Content-stable generated writes | Write generated files only when output bytes change; never `touch` unchanged files. Makes Turbo `build` inputs stable and preserves the Turbopack cache. | generators under `packages/cli/src/lib/generators/*`; post-generate touch step |
| A3 — No-op generate skip | Checksum module sources; skip the whole suite when nothing structural changed (reuse the existing `in-process-generate-watcher` checksum logic). | `packages/cli/src/mercato.ts`, `packages/cli/src/lib/in-process-generate-watcher.ts` |
| A4 — Collapse the second `build:packages` | With A2 making generated output byte-stable, the second pass becomes Turbo cache hits for unchanged packages. Verify and, if proven, document/optionally fold generation into a single ordered Turbo graph. | `package.json:30`, `turbo.json` |
| A5 — Incremental tsc (phased, opt-in) | Introduce `composite: true` + `references` + persistent `tsBuildInfoFile` so `typecheck`/declaration builds skip unchanged packages incrementally. | package `tsconfig*.json`, root references |

### Workstream B: Dev route warmup + Turbopack cache

| Lever | Change | Where |
|-------|--------|-------|
| B1 — Broaden warmup coverage | After auth, warm one representative route per catch-all kind: an authenticated API list (`/api/<reference-module>?page=1&pageSize=1`), a backend CRUD list page (`/backend/<reference-module>`), and (when storefront is enabled) one frontend route. | `apps/mercato/scripts/dev.mjs:787-998` |
| B2 — Bounded-parallel warmup batch | Run the post-auth warmup targets concurrently with a small concurrency cap instead of strictly sequentially. | `apps/mercato/scripts/dev.mjs` |
| B3 — Configurable warmup route set | `OM_DEV_WARMUP_ROUTES` (comma-separated) overrides/extends the default set so teams can warm their own hot paths. | `apps/mercato/scripts/dev.mjs` |
| B4 — Persist Turbopack cache across restarts | Pair with A2: stop unconditional `.generated.ts` touch on no-op generate so the Turbopack filesystem cache survives a dev restart; optionally set `turbopackFileSystemCache` explicitly. | post-generate touch step, `next.config.ts` |
| B5 — Dev lever sweep | Benchmark `preloadEntriesOnStart`, expand `optimizePackageImports` to additional barrel-heavy deps, and confirm `serverComponentsHmrCache` defaults — keep only levers that profile positively. | `apps/mercato/next.config.ts:24-41` |

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Two independent workstreams, separately shippable | Pipeline and dev-warmup wins are orthogonal; bundling them would slow review and muddy attribution. |
| Everything additive + flag-gated, defaulting to current behavior | Build/generate is a contract-adjacent hot path; a regression here blocks every developer and CI run. Flags let us gate on a profiling result. |
| Reuse the existing checksum + profiling infrastructure | `in-process-generate-watcher` already computes structural checksums; `scripts/profile-dev-rss.mjs` / `yarn dev:profile` already samples the process tree. Build on them, don't reinvent. |
| Warm by **route kind**, not by enumerating every route | Compiling one route per catch-all kind compiles the catch-all entrypoint (the expensive part) once; enumerating all routes would reintroduce the eager-graph cost the April work removed. |
| Phase tsc project references last | It edits every package `tsconfig`, risks declaration-emit/`isolatedModules` fallout, and is the least certain win — it must follow a clean profiling baseline. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Enable `turbopackMinify` / `serverMinification` | These are deliberately **off** in dev to speed compilation (`next.config.ts:25-26`); enabling them slows the very path we want faster. |
| Replace esbuild with `tsc` build for packages | esbuild is already the fast path; the bottleneck is redundancy and serialization, not the per-file compiler. |
| Drop the second `build:packages` outright | Unsafe until A2 proves generated output is byte-stable; otherwise packages consuming fresh generated inputs would compile against stale `dist/`. |
| HTTP-warm every backend page | Reintroduces eager-graph breadth and huge idle RSS; defeats the April lazy-manifest design. |
| Always-on broad warmup | RSS cost (`~460 MB+`) is unacceptable for low-RAM machines; must stay opt-out and bounded. |
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

Current (`packages/cli/src/mercato.ts:659-680`) is a serial `await` chain. Reshape into dependency-ordered stages:

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

Today the post-generate step touches every `.generated.ts` to force Turbopack invalidation. Replace unconditional writes/touches with a read-compare-write:

```ts
function writeIfChanged(path: string, next: string): boolean {
  const prev = readIfExists(path)
  if (prev === next) return false        // no write, no mtime bump → Turbopack cache preserved
  atomicWrite(path, next)
  return true
}
```

The structural cache purge (`yarn mercato configs cache structural`) then runs only when at least one generated output actually changed. This is the linchpin that makes A4 and B4 safe.

### A3 — No-op generate skip

`in-process-generate-watcher.ts` already maintains a structural checksum (`DEFAULT_POLL_MS = 1000`). Expose the same checksum to the one-shot `mercato generate` command: persist the last checksum (e.g. `.mercato/generated/.suite-checksum`), and short-circuit `runGeneratorSuite` when the current structural checksum matches — unless `--force`.

### A4 — Collapse the redundant second `build:packages`

With A2, generated outputs are byte-stable, so Turbo's `build` task (`cache: true`, `inputs` include `generated/**`, `turbo.json:7-11`) becomes a cache hit for every package whose generated inputs did not change. The second `build:packages` then costs near-zero on unchanged trees. Validate this empirically; only after it holds, optionally restructure `package.json:30` into a single ordered graph (`build:packages:pre → generate → build:packages:post → build:app`) so Turbo schedules it as one DAG.

### A5 — Incremental tsc (phased, opt-in)

Add `composite: true`, `declaration: true`, `declarationMap: true`, and a per-package `tsBuildInfoFile` under a gitignored cache dir, plus a root `tsconfig.refs.json` enumerating `references`. `typecheck` switches to `tsc -b` (build mode) which skips packages whose inputs/`.tsbuildinfo` are unchanged. Gated behind `OM_TSC_PROJECT_REFS=1` during rollout so the default path is unchanged until verified across the full package set.

### B1–B3 — Broader, parallel, configurable warmup

Extend `runTargetedRouteWarmup` (`apps/mercato/scripts/dev.mjs:787-998`). After the existing login+auth steps obtain the cookie, build a warmup target list:

```
default targets (after auth):
  GET  /api/customers/people?page=1&pageSize=1     # compiles /api/[...slug] catch-all
  GET  /backend/customers/people                   # compiles backend CRUD-list catch-all path
  GET  /                                            # compiles frontend storefront catch-all (if enabled)
override: OM_DEV_WARMUP_ROUTES="/backend/sales/orders,/api/catalog/products?pageSize=1"
```

Targets run with a bounded concurrency (default 2–3) using the existing `fetchWarmupWithRetry` helper, the existing retry/timeout state machine (`dev.mjs:113-114`, `:956`), and the existing tenant-resolution fallback. The login + auth steps stay sequential (auth must precede authenticated targets); only the post-auth batch parallelizes. Warmup remains fully opt-out (disabling warmup keeps the app `ready` exactly as today).

The reference module for default targets is `customers` (the canonical CRUD reference per root `AGENTS.md`), matching the April benchmark routes so before/after numbers are directly comparable.

### B4 — Persist Turbopack cache across restarts

Once A2 lands, a dev restart with no structural change performs a no-op generate (A3) that touches nothing, so `.mercato/next/cache/turbopack` stays valid and the first post-restart hit is a cache hit rather than a recompile. Optionally set `turbopackFileSystemCache` explicitly in `next.config.ts` for clarity. `dev:reset` remains the explicit "blow away the cache" escape hatch.

### B5 — Dev lever sweep

Benchmark, keep only what profiles positively:
- `preloadEntriesOnStart` (currently `false` in dev) — re-measure now that warmup is broader.
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

Developer-facing CLI/splash log strings only (e.g. "Skipped generate — sources unchanged", "Warming /api, /backend, storefront", "Warmup batch complete"). No end-user product strings; route through the existing dev-runner logging, prefixed `[internal]` where they are pure developer diagnostics.

## UI/UX

No end-user workflow change. Developer-visible improvements:
- Faster `yarn build` / `yarn generate` / `yarn typecheck` on repeat runs.
- First real backend list page and first API call are warm after the splash completes, not cold on first navigation.
- Dev restarts reuse the Turbopack cache when nothing structural changed.

## Configuration

All additive; defaults preserve current behavior.

| Setting | Default | Purpose |
|---------|---------|---------|
| `OM_GENERATE_PARALLEL` | `1` (on) | Toggle the parallel generator suite (A1). |
| `OM_GENERATE_SKIP_UNCHANGED` | `1` (on) | No-op generate skip via structural checksum (A3); `mercato generate --force` overrides. |
| `OM_DEV_WARMUP_ROUTES` | unset | Comma-separated route override/extension for warmup (B3). |
| `OM_DEV_WARMUP_CONCURRENCY` | `2` | Bounded parallelism for the post-auth warmup batch (B2). |
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
2. Land Workstream B behind the existing warmup opt-out, with broadened defaults.
3. Re-measure against the April baselines via the harness; gate the PR on hitting the 30–50% targets.
4. Keep `--force` and `dev:reset` as escape hatches; keep A5 opt-in until verified across all packages.

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

### Phase 4 — Dev warmup (B1–B4)
1. Broaden warmup to one representative route per catch-all kind; parallelize the post-auth batch with `OM_DEV_WARMUP_CONCURRENCY`.
2. Add `OM_DEV_WARMUP_ROUTES` override.
3. Make Turbopack cache survive no-op generate on restart (depends on Phase 2 content-gating).
4. Unit tests: warmup target list construction, route-override parsing, concurrency bound; integration: warm path leaves all three catch-alls compiled.

### Phase 5 — Lever sweep + optional incremental tsc (B5, A5)
1. Benchmark `preloadEntriesOnStart`, `optimizePackageImports` expansion, Turbopack defaults; keep only positive levers.
2. Prototype `OM_TSC_PROJECT_REFS` incremental typecheck on a subset; expand only if it profiles positively and typecheck stays correct.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/mercato.ts` | Modify | Parallel generator stages (A1), no-op skip + `--force` (A3) |
| `packages/cli/src/lib/generators/*` | Modify | Content-gated `writeIfChanged` (A2) |
| `packages/cli/src/lib/in-process-generate-watcher.ts` | Modify | Share structural checksum with one-shot generate (A3) |
| `package.json` | Modify | Optional single-graph build restructure (A4) |
| `turbo.json` | Modify | Build graph wiring if A4 restructures |
| `apps/mercato/scripts/dev.mjs` | Modify | Broaden + parallelize + configurable warmup (B1–B3) |
| `apps/mercato/next.config.ts` | Modify | Optional `turbopackFileSystemCache` + lever sweep (B4–B5) |
| `packages/create-app/template/scripts/dev.mjs` | Modify | Mirror warmup changes for standalone |
| package `tsconfig*.json`, root `tsconfig.refs.json` | Add/Modify | Incremental tsc project references (A5, opt-in) |

### Testing Strategy
- Unit: generator stage ordering + determinism; `writeIfChanged` semantics; no-op skip checksum; warmup target construction + override parsing + concurrency bound.
- Integration: structural change during `yarn dev` still regenerates without restart; cold `/login`, `/api/customers/people`, `/backend/customers/people` warm after splash; standalone app gets the same warmup defaults.
- Regression: `yarn build`, `yarn generate`, `yarn typecheck`, `yarn build:app` all pass with flags on and off; generated file bytes identical to pre-change output for an unchanged tree.

### Integration Coverage

| Scenario | Coverage |
|----------|----------|
| `yarn generate` parallel vs serial → identical generated bytes | Unit + smoke |
| No-op `yarn generate` skips suite; `--force` overrides | Unit |
| Second `build:packages` is cache hits on unchanged tree | CI smoke |
| Dev warmup compiles all three catch-alls | Integration |
| `OM_DEV_WARMUP_ROUTES` override warms custom routes | Integration |
| Turbopack cache survives no-op restart | Manual + trace |
| Standalone app warmup parity | Integration |

### Acceptance Criteria

| Metric | Baseline (Apr 2, 2026) | Target | Measured |
|--------|------------------------|--------|----------|
| `yarn generate` (clean repeat) | `5.52s` | `≤ 3.5s` (≥30%) | TBD — gate before merge |
| `yarn generate` (no structural change) | `5.52s` | near-zero (skip) | TBD |
| `yarn build` total (unchanged tree) | 2× `build:packages` + generate + app | drop ~one `build:packages` pass | TBD |
| Cold `/login` (warmup off) | `8.1s` | `≤ 5.5s` (≥30%) | TBD |
| Cold `/backend/customers/people` (warmup off) | `14.4s` | `≤ 9.5s` (≥33%) | TBD |
| First real API/backend hit after splash | cold today (not warmed) | warm (catch-all pre-compiled) | TBD |
| Dev restart first hit (no structural change) | recompile today | Turbopack cache hit | TBD |
| Idle RSS delta from broader warmup | `~+460 MB` (April) | `≤ +600 MB`, opt-out | TBD |

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
- **Mitigation**: Reuse the already-trusted `in-process-generate-watcher` checksum inputs (it already drives live dev regeneration); `--force` override; default-on but easily disabled via `OM_GENERATE_SKIP_UNCHANGED=0`.
- **Residual risk**: Low–Medium until the checksum input set is confirmed to cover every structural file.

#### Broader warmup increases idle RSS or destabilizes low-RAM dev
- **Scenario**: Warming three catch-alls compiles more up front, raising idle RSS beyond the April `~460 MB` warmup delta.
- **Severity**: Medium
- **Affected area**: long dev sessions on constrained machines.
- **Mitigation**: Bounded concurrency, opt-out master flag, `OM_DEV_WARMUP_ROUTES` to trim; profile with `yarn dev:profile` and gate on the `≤ +600 MB` budget.
- **Residual risk**: Medium on very low-RAM machines (mitigated by opt-out).

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

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | Check existing specs before non-trivial changes | Compliant | Built on the April 2 cold-start spec + the dev-mode memory/lazy-load specs; explicitly avoids duplicating them. |
| `.ai/specs/AGENTS.md` | `{date}-{title}.md` naming, no `SPEC-*` prefix | Compliant | `2026-05-28-compile-and-route-warmup-speedup.md`. |
| root `AGENTS.md` | Keep command/contract changes additive | Compliant | All flags additive; generated-file shapes unchanged; command names unchanged. |
| `BACKWARD_COMPATIBILITY.md` | Generated files & CLI commands are stable/frozen | Compliant | Content-gated writes keep export shapes; `--force` is additive. |
| `packages/cli/AGENTS.md` | Generators must support monorepo + standalone | Compliant | Changes ride the existing resolver; standalone template mirrored. |

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

### 2026-05-28
- Initial specification. Targets a further 30–50% on compilation (build/generate/typecheck pipeline) and dev route warmup, building on the implemented April 2, 2026 cold-start work without duplicating it. Grounded in static source analysis; measured columns gated on Phase 1.
