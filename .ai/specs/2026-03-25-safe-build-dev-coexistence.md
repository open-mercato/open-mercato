# Safe Package Verification Build

**Status**: Draft
**Date**: 2026-03-25
**Author**: Agent

## TLDR

Add `yarn build:check` so package verification builds write to `dist-check/` instead of `dist/`.

This spec does **not** change `yarn dev`, watchers, runtime reuse, or local-dev state files. The only goal is to stop verification builds from deleting or overwriting the live artifacts that a running dev session depends on.

## Overview

Today, `yarn build:packages` writes directly to `packages/*/dist/`. That is fine for normal builds, but it is unsafe as a verification command while `yarn dev` is already running because package watchers also own `dist/`.

The fix is to add an isolated verification build output:

- normal builds keep using `dist/`
- verification builds use `dist-check/`

This keeps the current development workflow intact while removing the filesystem conflict.

## Problem Statement

When a developer or agent runs a package build for verification during an active dev session, the build rewrites the same `dist/` tree that watch mode produced.

That creates two concrete failures:

1. live dev artifacts can be deleted or overwritten during verification
2. the running app can start reading partially rewritten or stale compiled files

The problem is not `yarn dev` itself. The problem is that verification builds and dev builds currently share the same output directory.

## Goals

- Make package verification builds safe to run while `yarn dev` is active.
- Leave `yarn dev`, `watch:packages`, and normal `build:packages` behavior unchanged.
- Keep the implementation small and limited to build output isolation.
- Cover all current `packages/*/build.mjs` variants, including post-build rewrite and asset-copy steps.

## Non-Goals

- Changing `yarn dev`
- Adding `.ai/dev-env.json` or any local runtime reuse feature
- Reworking Turbo, watcher internals, or Next.js dev behavior
- Changing published package outputs

## Proposed Solution

Introduce a new root command:

```jsonc
"build:check": "cross-env OM_BUILD_OUTDIR=dist-check turbo run build --filter='./packages/*'"
```

Each package `build.mjs` must respect `OM_BUILD_OUTDIR` for **all** output operations, not only the main esbuild target.

Required behavior:

- default output remains `dist`
- when `OM_BUILD_OUTDIR=dist-check`, the build writes only to `dist-check`
- no part of `build:check` may touch `dist`

## Architecture

### Output directory contract

Every package build script must derive one output directory name:

```js
const outputDirName = process.env.OM_BUILD_OUTDIR?.trim() || 'dist'
const outdir = join(__dirname, outputDirName)
```

That same resolved output path must be used for:

- esbuild `outdir`
- post-build glob rewrites such as `glob('dist/**/*.js')`
- copied assets such as `src/**/*.json`
- nested generated outputs such as `dist/generated`

### Root command behavior

- `yarn build:packages` stays unchanged and continues writing to `dist/`
- `yarn build:check` is verification-only and writes to `dist-check/`
- `yarn dev` remains unchanged and continues using watcher-owned `dist/`

## Data Models

No database changes.

The only state model is filesystem-based:

- `dist/` is the runtime-authoritative output
- `dist-check/` is disposable verification output

## API Contracts

No HTTP API contracts change.

One additive CLI contract is introduced:

- new root script: `yarn build:check`

## UI/UX

No product UI changes.

Developer workflow change:

- use `yarn build:check` when the intent is “verify packages compile without touching the live dev artifacts”

## Risks & Impact Review

### High Risks

| Risk | Failure Scenario | Impact | Mitigation |
|------|------------------|--------|------------|
| Incomplete outdir redirection | A package still hardcodes `dist` in a glob, copy step, or nested output | `build:check` still mutates live artifacts or emits incomplete `dist-check` output | Update every `packages/*/build.mjs` to derive all output paths from the same resolved outdir |
| Incomplete package inventory | Only a subset of package build scripts are updated | `build:check` appears to work, but some packages still break dev | Explicitly cover every current `packages/*/build.mjs` file |
| False safety claim | Docs tell agents to use `build:check`, but the command still writes to `dist` in some packages | Dev sessions still break despite the new command | Add verification coverage for representative build script variants |

### Medium Risks

