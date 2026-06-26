# Execution Plan — Dev-mode watch scope selection

## Goal

Let developers choose **which workspace packages/modules the monorepo dev-mode consolidated watcher tracks**, via four selectable scope modes, controllable through an env variable, `yarn dev` / `yarn dev:greenfield` CLI flags, and an interactive picker.

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

- No change to Turbopack/Next.js app watching. App source is still fully watched by the framework — scope governs the monorepo **workspace-package** watcher only.
- No change to the legacy Turbo per-package watcher path (`OM_WATCH_PACKAGES_MODE=legacy`); scope only applies to the consolidated watcher.
- No new production dependencies.

## Risks

- `auto-optimized` could under-watch if git detection misses a package; mitigated by 2-minute auto-expansion and an honest startup log of what is/ isn't watched.
- Template parity: `dev.mjs` must stay byte-synced with the template copy (`scripts/template-sync.ts`). Mitigated by running the sync `--fix` and verifying with the parity test.
- Git calls must be resilient (non-repo, shallow clone, no base ref). Mitigated by injectable `runGit` + fail-open to `all`/fallback.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Core watch-scope module

- [x] 1.1 Add `scripts/watch-scope.mjs` (pure scope resolution, git detection, popular ranking, persisted selection helpers) — f27a2fe9b
- [x] 1.2 Add `scripts/__tests__/watch-scope.test.mjs` unit tests — f27a2fe9b

### Phase 2: Wire scope into the consolidated watcher

- [x] 2.1 Filter watched packages by resolved scope in `runConsolidatedWatch`; add auto-optimized 2-minute expansion loop — 7f9815bad
- [x] 2.2 Extend `scripts/__tests__/watch-packages.test.mjs` for scope filtering + auto-expansion — 7f9815bad

### Phase 3: dev.mjs flag plumbing + interactive selector

- [x] 3.1 Parse `--watch=<mode>` flags in `scripts/dev.mjs` and inject scope env into the spawned watcher — c38d3eb6c
- [x] 3.2 Add `scripts/watch-select.mjs` interactive picker + `dev:watch-select` script — c38d3eb6c
- [x] 3.3 Unit-test the selector's pure input-parsing helper — c38d3eb6c

### Phase 4: Template sync

- [x] 4.1 Mirror `dev.mjs` and its required `watch-scope.mjs` helper into the template via `scripts/template-sync.ts` — 6e1c5085d

### Phase 5: Docs + upgrade notes

- [x] 5.1 Document the modes in `apps/docs/docs/appendix/troubleshooting.mdx` (dev watcher section) — 88d79c49e
- [x] 5.2 Add an UPGRADE_NOTES.md entry under the current unreleased window — 88d79c49e

## Changelog

- All phases complete — PR #3648 (feat/dev-watch-scope-selection → develop). Full gate green (build:packages → generate → build:packages → build:app, typecheck, i18n, test:scripts 294). One pre-existing environmental cli flake (`integration.test.ts:486`) that passes in isolation and is unrelated to this change.
