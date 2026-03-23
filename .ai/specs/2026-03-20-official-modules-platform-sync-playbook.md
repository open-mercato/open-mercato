# Official Modules Platform Sync Playbook

**Date:** 2026-03-20
**Status:** Draft
**Scope:** OSS — external `open-mercato/official-modules` repository
**Author:** Open Mercato Team
**Related:** [SPEC-062-2026-03-13-official-modules-development-monorepo.md](./SPEC-062-2026-03-13-official-modules-development-monorepo.md), [SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md](./SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md), [SPEC-066-2026-03-15-official-modules-changesets-release-workflow.md](./SPEC-066-2026-03-15-official-modules-changesets-release-workflow.md), external `official-modules/.github/workflows/ci.yml`, external `official-modules/apps/sandbox/package.json`, external `official-modules/packages/*/package.json`

## TLDR

**Key Points:**
- `official-modules` MUST use one hard branch rule: `develop` validates against Open Mercato `develop`, and `main` validates against Open Mercato `latest`.
- The repository MUST expose one root command, `yarn platform:sync`, with optional explicit channel override so it is clear whether the sync targets `develop` or `latest`.
- CI MUST only verify alignment with `yarn platform:sync --check`; CI MUST NOT silently rewrite manifests or lockfiles.
- `platform:sync` MUST update only `apps/sandbox/package.json` and existing `@open-mercato/*` entries in workspace `devDependencies`. It MUST NOT touch `peerDependencies`.
- `peerDependencies` remain the only published compatibility contract. Stable modules MUST NOT be released until required core APIs exist on `latest`.

**Scope:**
- branch-to-channel rule for `official-modules`
- minimal root policy file
- `platform:sync` command and `--check` mode
- CI validation flow for `develop` and `main`
- minimal stable release playbook

**Out Of Scope For MVP:**
- preview tarball peer rewriting
- extra compatibility metadata such as `minCoreVersion` and `testedCoreRange`
- smart CI mutations that auto-fix manifests
- auto-adding missing `devDependencies`
- large policy engines or multi-target configuration systems

## Overview

The problem is not that `official-modules` lacks a sophisticated system. The problem is that the repository currently lacks one small, predictable mechanism that developers can trust.

The repository should tell developers which Open Mercato channel it works with. CI should verify that state. Releases should not require manual edits in many `package.json` files.

This specification intentionally keeps the first implementation small:

1. two branches map to two platform channels
2. one root sync command aligns exact development pins
3. CI verifies that the repo is already aligned
4. published compatibility remains expressed only through `peerDependencies`

This keeps the workflow boring. That is the goal.

> **Market Reference:** Modeled after plugin repositories that keep one stable channel and one next channel, with a single repository sync command instead of a large release orchestration layer. Adopted: explicit branch rules, root-managed sync, immutable CI verification, and a stable compatibility contract. Rejected: CI-driven manifest mutation, compatibility metadata duplication, and preview-only behavior leaking into the stable manifest model.

## Problem Statement

The current `official-modules` setup creates unnecessary cognitive load:

1. the sandbox app is pinned to one exact canary Open Mercato line
2. package manifests mix published compatibility with local build/test pins
3. CI scaffolds a standalone app from `create-mercato-app@latest` even when the work targets `develop`
4. maintainers can easily end up hand-editing multiple manifests when a module needs a new core API

This leads to four concrete failures:

1. **Repository state is hard to reason about**
   Developers cannot tell at a glance which platform channel the repo should currently use.

2. **CI can validate the wrong host line**
   A PR targeting `develop` can accidentally be validated against stable `latest`.

3. **Manifest edits become noisy and manual**
   Repeated hand-written version pin changes across packages do not scale.

4. **Compatibility contracts drift**
   If `peerDependencies` are treated like temporary build pins, stable consumers get false compatibility signals.

## Proposed Solution

Implement a minimal platform sync workflow with four rules:

1. **Two branches, two channels**
   - `develop` -> Open Mercato `develop`
   - `main` -> Open Mercato `latest`

