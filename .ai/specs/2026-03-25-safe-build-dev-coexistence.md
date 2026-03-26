# Build Partition Isolation For Dev, Ephemeral, and Verification

**Status**: Draft
**Date**: 2026-03-25
**Author**: Agent

## TLDR

Introduce explicit package build partitions so different workflows stop sharing the same compiled artifacts:

- default/local runtime partition: `dist/`
- verification partition: `dist-check/`
- ephemeral runtime partition: `dist-ephemeral/`

`yarn dev` keeps using `dist/`.
`yarn build:check` writes only to `dist-check/`.
`yarn dev:ephemeral` and ephemeral integration runtimes build and consume only `dist-ephemeral/`.

Ephemeral builds may be reused by later ephemeral runs, but never by local dev.

## Overview

Today three different intents all compete for the same package output tree:

1. local development runtime (`yarn dev`, watchers, app dev server)
2. verification builds (`yarn build:packages` run as a compile check)
3. ephemeral environments (`yarn dev:ephemeral`, `mercato test:ephemeral`, `mercato test:integration`)

All three paths currently mutate or depend on `packages/*/dist/`.

That is safe only when they run one at a time. It is unsafe when a local dev session is already alive and an agent or ephemeral environment rebuilds packages in parallel.

This specification separates those artifact owners with explicit partitions and extends the design beyond build output alone. The key missing piece in the earlier draft was runtime resolution: ephemeral commands must not merely write to a different folder, they must also load from that folder and cache against that folder.

## Problem Statement

The current model has a single compiled artifact namespace: `dist/`.

That creates three classes of failure:

1. verification builds can overwrite watcher-owned local-dev artifacts
2. ephemeral commands can rebuild packages and disturb a live local-dev session
3. ephemeral reuse logic can accidentally treat locally built artifacts as valid reusable inputs

The current repo already separates some ephemeral metadata:

- dev ephemeral process registry in `.ai/dev-ephemeral-envs.json`
- integration ephemeral build cache in `.ai/qa/ephemeral-build-cache.json`

But the compiled package artifacts themselves are still shared. Metadata isolation without artifact isolation is not enough.

## Goals

- Make verification builds safe while `yarn dev` is running.
- Make ephemeral runtimes safe while `yarn dev` is running.
- Allow consecutive ephemeral runs to reuse ephemeral-owned artifacts only.
- Keep published package output and standalone-app expectations unchanged.
- Keep command compatibility additive: no rename/removal of existing root commands.
- Centralize output-directory resolution so new packages do not regress the partition model.

## Non-Goals

- Replacing Turbo with a different task runner
- Introducing remote Turbo cache behavior for builds
- Changing published npm package exports away from `dist/`
- Changing standalone apps to prefer non-default partitions by default
- Reworking Next.js `.next` output handling

## Proposed Solution

### Build partition contract

Introduce a shared build-partition contract used by both producers and consumers.

Public selector:

- `OM_BUILD_PARTITION`

Supported values:

- unset or `default` -> `dist`
- `check` -> `dist-check`
- `ephemeral` -> `dist-ephemeral`

Low-level override:

- `OM_BUILD_OUTDIR`

Rules:

- named commands must set `OM_BUILD_PARTITION`, not raw `OM_BUILD_OUTDIR`
- build scripts may support `OM_BUILD_OUTDIR` as an escape hatch
- if `OM_BUILD_PARTITION` is set, runtime/tooling consumers must resolve the corresponding partition path
- ephemeral consumers must fail closed if `dist-ephemeral/` is missing or stale; they must not silently fall back to `dist/`

### Command model

Existing commands stay valid:

- `yarn dev`
- `yarn build`
- `yarn build:packages`
- `yarn dev:ephemeral`
- `yarn test:integration:ephemeral*`

New additive commands:

```jsonc
"build:check": "cross-env OM_BUILD_PARTITION=check turbo run build --filter='./packages/*'",
"build:packages:ephemeral": "cross-env OM_BUILD_PARTITION=ephemeral turbo run build --filter='./packages/*'"
```

Behavior:

- `yarn build:packages` continues writing to `dist/`
- `yarn build:check` writes only to `dist-check/`
- `yarn build:packages:ephemeral` writes only to `dist-ephemeral/`
- `yarn dev` continues using watcher-owned `dist/`
- `yarn dev:ephemeral` and ephemeral integration commands use `dist-ephemeral/` end-to-end

### Runtime/tooling resolution

The earlier `dist-check` proposal covered only build output redirection. That is insufficient for ephemeral workflows.

This spec requires a shared resolver helper used by:

- package `build.mjs` scripts
- CLI bin loaders
- root `mercato` script wiring
- integration ephemeral build-artifact checks
- any code that currently assumes `dist/` for compiled package modules

The helper returns:

- `partition`
- `outdirName`
- `outdirAbs`
- `isEphemeralPartition`

Example contract:

```ts
type BuildPartition = 'default' | 'check' | 'ephemeral'

type ResolvedBuildPartition = {
  partition: BuildPartition
  outdirName: 'dist' | 'dist-check' | 'dist-ephemeral'
}
```

## Architecture

### 1. Output ownership model

Each output tree has exactly one intended owner:

- `dist/`
  - owner: local dev and standard build/publish flow
  - consumed by: normal `yarn dev`, `yarn build`, publish workflows, standalone expectations
- `dist-check/`
  - owner: verification-only package builds
  - consumed by: nobody at runtime
- `dist-ephemeral/`
  - owner: ephemeral runtimes and ephemeral integration workflows
  - consumed by: `dev:ephemeral`, `mercato test:ephemeral`, `mercato test:integration`, related ephemeral helpers

### 2. Producer requirements

Every `packages/*/build.mjs` must derive all output paths from the same resolved partition.

That includes:

- esbuild `outdir`
- post-build glob rewrites
- copied JSON/assets
- nested generated outputs such as `generated/`
- copied agentic/static assets
- executable shim post-processing such as `bin.js`

Representative examples already known to require conversion:

- simple JS rewrite passes
- JSON copy steps
- nested `dist/generated`
- create-app and CLI asset-copy builds

### 3. Consumer requirements

The following consumers must stop hardcoding `dist/`:

- root `package.json` `mercato` launcher
- `packages/cli/bin/mercato`
- any create-app launcher equivalents that load `dist/index.js`
- CLI helpers that validate `dist/modules/*`
- integration artifact lists used for ephemeral cache validity

The preferred implementation is:

1. route root launchers through a partition-aware bin stub
2. make bin stubs resolve the active partition output
3. make validation/discovery helpers accept the resolved partition output directory

### 4. Ephemeral reuse model

Ephemeral reuse is allowed only within the ephemeral partition.

That means:

- local dev never reads `dist-ephemeral/`
- local dev never writes `dist-ephemeral/`
- ephemeral commands never treat `dist/` as reusable build state when `OM_BUILD_PARTITION=ephemeral`

Recommended state model:

- unify ephemeral build-cache metadata under one partition-aware manifest, or
- keep separate manifests but ensure both reference `dist-ephemeral/` only

In either case, reuse validity must include:

- source fingerprint
- partition name
- artifact timestamps or presence checks for `dist-ephemeral/`

### 5. Ephemeral command propagation

`yarn dev:ephemeral` must export `OM_BUILD_PARTITION=ephemeral` into:

- package build step
- generator step
- initialize step
- app runtime process

The same rule applies inside CLI-managed ephemeral integration workflows.

This matters because app-level scripts (`mercato generate`, `mercato init`, `mercato server dev/start`) go through the CLI, and the CLI must resolve the same partition consistently.

### 6. Turbo behavior

Turbo build caching remains disabled.

This spec does not rely on Turbo cache for partition reuse.
Partition reuse remains an explicit local reuse policy managed by ephemeral helpers and manifest files.

## Data Models

No database schema changes.

Filesystem/runtime state introduced or extended:

- package output trees:
  - `packages/*/dist/`
  - `packages/*/dist-check/`
  - `packages/*/dist-ephemeral/`
- ephemeral build-cache manifest:
  - existing `.ai/qa/ephemeral-build-cache.json` may be extended or replaced with a partition-aware equivalent
- existing `.ai/dev-ephemeral-envs.json` remains the dev-ephemeral runtime registry