| Risk | Failure Scenario | Impact | Mitigation |
|------|------------------|--------|------------|
| Cross-platform env setting | POSIX-style env assignment fails on native Windows | `build:check` is not portable | Use `cross-env` |
| `dist-check/` accumulation | Verification artifacts remain in worktrees | Mild confusion and disk usage | Add `dist-check/` to `.gitignore` |
| Future package drift | A new package adds `build.mjs` and ignores `OM_BUILD_OUTDIR` | Safety regression returns later | Document the rule in AGENTS and package authoring guidance |

## Affected Files

### Root files

- `package.json`
- `.gitignore`
- `AGENTS.md`
- `packages/cli/AGENTS.md`

### Package build scripts

- `packages/ai-assistant/build.mjs`
- `packages/cache/build.mjs`
- `packages/checkout/build.mjs`
- `packages/cli/build.mjs`
- `packages/content/build.mjs`
- `packages/core/build.mjs`
- `packages/create-app/build.mjs`
- `packages/enterprise/build.mjs`
- `packages/events/build.mjs`
- `packages/gateway-stripe/build.mjs`
- `packages/onboarding/build.mjs`
- `packages/queue/build.mjs`
- `packages/scheduler/build.mjs`
- `packages/search/build.mjs`
- `packages/shared/build.mjs`
- `packages/sync-akeneo/build.mjs`
- `packages/ui/build.mjs`
- `packages/webhooks/build.mjs`

## Migration & Backward Compatibility

### CLI Commands

- `yarn build`, `yarn build:packages`, and `yarn dev` are not renamed or removed.
- `yarn build:check` is additive only.

### Runtime Behavior

- `dist/` remains the only output consumed by the live dev/runtime flow.
- `dist-check/` is verification-only and must not be used by the app runtime.

### Failure Handling

- If `build:check` fails, existing build and dev workflows remain unchanged.
- If `build:check` is never used, the repository behaves exactly as it does today.

## Phasing

### Phase 1 — Add the safe verification command

- add `build:check`
- add `dist-check/` to `.gitignore`

### Phase 2 — Update every package build script

- redirect esbuild output
- redirect post-build JS rewrites
- redirect asset copies
- redirect nested generated output paths

### Phase 3 — Document the safe verification path

- update agent guidance to use `yarn build:check` for verification-only builds

## Implementation Plan

1. Add `build:check` to root `package.json` using `cross-env`.
2. Add `dist-check/` to `.gitignore`.
3. Update all package `build.mjs` files to derive output paths from `OM_BUILD_OUTDIR`.
4. Verify representative package script patterns:
   - JS rewrite only
   - JSON copy
   - nested generated output
   - atypical relative path handling
5. Update documentation and AGENTS guidance to point verification-only workflows to `yarn build:check`.

## Test Plan

### Automated coverage

- [ ] Verify representative package builds succeed with `OM_BUILD_OUTDIR=dist-check`
- [ ] Verify copied assets appear in `dist-check/` where applicable
- [ ] Verify nested generated outputs appear under `dist-check/`

### Manual verification

- [ ] Start `yarn dev`, then run `yarn build:check` in another terminal
- [ ] Confirm the dev app remains healthy
- [ ] Confirm package `dist/` contents are not modified by `build:check`
- [ ] Confirm `dist-check/` is populated
- [ ] Confirm `dist-check/` is gitignored
- [ ] Confirm `yarn build:packages` still behaves exactly as before

## Final Compliance Report

- [x] TLDR & Overview included
- [x] Problem Statement included
- [x] Proposed Solution included
- [x] Architecture included
- [x] Data Models included
- [x] API Contracts included
- [x] UI/UX included
- [x] Risks & Impact Review included
- [x] Phasing included
- [x] Implementation Plan included
- [x] Integration Test Coverage included
- [x] Migration & Backward Compatibility included
- [x] Changelog included

## Changelog

| Date | Change |
|------|--------|
| 2026-03-23 | Initial draft |
| 2026-03-23 | Expanded into a broader build/dev coexistence draft |
| 2026-03-25 | Simplified scope to a single fix: `build:check` must isolate verification outputs and never touch live `dist/` artifacts |