2. **One root sync command**
   Developers run:

   ```bash
   yarn platform:sync
   ```

   Or explicitly:

   ```bash
   yarn platform:sync --channel develop
   yarn platform:sync --channel latest
   ```

   The command detects the active channel from the current branch or CI env by default, but it MAY be given an explicit channel override for clarity in local work and CI.

3. **CI only checks**
   CI runs:

   ```bash
   yarn platform:sync --check
   yarn install --immutable
   yarn test
   ```

   CI does not repair repository state. It only verifies that the repository is already correct for the branch.

4. **`peerDependencies` stay untouched**
   Published compatibility remains in `peerDependencies`. Local build/test pins live in `devDependencies` and sandbox dependencies.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| One sync command with branch auto-detection | Developers should not have to remember channel arguments in the common path |
| `--check` mode in CI | Makes CI a verifier, not a hidden mutator |
| Sync only existing platform `devDependencies` | Prevents the sync script from turning into a package manager |
| Keep `peerDependencies` as the only compatibility contract | Avoids multiple sources of truth |
| Defer preview peer rewriting and extra metadata | Reduces MVP complexity and maintenance cost |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Rich policy engine with many targets and generated reports | Too much mental and implementation overhead for v1 |
| CI mutates manifests before tests | Hides repository drift and makes local vs CI behavior less trustworthy |
| Auto-add missing platform `devDependencies` | Requires the script to infer package intent and adds failure modes |
| Extra compatibility metadata next to `peerDependencies` | Creates more places for compatibility state to drift |

## User Stories / Use Cases

- **Developer** wants to run one command after switching branches so that the repo aligns itself without manual package edits.
- **Reviewer** wants CI to fail when the branch is not synchronized to the correct platform channel.
- **Release operator** wants a stable flow where `main` always validates against `latest` and releases do not involve hand-editing many manifests.
- **Module maintainer** wants to work on `develop` against unreleased core changes without polluting stable compatibility contracts.

## Architecture

### 1. Branch Rule

This repository MUST enforce exactly this mapping:

| Git branch | Open Mercato channel |
|------------|----------------------|
| `develop` | `develop` |
| `main` | `latest` |

Rules:

- no other persistent branch-to-channel mappings are introduced in MVP
- feature branches inherit behavior from the branch they are intended to merge into
- CI MAY pass the resolved channel via environment variable, but the semantic rule remains the same

### 2. Root Policy File

The repository MUST define one small policy file, for example:

```text
config/platform-channel-policy.json
```

Recommended shape:

```json
{
  "channels": {
    "develop": {
      "distTag": "develop",
      "createAppTag": "develop"
    },
    "main": {
      "distTag": "latest",
      "createAppTag": "latest"
    }
  },
  "platformPackages": [
    "@open-mercato/core",
    "@open-mercato/shared",
    "@open-mercato/ui"
  ],
  "sandboxManifest": "apps/sandbox/package.json",
  "workspaceGlob": "packages/*/package.json"
}
```

Notes:

- this file is intentionally small
- it does not model every possible target or mode
- it exists only to let the sync command map branch -> dist-tag -> files to update

### 3. Sync Command

The repository MUST expose:

```bash
yarn platform:sync
```

And:

```bash
yarn platform:sync --check
```

And it SHOULD support:

```bash
yarn platform:sync --channel develop
yarn platform:sync --channel latest
yarn platform:sync --check --channel develop
```

Required behavior of `yarn platform:sync`:

1. detect the current channel from branch name or explicit CI env unless `--channel` is provided
2. resolve exact versions for all listed `platformPackages`
3. update `apps/sandbox/package.json`
4. update existing `@open-mercato/*` entries in package `devDependencies`
5. never update `peerDependencies`
6. update `yarn.lock`
7. fail if any platform package cannot be resolved

Required behavior of `yarn platform:sync --check`:

1. detect the expected channel unless `--channel` is provided
2. compute the expected exact versions
3. compare them against tracked manifests and lockfile
4. exit non-zero if the repository is out of sync
5. not write any files

Rules:

- `--channel` MAY accept only `develop` or `latest`
- explicit `--channel` takes precedence over branch auto-detection
- branch auto-detection remains the default so normal developer flow stays short

### 4. Package Manifest Rules

#### `dependencies`

`dependencies` MUST contain only:
- runtime libraries required by the module itself
- runtime dependencies on other official module packages when there is a real module-to-module dependency

`dependencies` MUST NOT contain host platform packages such as:
- `@open-mercato/core`
- `@open-mercato/shared`
- `@open-mercato/ui`

#### `peerDependencies`

`peerDependencies` are the only published compatibility contract.

Rules:

- they MUST describe which stable Open Mercato line the module supports
- they MUST NOT be rewritten by `platform:sync`
- if a module starts depending on a newer core API, the package author MUST update the peer floor in that package

Example:

```json
{
  "@open-mercato/core": ">=0.4.9 <0.5.0",
  "@open-mercato/shared": ">=0.4.9 <0.5.0",
  "@open-mercato/ui": ">=0.4.9 <0.5.0"
}
```

#### `devDependencies`

`devDependencies` MAY contain exact `@open-mercato/*` versions if the package needs them for local build or test.

Rules:

- only existing entries are synchronized
- `platform:sync` does not add missing entries
- these pins are local development/build state, not consumer compatibility state

### 5. CI Workflow

CI MUST use the branch rule and check mode.

For `develop`:

```bash
yarn platform:sync --check --channel develop
yarn install --immutable
yarn build:packages
yarn generate
yarn build:packages
yarn test
```

Standalone integration validation MUST scaffold:

```bash
npx create-mercato-app@develop
```

For `main`:

```bash
yarn platform:sync --check --channel latest
yarn install --immutable
yarn build:packages
yarn generate
yarn build:packages
yarn test
```

Standalone integration validation MUST scaffold:

```bash
npx create-mercato-app@latest
```

### 6. Developer Workflow

Normal work on `develop`:

```bash
git checkout develop
yarn platform:sync
yarn install
```

Optional explicit form:

```bash
yarn platform:sync --channel develop
```

Feature branch intended for `develop`:

```bash
git checkout -b feat/my-change develop
yarn platform:sync
```

Preparing stable work on `main`:

```bash
git checkout main
yarn platform:sync
yarn install
```

Optional explicit form:

```bash
yarn platform:sync --channel latest
```

Developers do not need to remember:

- which dist-tag to use
- which `package.json` files to edit
- which sandbox pins must change

The repository owns that logic.

### 7. Stable Release Playbook

The stable playbook MUST stay minimal:

1. release Open Mercato core to `latest`
2. checkout `official-modules/main`
3. run `yarn platform:sync --channel latest`
4. commit mechanical sync changes if any
5. run the normal release workflow for official modules

Rules:

- stable modules MUST NOT be released until required core APIs exist on `latest`
- `main` MUST never validate or publish against the `develop` channel

## Data Models

### Platform Channel Policy

- `channels.develop.distTag`: string
- `channels.develop.createAppTag`: string
- `channels.main.distTag`: string
- `channels.main.createAppTag`: string
- `platformPackages`: string[]
- `sandboxManifest`: string
- `workspaceGlob`: string

No other persistent configuration model is required in MVP.

No application database entities are introduced by this spec.

## API Contracts

This spec introduces command contracts only.

### `yarn platform:sync`

- Input:
  - current branch name or CI-provided channel env
  - optional `--channel develop|latest`
- Side effects:
  - updates sandbox exact platform pins
  - updates existing package `devDependencies` exact platform pins
  - updates `yarn.lock`
- Failure:
  - branch/channel cannot be resolved
  - required platform package version cannot be resolved from npm

### `yarn platform:sync --check`

- Input:
  - current branch name or CI-provided channel env
  - optional `--channel develop|latest`
