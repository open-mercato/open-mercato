# Dev-mode memory quick wins

**Date:** 2026-05-27
**Status:** draft (Phase 1 landed: profiling harness + this analysis spec)
**Owner:** dev-experience working group
**Related work:**
- PR #2102 — workspace package watcher consolidation (`fix/dev-mode-package-watch-consolidation`); the dominant single intervention. Not yet on `develop`.
- `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` — long-running effort to migrate 934 `"use client"` files to server-first. Multi-phase, separate workstream.
- `.ai/specs/implemented/2026-05-13-lazy-auto-spawn-scheduler.md` and `.ai/specs/implemented/2026-05-07-lazy-auto-spawn-queue-workers.md` — already implemented; `yarn dev` auto-sets `OM_AUTO_SPAWN_WORKERS_LAZY=true` and `OM_AUTO_SPAWN_SCHEDULER_LAZY=true` in `scripts/dev.mjs:517-526`.

## Context

`yarn dev` in this monorepo regularly hits 3–4 GB peak RSS on a developer machine. Targets:

- Eliminate OOMs on 8 GB workstations (one Docker container plus IDE plus dev server is enough to thrash swap).
- Reduce dev-server "first compile" memory spike that delays page loads after edits.
- Give the team an instrument (not a guess) to compare proposed changes.

This spec captures the landscape, ranks candidates by **(savings potential × low risk)**, names what is already in flight, and proposes Phase 1 work (profiling harness, no behavior change) plus the recommended follow-up phases.

## Current landscape (snapshot at HEAD `25fdb35f2`)

| Component | Process model | Idle RSS (estimated) | Notes |
|-----------|--------------|----------------------|-------|
| Root `yarn dev` orchestrator (`scripts/dev.mjs`) | 1 Node | ~80 MB | Splash server (port 4000), log multiplexer, child supervisor |
| `turbo run watch --filter='./packages/*' --concurrency=32` | 1 Node (turbo) + N children | ~80 MB | Spawns one child per matching package |
| Per-package `node watch.mjs` watchers | **16 Node processes**, each loads `scripts/watch.mjs` + esbuild + glob | ~80–150 MB each → **~1.3–2.4 GB total** | Default mode is `low-memory` (one-shot rebuilds); `persistent` esbuild context costs more |
| App `mercato server dev` (Next.js + Turbopack) | 1 Node, plus Turbopack's daemon | ~1.5–3 GB | Dominant single consumer at peak; `preloadEntriesOnStart: false` already set |
| `mercato generate watch --skip-initial` | 1 Node | ~80–150 MB | Regenerates `.mercato/generated` on source changes |
| Lazy worker supervisor | 1 small Node, no worker children at idle | ~30–50 MB | Already opt-in lazy via PR #1397 / spec 2026-05-07 / spec 2026-05-13 |
| Dev splash HTTP server | shared with orchestrator | ~10 MB | Single-purpose; small |

**Total at idle ≈ 3.2–5.8 GB.** The biggest single chunks are: (a) the 16 per-package watchers, and (b) the Next.js dev server.

## Quantified candidates

> Ranked by `(estimated GB savings) × (1 / implementation risk)`. The top candidate has by far the strongest signal.

