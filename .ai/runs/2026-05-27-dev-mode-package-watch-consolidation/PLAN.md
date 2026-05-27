# Plan — dev mode package watch consolidation

**Brief:** "Analyze the source code and find quick wins like lazy load components or so to save memory usage in the dev mode - profile it measures it do the pocs to make sure it really makes a difference at least saving 1-2Gb of memory; focus on one such a low hanging fruit that makes biggest difference and implement it as a PR."

**Mode:** Spec-implementation run (multi-phase: profile → POC → measure → implement → measure).
**Branch:** `fix/dev-mode-package-watch-consolidation`
**Source spec:** `.ai/specs/2026-05-13-frontend-client-boundary-ram-reduction.md` (this PR implements **Phase E — Dev memory defaults**, the lowest-risk slice of the spec).

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. Step ids are immutable once a Step has a commit. The first row whose `Status` is not `done` is the resume point.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Add run folder (PLAN/HANDOFF/NOTIFY) | done | b2d2341 |
| 1 | 1.2 | Add `scripts/watch-packages.mjs` consolidated watcher | done | 598c407 |
| 1 | 1.3 | Wire `yarn watch:packages` to the consolidated watcher with legacy escape hatch | done | 01d3b6e |
| 1 | 1.4 | Add `scripts/profile-dev-rss.mjs` profiling helper | done | ead9667 |
| 1 | 1.5 | Update measurement section of the source spec with Phase E status | done | 43cb86f |
| 2 | 2.1 | Unit tests for `watch-packages.mjs` (discovery + debounce + rebuild trigger) | done | dcde9b4 |

## Goal

Cut `yarn dev` resident-set-size (RSS) of the package-watch tier by ~1 GB without changing developer-facing semantics (file-change → dist rebuild for every workspace package).

## Why this is the right quick win

Empirical baseline taken from this worktree's `packages/*` source trees (18 packages, 4 182 entry-point `.ts`/`.tsx` files) using temporary scripts under `/tmp/poc-memwatch/`:

| Configuration | Processes | Idle total RSS | Per-process avg |
|---|---|---|---|
| Current default (per-package `node watch.mjs`, low-memory mode, no esbuild context held) | 18 | **1 129.3 MB** | ~62.7 MB |
| With esbuild lazy-imported in each watcher (POC `lazy-esbuild-watcher.mjs`) | 18 | 1 090.9 MB | ~60.6 MB |
| Single consolidated process watching all 18 packages (POC `consolidated-watcher.mjs`) | **1** | **124.6 MB** | — |

**Measured net savings: ~1.00 GB at idle** — this excludes the additional ~150–400 MB that Turbo + 18 `yarn run` shells consume in the current path, which we also stop paying for.

Why we did not pick alternatives:

- **Lazy-loading `ClientBootstrap.tsx` generated registries** is a bigger spec-level effort (Phase B of the source spec). Cross-route safety + hydration-order guarantees push it to a follow-up PR.
- **Making `AppProviders` server-first** is Phase B/C of the same spec — multi-PR work, not a quick win.
- **Disabling AI MCP boot in dev** would regress feature parity for developers.
- **Lazy-loading `esbuild` inside each per-package watcher** only saves ~38 MB total (POC measured) — far below the 1 GB target.

## Scope

1. New `scripts/watch-packages.mjs` — a single Node process that:
   - discovers all `packages/*` and `external/official-modules/packages/*` that have `src/` and a `watch` script in `package.json`;
   - globs entry points per package once at startup;
   - opens one recursive `fs.watch` per package `src/` directory;
   - on a change, debounces 100 ms and runs a one-shot `esbuild.build` for that package only, using the existing `createAtomicWritePlugin()` from `scripts/lib/add-js-extension.mjs`;
   - re-globs entry points when a previously unseen `.ts`/`.tsx` file is added (parity with current `watchWithOneShotBuilds()` behavior in `scripts/watch.mjs`);
   - prints `[watch] <pkg>: rebuilding…` / `[watch] <pkg>: rebuild complete` lines compatible with `scripts/dev.mjs` runtime log filters.
2. `package.json` change: `watch:packages` becomes `node ./scripts/watch-packages.mjs`. Old behavior preserved as `watch:packages:legacy` (Turbo path) and honored by env var `OM_WATCH_PACKAGES_MODE=legacy`.
3. `scripts/dev.mjs` change: replace the `yarn turbo run watch --concurrency=32 …` invocation with `yarn watch:packages` so the legacy escape hatch flows through one place.
4. New `scripts/profile-dev-rss.mjs` — a small helper that snapshots `/proc/<pid>/status` VmRSS for every child of a target PID. Used to measure before/after deltas locally and in CI smoke logs.
5. Spec changelog updated under "Initial Implementation Status" — Phase E moves to "In Progress (2026-05-27)" with a link to this PR's run folder.

## Non-goals

- No change to the per-package `node watch.mjs` scripts under `packages/*/watch.mjs` — they still work when invoked directly (e.g. `yarn workspace @open-mercato/shared watch`). Removing them would be a breaking workspace contract.
- No change to the `OM_PACKAGE_WATCH_MODE=persistent` opt-in path inside `scripts/watch.mjs`. Users who want the legacy persistent esbuild context can still set the env var when running per-package.
- No refactor of `AppProviders`, `ClientBootstrap`, or generated registries (Phases B–D of the spec).
- No turbo task graph changes for `build` / `typecheck` / `test` / `lint`. Only `watch` is consolidated.

## Risks

- **fs.watch with `recursive: true` quirks on Linux**: on some kernels, recursive watches miss deeply nested adds within the first ~30 ms after directory creation. Mitigation: re-glob entry points before every rebuild (current per-package watcher does the same).
- **`fs.watch` event coalescing**: a single editor save can emit multiple events. Mitigation: 100 ms per-package debounce, identical to the existing low-memory watcher.
- **Turbo escape hatch must keep working**: dev infra contributors used to invoking `turbo run watch` directly. Mitigation: `OM_WATCH_PACKAGES_MODE=legacy` re-runs the original Turbo command.
- **External `official-modules` packages not present in the fork-only checkout**: the new watcher must tolerate a missing `external/official-modules/packages/` directory (the submodule is optional per AGENTS.md). Mitigation: guard with `existsSync()`.

## External References

None — no `--skill-url` arguments supplied with this run.

## Verification phases

- Per-Step: targeted typecheck of `scripts/` (no package boundary crossed) plus the new Jest unit tests in `scripts/__tests__/`.
- Checkpoint after Step 1.5: focused replay of the empirical RSS measurement using `scripts/profile-dev-rss.mjs` against `yarn watch:packages` legacy vs consolidated paths, captured in `checkpoint-1-checks.md`.
- Final gate: full `yarn build:packages`, `yarn typecheck`, `yarn test`, `yarn lint`, plus `yarn i18n:check` (no string changes expected — just verifying we didn't break anything).