- Side effects:
  - none
- Output:
  - success when repo matches expected channel
  - failure when manifests or lockfile do not match expected channel

No runtime HTTP API paths change.

### Integration Coverage

Affected runtime API paths:

- none

Affected key UI paths:

- none

Affected operational validation paths:

- `apps/sandbox/package.json` dependency state
- existing package `devDependencies`
- `create-mercato-app@develop` scaffold flow
- `create-mercato-app@latest` scaffold flow
- sandbox build/generate cycle

## Configuration

Required configuration:

- `config/platform-channel-policy.json`

Optional configuration:

- CI env override for resolved channel, used only to make branch intent explicit inside workflows

Rules:

- unknown channels MUST fail
- local default behavior SHOULD come from the current branch when `--channel` is omitted
- developers SHOULD NOT need to pass the channel manually in normal flow

## Migration & Compatibility

No database migration is required.

Compatibility rules:

- `peerDependencies` remain the only published compatibility contract
- `platform:sync` MUST NOT rewrite `peerDependencies`
- moving a module to require a newer stable core line is a package change, not a sync artifact
- stable release remains blocked until required host APIs exist on `latest`

Migration steps:

1. add the minimal policy file
2. implement `yarn platform:sync`
3. implement `yarn platform:sync --check`
4. update sandbox pins to sync-managed state
5. update package `devDependencies` to sync-managed state
6. update CI to use `--check`
7. switch integration scaffold from hard-coded stable-only logic to branch-aware channel logic

## Implementation Plan

### Phase 1: Minimal Policy And Sync Command

1. Add `config/platform-channel-policy.json`.
2. Implement `scripts/platform-sync.mjs`.
3. Add root scripts:
   - `platform:sync`
   - `platform:sync:check`
4. Support an explicit `--channel develop|latest` flag in addition to branch auto-detection.
5. Restrict sync behavior to:
   - `apps/sandbox/package.json`
   - existing `@open-mercato/*` entries in package `devDependencies`
   - `yarn.lock`

### Phase 2: CI Check Mode

1. Update `official-modules/.github/workflows/ci.yml` to run `yarn platform:sync --check`.
2. Keep `yarn install --immutable` after the check.
3. Switch integration scaffold:
   - `develop` -> `create-mercato-app@develop`
   - `main` -> `create-mercato-app@latest`

### Phase 3: Manifest Cleanup

1. Remove host platform packages from runtime `dependencies` where present.
2. Convert exact platform pins in `peerDependencies` to real stable ranges.
3. Keep only needed platform `devDependencies`, leaving sync ownership to the script.
4. Document the short developer and release workflow.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `official-modules/config/platform-channel-policy.json` | Create | Minimal branch-to-channel mapping and package list |
| `official-modules/scripts/platform-sync.mjs` | Create | Sync and check command implementation |
| `official-modules/package.json` | Modify | Expose root sync scripts |
| `official-modules/.github/workflows/ci.yml` | Modify | Use `--check` and branch-aware scaffold tags |
| `official-modules/apps/sandbox/package.json` | Modify | Bring exact platform pins under sync control |
| `official-modules/packages/*/package.json` | Modify | Normalize `dependencies`, `peerDependencies`, and sync-managed `devDependencies` |
| `official-modules/README.md` or docs page | Modify | Document the short workflow |

### Testing Strategy

- Unit test `platform:sync`:
  - resolves expected versions
  - updates only approved files and fields
  - never rewrites `peerDependencies`
  - fails on unknown branches or unresolved packages
- Unit test `platform:sync --check`:
  - passes on aligned repo state
  - fails on drifted manifests
- Integration test CI flow:
  - `develop` branch check path
  - `main` branch check path
- Integration test standalone scaffold:
  - `create-mercato-app@develop` for `develop`
  - `create-mercato-app@latest` for `main`

## Risks & Impact Review

### Data Integrity Failures

No application data write paths are changed. Persistent changes are limited to repository manifests and lockfile state.

