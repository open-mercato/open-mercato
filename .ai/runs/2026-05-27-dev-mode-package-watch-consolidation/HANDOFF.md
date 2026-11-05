# Handoff — 2026-05-27 dev-mode-package-watch-consolidation

**Last updated:** 2026-05-27T05:55:00Z
**Branch:** fix/dev-mode-package-watch-consolidation
**PR:** opening now (see Step 9 below)
**Current phase/step:** complete — all 6 Steps `done`
**Last commit:** `fe26f3c test(dev): cover consolidated watcher discovery and rebuild dispatch`

## What just happened

- Implemented the consolidated workspace package watcher (Phase E of the frontend RAM reduction spec).
- Measured ~1.10 GB net idle RSS savings on this monorepo: 1 188 MB (per-package fan-out) → 91 MB (single consolidated process).
- Added Linux RSS profiling helper (`scripts/profile-dev-rss.mjs`) and an opt-in legacy escape hatch via `OM_WATCH_PACKAGES_MODE=legacy`.
- All 143 node `--test` cases pass (7 new ones cover the watcher itself, 1 new one covers the log-noise predicate).

## Next concrete action

- Open the PR against `develop` per the auto-create-pr-loop step 9 protocol.

## Blockers / open questions

- None.

## Environment caveats

- Dev runtime runnable: **no** — janitor sandbox has no Postgres/Redis and `yarn install` was not run. CI is the build/typecheck/integration gate.
- Playwright / browser checks: skipped (no UI touched).
- Database/migration state: clean (no DB changes).

## Worktree

- Path: `/home/pkarw/Projects/github-janitor/.janitor/repos/open-mercato__open-mercato/worktrees/2b7952ad-219e-4dce-9755-8dce291d54c5`
- Created this run: no — reusing the janitor worktree.
