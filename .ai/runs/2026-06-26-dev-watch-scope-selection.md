# Execution Plan — Dev-mode watch scope selection

## Goal

Let developers choose **which workspace packages/modules the dev-mode consolidated watcher tracks**, via four selectable scope modes, controllable through an env variable, `yarn dev` / `yarn dev:greenfield` CLI flags, and an interactive picker — for both the monorepo and standalone (create-app template) runtimes.

## Background

- The consolidated watcher `scripts/watch-packages.mjs` (`runConsolidatedWatch`) currently watches **every** workspace package with a `watch` script + `src/` dir (monorepo `packages/*` and `external/official-modules/packages/*`).
- `scripts/dev.mjs` spawns it via `yarn watch:packages` in `startPackageWatch()`. `dev.mjs` is mirrored into the standalone template via `scripts/template-sync.ts`.
- The watch unit is the **workspace package** (short label = package dir basename, e.g. `core`, `ui`, `shared`, `ai-assistant`). That is the "module" a developer thinks of when picking what to watch.

## Scope modes

| Mode (`OM_WATCH_SCOPE`) | Behavior |
|---|---|
| `all` (default) | Watch every discovered package. Current behavior, fully backward compatible. |
| `auto-optimized` | Watch only packages **touched recently** — derived from the git working tree (`git status`) and the current branch's diff vs a base ref. Re-checks every 2 minutes and **expands** watchers to newly-touched packages (never shrinks). |
| `popular` | Watch only the **most frequently changed** packages (ranked from recent `git log` history), capped by a limit; static fallback (`core`, `ui`, `shared`) when history is unavailable. |
| `env` | Watch exactly the packages listed in `OM_WATCH_PACKAGES` (or the interactive picker's persisted selection). |

Mode selection precedence: CLI flag (`--watch=<mode>` / `--watch-<mode>` shorthands) > `OM_WATCH_SCOPE` env > default `all`.

## Non-goals

- No change to Turbopack/Next.js app watching (the standalone app body is still fully watched by the framework — scope governs the **workspace-package** watcher only).
- No change to the legacy Turbo per-package watcher path (`OM_WATCH_PACKAGES_MODE=legacy`); scope only applies to the consolidated watcher.
- No new production dependencies.

## Risks

- `auto-optimized` could under-watch if git detection misses a package; mitigated by 2-minute auto-expansion and an honest startup log of what is/ isn't watched.
- Template parity: `dev.mjs` must stay byte-synced with the template copy (`scripts/template-sync.ts`). Mitigated by running the sync `--fix` and verifying with the parity test.
- Git calls must be resilient (non-repo, shallow clone, no base ref). Mitigated by injectable `runGit` + fail-open to `all`/fallback.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Core watch-scope module

- [ ] 1.1 Add `scripts/watch-scope.mjs` (pure scope resolution, git detection, popular ranking, persisted selection helpers)
- [ ] 1.2 Add `scripts/__tests__/watch-scope.test.mjs` unit tests

### Phase 2: Wire scope into the consolidated watcher

- [ ] 2.1 Filter watched packages by resolved scope in `runConsolidatedWatch`; add auto-optimized 2-minute expansion loop
- [ ] 2.2 Extend `scripts/__tests__/watch-packages.test.mjs` for scope filtering + auto-expansion

### Phase 3: dev.mjs flag plumbing + interactive selector

- [ ] 3.1 Parse `--watch=<mode>` flags in `scripts/dev.mjs` and inject scope env into the spawned watcher
- [ ] 3.2 Add `scripts/watch-select.mjs` interactive picker + `dev:watch-select` script
- [ ] 3.3 Unit-test the selector's pure input-parsing helper

### Phase 4: Standalone template sync

- [ ] 4.1 Mirror `dev.mjs`, `watch-scope.mjs`, `watch-select.mjs` into the template via `scripts/template-sync.ts`; add template `dev:watch-select` script

### Phase 5: Docs + upgrade notes

- [ ] 5.1 Document the modes in `apps/docs/docs/appendix/troubleshooting.mdx` (dev watcher section)
- [ ] 5.2 Add an UPGRADE_NOTES.md entry under the current unreleased window