#### Sync rewrites the wrong fields
- **Scenario**: The script edits `peerDependencies` or runtime `dependencies` instead of only the approved fields.
- **Severity**: High
- **Affected area**: Package compatibility contract, repository correctness, release safety
- **Mitigation**: Hard-code allowed targets and field scopes; test that `peerDependencies` remain untouched.
- **Residual risk**: Low; file diffs remain reviewable.

### Cascading Failures & Side Effects

#### CI silently diverges from local workflow
- **Scenario**: CI starts mutating manifests instead of only checking them, so developers cannot reproduce failures locally.
- **Severity**: High
- **Affected area**: CI trustworthiness, developer workflow
- **Mitigation**: Make `--check` the only CI mode and keep write mode local or release-prep only.
- **Residual risk**: Low; the contract is simple and easy to review.

### Tenant & Data Isolation Risks

This spec introduces no tenant-scoped runtime behavior and no tenant isolation changes.

### Migration & Deployment Risks

#### Main branch carries develop pins
- **Scenario**: A maintainer syncs `main` to `develop` behavior or merges incorrect mechanical changes before release.
- **Severity**: Critical
- **Affected area**: Stable release integrity
- **Mitigation**: `main` always maps to `latest`; CI on `main` uses `platform:sync --check`; stable playbook requires syncing after core stable release.
- **Residual risk**: Medium; human error remains possible, but the rule is easy to audit.

#### Peer floor not updated when module needs newer core API
- **Scenario**: A module starts using newer host APIs but keeps an older `peerDependencies` floor.
- **Severity**: High
- **Affected area**: Stable consumer installs, compatibility signaling
- **Mitigation**: Keep `peerDependencies` as the only contract and require PR review to bump the floor when host requirements change.
- **Residual risk**: Medium; this still depends on reviewer discipline.

### Operational Risks

#### Developers forget to run sync locally
- **Scenario**: A developer changes branch and starts work on stale exact pins.
- **Severity**: Medium
- **Affected area**: Local build/test reliability
- **Mitigation**: Keep the command single-purpose and memorable; document the rule that branch switch is followed by `yarn platform:sync`.
- **Residual risk**: Low; CI check mode catches drift before merge.

## Final Compliance Report — 2026-03-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `/Users/dpalatynski/Private/official-modules/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| `AGENTS.md` (root) | New OSS specs use `{date}-{title}.md` in `.ai/specs/` | Compliant | Existing filename kept and remains valid |
| `AGENTS.md` (root) | Check existing specs before significant architecture changes | Compliant | SPEC-062, SPEC-064, and SPEC-066 remain the upstream context |
| `.ai/specs/AGENTS.md` | Non-trivial specs include required sections | Compliant | Required sections remain present after simplification |
| `/Users/dpalatynski/Private/official-modules/AGENTS.md` | External extensions MUST NOT modify core packages | Compliant | The spec targets only `official-modules` workflow |
| SPEC-064 | Compatibility lives in `peerDependencies`, not runtime `dependencies` | Compliant | This MVP keeps `peerDependencies` as the sole compatibility contract |
| SPEC-066 | Stable publication happens from `main` | Compliant | The simplified playbook preserves stable publication from `main` |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Branch rule matches sync behavior | Pass | `develop` and `main` map directly to channels |
| Sync behavior matches CI | Pass | CI only uses `--check` |
| Compatibility contract stays separate from dev pins | Pass | `peerDependencies` are never rewritten |
| MVP scope avoids deferred complexity | Pass | Preview peer rewriting and extra metadata are explicitly out of scope |
| Release playbook matches architecture | Pass | Core stable first, then `main` sync, then release |

### Non-Compliant Items

None in this MVP draft.

### Verdict

- **Fully compliant**: Approved — ready for implementation

## Changelog

### 2026-03-21
- Reduced the specification to an MVP workflow centered on one branch rule, one sync command, and CI check mode

### 2026-03-20
- Initial specification for branch-aware platform sync and operational playbook in `official-modules`
