# Handoff — 2026-05-27 dev-mode-package-watch-consolidation

**Last updated:** 2026-05-27T05:45:00Z
**Branch:** fix/dev-mode-package-watch-consolidation
**PR:** not yet opened
**Current phase/step:** Phase 1 Step 1.2 (consolidated watcher script)
**Last commit:** none yet — run folder commit imminent

## What just happened

- Profiled the per-package watcher tier under `/tmp/poc-memwatch/` against this worktree's `packages/*`.
- Measured idle RSS: 18 separate `node watch.mjs` processes use 1 129 MB; one consolidated process watching the same 18 packages uses 125 MB. Net win ≈ 1.0 GB.
- Locked the chosen quick win: replace `turbo run watch --concurrency=32 …` with a single-process consolidated watcher, behind an `OM_WATCH_PACKAGES_MODE=legacy` escape hatch.

## Next concrete action

- Implement `scripts/watch-packages.mjs` (Step 1.2): discover packages, glob entry points, open one `fs.watch` per `src/`, debounce, run one-shot `esbuild.build` per change using `createAtomicWritePlugin`.

## Blockers / open questions

- None.

## Environment caveats

- Dev runtime runnable: **no** — janitor sandbox has no Postgres/Redis and `yarn install` is not yet run for this worktree. POC measurements were taken with `node_modules` symlinked from a sibling worktree (only `esbuild` + `glob` needed, both stable across the lockfile delta).
- Playwright / browser checks: skipped for this PR (no UI surfaces touched).
- Database/migration state: clean (no DB work).

## Worktree

- Path: `/home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/2b7952ad-219e-4dce-9755-8dce291d54c5`
- Created this run: no — reusing the janitor worktree the task spawned in.