| Rank | Candidate | Savings | Risk | Status |
|------|-----------|---------|------|--------|
| **1** | **Workspace package watcher consolidation** — collapse 16 per-package watchers into a single chokidar+esbuild supervisor | **~1.0–1.5 GB** | Low (behavior-parity tests exist on the feature branch) | **PR #2102 — open, not yet merged.** This is the single biggest non-architectural intervention. |
| 2 | `NODE_OPTIONS='--max-old-space-size=N'` on the workspace watchers (until #2102 lands) | ~200–500 MB | Low (opt-in; env-controlled) | Documented in this spec — no code change needed. |
| 3 | Eager-to-lazy migration of `"use client"` files | ~300–800 MB (dev compile + RSC fanout) | High (broad blast radius; needs guardrails + generator changes) | `2026-05-13-frontend-client-boundary-ram-reduction.md` — in progress, multi-phase |
| 4 | Disable Turbopack module-graph preloading via additional `experimental.*` flags | ~100–200 MB | Medium (knobs are not stable across Next.js minor versions) | Not started; needs experiment + measurement |
| 5 | Lazy generator watch (`mercato generate watch`) — defer first run until first edit lands | ~80–150 MB | Medium (changes initial state; rare but legitimate test paths rely on generated artifacts being there at boot) | Not started |

**Headline:** the user-visible 1–2 GB target is reachable today by merging PR #2102. This PR ships the profiling harness so that ten-second proof can be reproduced.

## NODE_OPTIONS recipe (no code change; works today)

Until PR #2102 lands, the simplest knob is to cap V8's old-space-size on the workspace watchers via env inheritance:

```bash
# linux/macOS — cap each child Node process at 256 MB old-space
NODE_OPTIONS='--max-old-space-size=256' yarn dev
```

`NODE_OPTIONS` propagates to every child Node spawned by `yarn dev` (including `turbo`, the per-package `watch.mjs`, and the app server). Recommended floor: **256 MB** (V8 needs headroom for compilation peaks; 128 MB OOMs under load).

Caveats:
- **Cap applies to ALL child Node processes**, not just the watchers. The Next.js dev server may OOM under that cap. To scope it more narrowly, wrap only the watchers:
  ```bash
  # Run watchers under a low cap, leave the app server alone:
  NODE_OPTIONS='--max-old-space-size=256' yarn watch:packages &
  yarn dev:app  # unconstrained
  ```
- Once PR #2102 ships there is a single watcher process; capping it makes more sense and the per-process arithmetic disappears.

## Vite-vs-Turbopack feasibility study

**Question (from the brief):** can we migrate from Turbopack to Vite for dev mode?

**Short answer: not viable for the main Next.js 15 app. Stay on Turbopack. Defer Vite to a sidecar evaluation in a future spec.**

### Why Next.js → Vite is not viable

- Next.js 15.x supports exactly two bundlers for `next dev`: Turbopack (default) and Webpack (via the `--webpack` flag).
- Next.js's React Server Components compiler, Server Actions transform, route-handler bundling, and middleware compilation are tightly coupled to Turbopack/Webpack. There is no documented seam for a third bundler.
- Community projects that run RSC on Vite (Waku, TanStack Start, RedwoodJS) are **not drop-in compatible**. They reimplement the App Router, server actions, middleware, etc. Migrating to any of them is a full re-platforming — multiple engineer-months, breaks every route handler and `"use client"` directive in this repo (~934 client files plus 15 route handlers per the audit).
- The `--webpack` fallback is **heavier than Turbopack**, not lighter — it has known higher memory characteristics on App Router projects of this size.

### Where Vite would be useful (future spec, not this PR)

A Vite **sidecar** for component-library development would be valuable:

- Boot a Vite dev server (or a Storybook-on-Vite instance) for `packages/ui/` work only.
- Provides instant HMR on `packages/ui/src/**/*.tsx` without booting the full Next.js app.
- Estimated memory footprint: ~300–500 MB for the Vite sidecar vs ~3 GB for `yarn dev`.
- Effort: 3–5 dev-days for an MVP; would need its own spec covering tokenization, lockfile-shared dependencies, and integration with the existing component playground (if one exists).

**Verdict on the brief's "Phase 1 for dev mode":** the Phase 1 deliverable that actually helps dev mode memory today is the **profiling harness + landscape spec** shipped here, not a Vite migration. Vite migration phase 1 (sidecar) is a separate spec that should be informed by the harness numbers.

## Phase plan

**Phase 1 (this PR):** profiling harness + landscape analysis + Vite verdict.
- Adds `scripts/profile-dev-rss.mjs`, `yarn dev:profile`, `yarn dev:profile:report`.
- Documents `NODE_OPTIONS` recipe.
- Documents Vite non-viability.

**Phase 2 (immediate next):** merge PR #2102 (workspace package watcher consolidation). Run the harness before and after; post numbers on the PR. Target proof: ≥800 MB peak-RSS reduction.

**Phase 3 (data-driven):** with the harness in place, evaluate proposals against measured deltas:
- Turbopack experimental flags (per-flag A/B with the harness).
- Generator watch laziness.
- `transpilePackages` enable/disable experiment (currently commented out in `next.config.ts`).

**Phase 4 (architectural):** chain into the existing frontend client-boundary RAM-reduction work (`2026-05-13-frontend-client-boundary-ram-reduction.md`). The harness produces the success metric.

**Phase 5 (optional):** Vite sidecar for `packages/ui/` component dev — separate spec.

## Verification protocol

After this PR merges, future memory-reduction PRs should follow this protocol:

```bash
# 1. Take a baseline against the current state of develop.
git checkout develop && yarn install
yarn dev:profile baseline

# 2. Apply the proposed change (PR or env knob), restart.
git checkout <feature-branch> && yarn install
yarn dev:profile after-change

# 3. Compare.
yarn dev:profile:report
```

Paste the resulting Markdown table into the PR body. Reports are written under `.mercato/dev-rss/<label>.json` and persist across runs.

For CI memory-regression checks, the harness exposes a `--duration` flag (default 90 s); shrink to e.g. 30 s for fast CI loops and gate on the JSON `summary.peakTotalMb` field.

### 2026-06-19 issue #3065 follow-up: reliable live trace attribution

Stage 1 for issue #3065 extends the harness into shared measurement infrastructure:

- `scripts/dev-memory-sampler.mjs` is the canonical Darwin/Linux process-tree RSS sampler used by both `yarn dev:profile` and live dev memory monitoring.
- `OM_DEV_MEMORY_TRACE=1 yarn dev` emits opt-in NDJSON samples plus a final JSON summary under `.mercato/dev-rss/`, including peak RSS, dominant process class, top processes, cgroup memory when available, and lifecycle markers nearest the peak.
- Native process-tree RSS and Docker cgroup memory are reported as separate fields; they must not be collapsed into one unlabeled number.
- Stage 1 identifies the responsible process class and lifecycle phase. Source-level attribution remains a follow-up step using the peak route/phase plus Turbopack traces/import analysis.

### 2026-06-21 Next.js 16.3 canary memory signal

A local A/B smoke on `next@16.3.0-canary.59` showed a material Turbopack memory improvement, but not enough to meet the sub-1 GB target:

| Profile | Next.js | Peak total RSS | Mean RSS | Top `next-server` RSS | Dominant class |
|---------|---------|----------------|----------|------------------------|----------------|
| First full baseline | `16.2.9` | `8027.6 MB` | `4005.09 MB` | `6889.64 MB` | `next-turbopack` |
| Canary smoke | `16.3.0-canary.59` | `5820.6 MB` | `2715.26 MB` | `4580.64 MB` | `next-turbopack` |

Measured delta:

- Peak total RSS decreased by `2207 MB` (`27.5%`).
- Mean RSS decreased by `1289.83 MB` (`32.2%`).
- Top `next-server` RSS decreased by `2309 MB` (`33.5%`).

Action item: when the `16.3.x` line is released as stable, retest before upgrading. Expected impact is roughly a **30% dev-memory reduction** for this repo, but the stable release alone should not be treated as a complete fix because the canary still peaked at `5.8 GB` and remained dominated by `next-turbopack`.

### 2026-07-07 eager-graph analysis, 16.3.0-preview.5 A/B, and lazy-i18n follow-up

An esbuild-metafile analysis of `apps/mercato/src/bootstrap.ts` (static-import edges only) explained why lazy-loading module commands (#3703) produced no RSS change: the eager server-bootstrap closure was 9.96 MB / 1,391 files, of which command handlers contributed only ~85 KB post-#3703 — while 41% (4.1 MB) was all-locale i18n JSONs and ~1.1 MB was an `@open-mercato/ui` barrel leak via `customers/message-objects.ts`. Lazy code whose transitive closure is already eagerly resident (via `di.generated.ts` / `entities.generated.ts`) defers near-zero unique bytes.

Changes landed with this entry: per-locale lazy `translationsLoaders` in generated registries (additive `Module` field; `loadDictionary()` hydrates on first use), the ui-barrel deep-import fix, dynamic seed imports in `customers/setup.ts`, Next `16.2.9 → 16.3.0-preview.5`, and dev-only `experimental.turbopackMemoryEviction: 'full'` (16.3 replaced the byte-count `turbopackMemoryLimit` knob with snapshot eviction). Eager bootstrap closure after: **4.68 MB / 1,036 files (−53%)**.

Measured A/B (`profile-dev-rss.mjs`, 240 s cold boot, identical warm-route set /login, /backend, /api/auth/features, /backend/customers/people):

| Profile | Next.js | Peak total RSS | Mean RSS | Idle plateau (tail-20 mean) |
|---------|---------|----------------|----------|------------------------------|
| `baseline-16-2-9` | `16.2.9` | `7531 MB` | `2544 MB` | `1447 MB` |
| `optimized-16-3-preview` | `16.3.0-preview.5` | `7537 MB` | `2627 MB` | `1308 MB` (−10%) |

Findings: the cold-compile spike sets the peak in both runs and was unchanged — the 2026-06-21 canary deltas (−27.5% peak) **did not reproduce** on `preview.5` with this short workload. The steady-state plateau improved ~10%. The canary-retest action item above stands; peak reduction likely needs the client-boundary workstream (`2026-05-13-frontend-client-boundary-ram-reduction.md`) rather than server-graph slimming alone.

## Migration & backward compatibility

- **No contract surface is touched** by this PR.
- New script paths and npm scripts (`scripts/profile-dev-rss.mjs`, `yarn dev:profile`, `yarn dev:profile:report`) are additive.
- New report files at `.mercato/dev-rss/*.json` live under the existing gitignored `.mercato/` tree.
- `NODE_OPTIONS=--max-old-space-size=N` is a Node-builtin env knob; no code on our side reads or writes it.
- No DB, ACL, event ID, widget ID, or DI key changes.