## API Contracts

No HTTP API contracts change.

Additive CLI/root command contracts:

- new root script: `yarn build:check`
- new root script: `yarn build:packages:ephemeral`

Existing command behavior remains stable from the user’s perspective:

- `yarn dev` still starts normal dev
- `yarn dev:ephemeral` still starts an ephemeral runtime
- `yarn test:integration:ephemeral*` still starts ephemeral integration flows

The difference is the partition they build and consume internally.

## UI/UX

No product UI changes.

Developer workflow changes:

- use `yarn build:check` for compile verification during local dev
- let `yarn dev:ephemeral` and ephemeral integration commands own `dist-ephemeral/`
- do not use `yarn build:packages` as a generic safe verification command during active dev if the intent is only validation

Console output should make the active partition explicit, for example:

- `[build] partition=check outdir=dist-check`
- `[dev:ephemeral] partition=ephemeral outdir=dist-ephemeral`
- `[integration] reusing ephemeral partition dist-ephemeral`

## Risks & Impact Review

### High Risks

| Risk | Failure Scenario | Impact | Mitigation |
|------|------------------|--------|------------|
| Incomplete producer conversion | One package still rewrites or copies into `dist/` while ephemeral/check builds are active | Shared artifacts are still mutated; safety claim becomes false | Update every `packages/*/build.mjs` to derive all output paths from the shared resolver |
| Incomplete consumer conversion | CLI stubs, discovery helpers, or cache checks still read `dist/` during ephemeral mode | Ephemeral commands either fail unexpectedly or cross-contaminate local-dev artifacts | Inventory and convert every `dist` consumer that participates in ephemeral workflows |
| Silent fallback from ephemeral to default | An ephemeral command cannot find `dist-ephemeral/` and quietly reads `dist/` instead | Ephemeral reuse is no longer isolated from local dev | In ephemeral mode, fail closed or trigger a rebuild of `dist-ephemeral/`; never fall back silently |

### Medium Risks

| Risk | Failure Scenario | Impact | Mitigation |
|------|------------------|--------|------------|
| Root launcher remains hardcoded | Root `mercato` script still points directly at `packages/cli/dist/bin.js` | Partition-aware CLI loader is bypassed | Route root launcher through a partition-aware stub |
| Manifest drift | Ephemeral cache manifest says artifacts are reusable, but checks still point at `dist/` | Reuse logic becomes misleading and flaky | Include partition name and partition-specific artifact paths in cache state |
| Disposable partition buildup | `dist-check/` and `dist-ephemeral/` accumulate in many packages | Disk usage and worktree noise | Add both to `.gitignore` and cleanup scripts |

### Low Risks

| Risk | Failure Scenario | Impact | Mitigation |
|------|------------------|--------|------------|
| Standalone confusion | Developers assume standalone apps also default to non-`dist` partitions | Mild confusion | Document that standalone/published artifacts still use `dist/` unless explicitly overridden |

## Affected Files

### Root files

- `package.json`
- `.gitignore`
- `AGENTS.md`
- `packages/cli/AGENTS.md`
- `.ai/qa/AGENTS.md`

### Shared helper / launcher files

- new helper such as `scripts/lib/build-partitions.mjs`
- `packages/cli/bin/mercato`
- `packages/create-app/bin/create-mercato-app` if partition-aware loading is required there

### Ephemeral/runtime orchestration

- `scripts/dev-ephemeral.ts`
- `packages/cli/src/lib/testing/integration.ts`
- `packages/cli/src/lib/module-package.ts`
- any helper that validates build artifacts for ephemeral reuse

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

### CLI commands

- `yarn build`, `yarn build:packages`, `yarn dev`, `yarn dev:ephemeral`, and integration commands are not renamed or removed.
- `yarn build:check` and `yarn build:packages:ephemeral` are additive only.

### Published package/runtime behavior

- Published packages continue exporting `dist/`.
- Standalone apps continue expecting `dist/` by default.
- The new partition logic changes only how monorepo workflows build and resolve internal artifacts when specific commands opt into a partition.

### Failure handling

