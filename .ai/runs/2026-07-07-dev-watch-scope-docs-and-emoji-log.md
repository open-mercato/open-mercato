# Dev watch-scope: env docs + memory-optimization docs + emoji log

## Goal

Make the dev-mode watch-scope memory optimization discoverable and pleasant: document `OM_WATCH_SCOPE` in `.env.example`, point README/docs at it near `yarn dev`, and display the active watch mode with a friendly emoji in the dev log.

## Overview

The consolidated package watcher already supports narrowing which packages it tracks via `OM_WATCH_SCOPE` (`all` | `auto-optimized` | `popular` | `env`), which is the main lever for reducing dev-mode memory usage. The behavior is fully implemented (`scripts/watch-scope.mjs`, `scripts/watch-packages.mjs`, `scripts/dev.mjs`) and documented in `apps/docs/docs/appendix/troubleshooting.mdx`, but:

- It is missing from `apps/mercato/.env.example` and the create-app template `.env.example`, so users never discover it.
- README's `yarn dev` section does not mention the memory-optimization lever.
- The dev log only prints the scope when it is non-`all`, and without any emoji/visual cue.

### External References

None (no `--skill-url` provided).

## Scope

- `apps/mercato/.env.example` — add a documented `OM_WATCH_SCOPE` block (+ related `OM_WATCH_*` vars).
- `packages/create-app/template/.env.example` — mirror the same block (kept in sync with mercato).
- `README.md` — add a short memory-optimization note near the `yarn dev` guidance, linking troubleshooting docs.
- `apps/docs/docs/installation/setup.mdx` (or nearest `yarn dev` doc) — add a memory-optimization callout pointing at the watch-scope section.
- `scripts/watch-scope.mjs` — add exported `describeWatchMode()` / emoji map (pure, testable). Mirror into `packages/create-app/template/scripts/watch-scope.mjs` (kept identical).
- `scripts/dev.mjs` + `packages/create-app/template/scripts/dev.mjs` — always print the active watch mode with an emoji.
- `scripts/watch-packages.mjs` — use the emoji-decorated mode in its scope log line.
- `scripts/__tests__/watch-scope.test.mjs` — unit tests for `describeWatchMode()`.

### Non-goals

- No change to watch-scope selection logic or defaults (`all` stays the default).
- No new env vars or CLI flags.
- No rewrite of the existing troubleshooting doc section (only cross-links added).

## Risks

- Emoji rendering in non-UTF8 terminals — mitigated by keeping the plain mode name alongside the emoji.
- Template/root drift for `watch-scope.mjs` (currently byte-identical) — mirror edits and keep them identical.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Emoji watch-mode log + tests

- [x] 1.1 Add `describeWatchMode()` + emoji map to `scripts/watch-scope.mjs`, mirror into create-app template — aaca79853
- [x] 1.2 Use emoji mode in `scripts/dev.mjs` + template `dev.mjs` (always show) and `scripts/watch-packages.mjs` — aaca79853
- [x] 1.3 Add unit tests for `describeWatchMode()` in `scripts/__tests__/watch-scope.test.mjs` — aaca79853

### Phase 2: env.example documentation

- [x] 2.1 Add documented `OM_WATCH_SCOPE` block to `apps/mercato/.env.example` and template `.env.example` — 8080bad6d

### Phase 3: README + docs memory-optimization guidance

- [x] 3.1 Add memory-optimization note near `yarn dev` in `README.md` — 98a032be5
- [x] 3.2 Add memory-optimization callout/cross-link in the installation docs — 98a032be5
- [x] Post-review fix: remove stray `ded` token breaking `AdvancedFilterPanel` typecheck in the CI `test` job (pre-existing on develop) — 0c528c139