- If `build:check` fails, local dev remains unchanged.
- If `build:packages:ephemeral` fails, local `dist/` remains unchanged.
- If an ephemeral command starts with missing or stale `dist-ephemeral/`, it must rebuild or fail clearly; it must not consume `dist/`.

## Phasing

### Phase 1 — Shared partition contract

- add shared resolver for `OM_BUILD_PARTITION`
- add `build:check`
- add `build:packages:ephemeral`
- add `dist-check/` and `dist-ephemeral/` to `.gitignore`

### Phase 2 — Convert all package producers

- update every `packages/*/build.mjs`
- redirect all rewrite/copy/generated steps through resolved outdir

### Phase 3 — Convert runtime and tooling consumers

- make CLI bin loaders partition-aware
- make root `mercato` launcher partition-aware
- update module/discovery helpers that assume `dist/modules`
- update any artifact validation code that assumes `dist/index.js`

### Phase 4 — Ephemeral orchestration and reuse

- update `dev:ephemeral` to use `build:packages:ephemeral`
- propagate `OM_BUILD_PARTITION=ephemeral` into `generate`, `initialize`, and runtime startup
- update integration ephemeral workflows to use `dist-ephemeral/`
- make cache manifests partition-aware and ephemeral-only

### Phase 5 — Verification and docs

- verify parallel local dev + `build:check`
- verify parallel local dev + `dev:ephemeral`
- verify parallel local dev + ephemeral integration tests
- document command intent and partition ownership

## Implementation Plan

1. Add a plain JS shared helper for build partition resolution that can be imported from `build.mjs` and launcher scripts.
2. Add root scripts for `build:check` and `build:packages:ephemeral`.
3. Update all package build scripts so every output path comes from the shared helper.
4. Route root and package CLI launchers through partition-aware loaders.
5. Update ephemeral runtime scripts to set and propagate `OM_BUILD_PARTITION=ephemeral`.
6. Update integration ephemeral cache logic so it validates and reuses only `dist-ephemeral/`.
7. Update docs and AGENTS guidance to explain command intent:
   - `build:packages` for default/live artifacts
   - `build:check` for verification-only artifacts
   - `build:packages:ephemeral` for ephemeral-owned artifacts

## Test Plan

### Automated coverage

- [ ] Unit test partition resolver mapping:
  - default -> `dist`
  - check -> `dist-check`
  - ephemeral -> `dist-ephemeral`
- [ ] Verify representative package build variants succeed in all supported partitions
- [ ] Verify CLI/bin loader resolves the correct partition path
- [ ] Verify integration cache state stores partition-specific artifact references

### Manual verification matrix

- [ ] Start `yarn dev`, then run `yarn build:check`
  - confirm `dist/` is unchanged
  - confirm `dist-check/` is populated
- [ ] Start `yarn dev`, then run `yarn dev:ephemeral`
  - confirm local dev remains healthy
  - confirm ephemeral runtime uses `dist-ephemeral/`
- [ ] Start `yarn dev`, then run `yarn test:integration:ephemeral`
  - confirm local dev remains healthy
  - confirm integration ephemeral uses `dist-ephemeral/`
- [ ] Run two consecutive ephemeral commands
  - confirm the second run reuses `dist-ephemeral/` when valid
  - confirm no reuse path touches local `dist/`
- [ ] Confirm `yarn build:packages` still behaves exactly as before
- [ ] Confirm standalone app and publish workflows still rely on `dist/`

## Integration Test Coverage

This feature is infrastructure/orchestration, not a user-facing module. Coverage must still include the key command and reachable app paths.

### Command paths

- `yarn build:check`
- `yarn build:packages:ephemeral`
- `yarn dev:ephemeral`
- `yarn test:integration:ephemeral`

### Runtime paths

- local dev app remains reachable at `/backend`
- ephemeral dev app remains reachable at its printed `/backend` URL
- ephemeral integration runtime remains reachable before Playwright execution

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
| 2026-03-25 | Narrowed to verification-only `dist-check` isolation |
| 2026-03-26 | Expanded again to cover full artifact partitioning: default `dist`, verification `dist-check`, and ephemeral `dist-ephemeral`, including runtime/tooling resolution and ephemeral-only reuse rules |
