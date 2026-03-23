# Open Mercato Develop Snapshot Release

**Date:** 2026-03-21
**Status:** Draft
**Scope:** OSS — `open-mercato/open-mercato`
**Author:** Open Mercato Team
**Related:** [2026-03-20-official-modules-platform-sync-playbook.md](./2026-03-20-official-modules-platform-sync-playbook.md), `.github/workflows/snapshot.yml`, `.github/workflows/release.yml`, `scripts/release-snapshot.sh`, `scripts/publish-packages.sh`

## TLDR

**Key Points:**
- Every merge or direct push to `develop` MUST publish a lockstep snapshot of all public Open Mercato packages.
- That snapshot MUST publish under the npm dist-tag `develop`.
- Each develop snapshot MUST have a unique semver so npm publishes are immutable, while the `develop` dist-tag always points to the newest snapshot.
- Stable release from `main` remains unchanged and continues to publish under `latest`.
- This MVP spec does not redesign PR preview publishing. It only makes the `develop` channel explicit and reliable.

**Scope:**
- snapshot workflow behavior for pushes to `develop`
- snapshot version format
- npm dist-tag behavior for `develop`
- standalone integration validation against the published develop snapshot
- minimal workflow/script changes needed in this repo

**Out Of Scope For MVP:**
- redesign of PR canary publishing
- preview GitHub Releases
- separate `next` channel for `main`
- per-package versioning
- release process changes for stable `main`

## Overview

The repository already has snapshot publishing, but it does not yet expose a clean, stable concept of “the current develop line”.

Today the workflow publishes snapshot versions with a branch-based suffix, but the publish step still uses the generic npm dist-tag `canary`. That means:

- there is no durable npm tag that always means “latest build from `develop`”
- `official-modules` and other downstream consumers cannot reliably depend on one moving develop channel
- PR snapshots and branch snapshots are not clearly separated operationally

The intended workflow is much simpler:

1. `develop` is the moving preview line of the platform
2. every successful merge to `develop` publishes a new immutable snapshot version
3. the npm dist-tag `develop` is moved to that newest snapshot
4. downstream repositories can depend on `@open-mercato/*@develop`

This keeps stable release on `main` unchanged while giving the team one reliable next-line channel.

> **Market Reference:** Modeled after repositories that publish nightly or branch snapshots under a moving prerelease dist-tag, while keeping stable releases on `latest`. Adopted: immutable prerelease versions plus a moving branch tag. Rejected: republishing the same semver repeatedly and mixing PR preview tags with the main develop line.

## Problem Statement

The current snapshot setup has three practical issues:

1. **No first-class `develop` consumer channel**
   The workflow publishes with `--tag canary`, so consumers do not get a clear npm install target for “latest from `develop`”.

2. **Branch snapshots and PR previews are blurred**
   A generic `canary` tag does not distinguish “merged into `develop`” from “temporary PR build”.

3. **Downstream repositories need a predictable moving target**
   `official-modules` needs one known channel for unreleased host APIs. Without `@develop`, maintainers are forced to pin exact canary versions or manually wait for stable releases.

## Proposed Solution

Introduce a minimal develop snapshot contract:

1. **Push to `develop` publishes snapshots**
   On every push to `develop`, the repo publishes all public packages as a lockstep snapshot.

2. **`develop` is the npm dist-tag**
   The publish step uses:

   ```bash
   npm publish --tag develop
   ```

   for develop snapshots.

3. **Versions are immutable and unique**
   Each develop snapshot uses a unique version string derived from the next stable patch plus build identity.

4. **Stable remains on `latest`**
   The current `main` release flow stays stable-only and unchanged in principle.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Use `develop` as the dist-tag | Gives downstream repos one predictable moving channel |
| Keep unique semver per run | Required by npm and useful for debugging exact builds |
| Preserve lockstep snapshot publishing | Matches current monorepo release model |
| Keep stable release flow separate | Avoids unnecessary scope expansion |
| Keep PR preview redesign out of MVP | Solves the main downstream problem without reopening the whole workflow model |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Continue publishing `develop` builds under `canary` | Too ambiguous for downstream consumers |
| Use only exact snapshot versions and no dist-tag | Too much friction for repositories that just want “latest develop” |
| Reuse the same `0.x.y-develop` version repeatedly | npm publish requires immutable versions |
| Redesign all snapshot and PR preview behavior in one change | Too much scope for the immediate problem |

## User Stories / Use Cases

- **Platform maintainer** wants every merge to `develop` to produce a consumable snapshot channel for downstream repos.
- **Official modules maintainer** wants to install `@open-mercato/core@develop` without searching for a specific canary version.
- **Reviewer** wants the workflow to make it obvious which builds are the current develop line.
- **Developer** wants to pin an exact snapshot version for debugging when needed, while still having `@develop` for normal work.

## Architecture

### 1. Channel Rule

This repository MUST treat channels as:

| Source | Dist-tag | Purpose |
|--------|----------|---------|
| push to `develop` | `develop` | moving next-line platform snapshot |
| stable release from `main` | `latest` | stable platform release |

No other channel behavior is required for this MVP spec.

### 2. Snapshot Version Format

Develop snapshots MUST be unique per run.

Recommended format:

```text
<next-stable-version>-develop.<github_run_number>.<short_sha>
```

Example:

```text
0.4.9-develop.1523.a1b2c3d4
```

Rules:

- the base version SHOULD be derived from the current stable package version and incremented to the next patch line
- the version MUST include enough build identity to remain unique
- the version string MUST remain valid semver

### 3. Dist-tag Behavior

Develop snapshot publication MUST:

- publish all public packages under dist-tag `develop`
- move the `develop` tag to the newest published snapshot
- keep older unique snapshot versions installable by exact semver

This enables both flows:

```bash
yarn add @open-mercato/core@develop
```

and:

```bash
yarn add @open-mercato/core@0.4.9-develop.1523.a1b2c3d4
```

### 4. Workflow Contract

The snapshot workflow MUST be split conceptually into two concerns:

#### Develop snapshot publication

- trigger: push to `develop`
- output: published snapshot versions under dist-tag `develop`
- downstream use: `@open-mercato/*@develop`

#### Stable release

- trigger: manual release flow from `main`
- output: stable versions under `latest`
- downstream use: `@open-mercato/*@latest`

PR preview publication MAY continue to exist, but it is not part of this MVP contract.

### 5. Standalone Integration Validation

After publishing the develop snapshot, the workflow MUST validate the published artifacts.

Recommended behavior:

1. wait for npm propagation of the exact snapshot version
2. scaffold a standalone app from the exact published `create-mercato-app` snapshot version
3. build and validate that app against the published snapshot packages

Rules:

- validation SHOULD use the exact snapshot version produced by the workflow
- consumer documentation and downstream repos SHOULD use the `develop` dist-tag for normal operation

## Data Models

### Develop Snapshot Metadata

- `base_version`: string
- `snapshot_version`: string
- `dist_tag`: `'develop'`
- `commit_sha`: string
- `run_number`: string or number

No database entities are introduced.

## API Contracts

This spec introduces no runtime HTTP API changes.

### Snapshot Publish Contract

- Trigger:
  - `push` to `develop`
- Inputs:
  - current base version from public workspace packages
  - current commit SHA
  - workflow run number or equivalent unique build identifier
- Side effects:
  - rewrites package versions in the workflow workspace to a unique develop snapshot version
  - publishes all public packages to npm under dist-tag `develop`
- Output:
  - published snapshot version
  - package list for workflow summary

### Integration Coverage

Affected runtime API paths:

- none

Affected key UI paths:

- none

Affected operational validation paths:

- `.github/workflows/snapshot.yml`
- `scripts/release-snapshot.sh`
- `scripts/publish-packages.sh`
- standalone scaffold via `create-mercato-app@<snapshot-version>`

## Configuration

Required configuration:

- npm dist-tag `develop`
- workflow logic that maps pushes to `develop` onto dist-tag `develop`

Optional configuration:

- explicit script argument for dist-tag override, so the snapshot script can stay reusable

Rules:

- develop snapshot publishing MUST NOT use `latest`
- stable release flow MUST NOT use `develop`

## Migration & Compatibility

No database migration is required.

Compatibility rules:

- stable `latest` consumers remain unaffected
- downstream repos MAY switch to `@open-mercato/*@develop` without needing exact snapshot versions
- exact snapshot versions remain installable for debugging and rollback

Migration steps:

1. update the snapshot workflow so pushes to `develop` publish under dist-tag `develop`
2. update the snapshot version format to remain unique and branch-specific
3. keep standalone integration validation on the exact published snapshot version
4. document `@develop` as the official moving channel for unreleased platform work

## Implementation Plan

### Phase 1: Develop Snapshot Dist-tag

1. Update `.github/workflows/snapshot.yml` so pushes to `develop` are treated as develop snapshot publishes.
2. Pass `develop` as the publish tag for that path instead of `canary`.
3. Keep the job restricted to trusted contexts that have npm credentials.

### Phase 2: Unique Version Format

1. Update `scripts/release-snapshot.sh` to generate a unique develop snapshot version using build identity, not only branch suffix.
2. Preserve lockstep versioning across all public packages.
3. Ensure the generated version remains semver-valid.

### Phase 3: Validation And Documentation

1. Keep standalone integration validation against the exact snapshot version emitted by the workflow.
2. Update workflow summaries or PR comments to show both:
   - exact snapshot version
   - moving install target `@develop` when applicable
3. Document that downstream repositories should use `@open-mercato/*@develop` for unreleased integration work.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `.github/workflows/snapshot.yml` | Modify | Publish develop snapshots under the `develop` dist-tag |
| `scripts/release-snapshot.sh` | Modify | Generate unique develop snapshot versions |
| `scripts/publish-packages.sh` | Reuse or Modify | Accept and apply publish tag cleanly |
| `README.md` or release docs | Modify | Document `@develop` usage |

### Testing Strategy

- Validate that a push to `develop` selects dist-tag `develop`
- Validate that generated versions are unique across consecutive runs
- Validate that `npm view @open-mercato/core@develop version` resolves to the newest develop snapshot
- Validate that exact snapshot versions remain installable
- Validate standalone integration against the exact snapshot version produced by the workflow

## Risks & Impact Review

### Data Integrity Failures

No application runtime data model changes are introduced.

#### Snapshot version collision
- **Scenario**: Two develop runs generate the same snapshot version and one publish fails.
- **Severity**: High
- **Affected area**: Snapshot publication pipeline
- **Mitigation**: Include workflow run identity and short SHA in the version format.
- **Residual risk**: Low; collisions become highly unlikely.

### Cascading Failures & Side Effects

#### Wrong dist-tag published
- **Scenario**: A develop snapshot is accidentally published under `latest` or `canary`.
- **Severity**: Critical
- **Affected area**: Consumers, downstream repos, release trust
- **Mitigation**: Hard branch-to-tag rule in workflow logic; explicit tests or checks in the publish step.
- **Residual risk**: Medium; workflow regressions remain possible without guard assertions.

### Tenant & Data Isolation Risks

This spec introduces no tenant-scoped runtime behavior.

### Migration & Deployment Risks

#### Downstream repos mix exact snapshot versions and moving tags inconsistently
- **Scenario**: Some consumers pin exact snapshot versions while others use `@develop`, making debugging less consistent.
- **Severity**: Medium
- **Affected area**: Cross-repo developer workflow
- **Mitigation**: Document `@develop` as the default and exact versions as an exception for debugging.
- **Residual risk**: Low; both flows remain valid.

### Operational Risks

#### PR preview expectations remain ambiguous
- **Scenario**: Maintainers expect this change to also solve PR preview semantics, but PR previews still use separate logic.
- **Severity**: Medium
- **Affected area**: Team expectations
- **Mitigation**: Keep PR preview redesign explicitly out of scope in this spec.
- **Residual risk**: Low; scope is documented.

## Final Compliance Report — 2026-03-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| `AGENTS.md` (root) | Check `.ai/specs/` before non-trivial workflow changes | Compliant | Existing related specs were reviewed |
| `AGENTS.md` (root) | Keep changes simple and minimal | Compliant | The spec focuses only on develop snapshots and leaves stable flow unchanged |
| `.ai/specs/AGENTS.md` | Non-trivial specs include required sections | Compliant | All required sections are present |
| Root release model | Stable release remains manual from `main` | Compliant | The spec keeps stable release under `latest` and scoped separately |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Dist-tag rule matches workflow intent | Pass | `develop` is the only moving snapshot tag in scope |
| Version model supports npm immutability | Pass | Each snapshot version is unique |
| Stable flow remains isolated | Pass | `main` stable release is unchanged in principle |
| Downstream use case is covered | Pass | `official-modules` can consume `@develop` |

### Non-Compliant Items

None in this draft.

### Verdict

- **Fully compliant**: Approved — ready for implementation

## Changelog

### 2026-03-21
- Initial specification for publishing lockstep develop snapshots under the npm `develop` dist-tag

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Develop Snapshot Dist-tag | Done | 2026-03-21 | Snapshot workflow now resolves trusted `develop` pushes to npm dist-tag `develop` and keeps PR previews on `canary` |
| Phase 2 — Unique Version Format | Done | 2026-03-21 | Snapshot versions now use `<next-patch>-<channel>.<buildId>.<shortSha>` and publish via configurable dist-tag |
| Phase 3 — Validation And Documentation | Done | 2026-03-21 | Standalone validation now waits for every public package, including `create-mercato-app`, and docs now describe the `@develop` channel |

### Phase 1 — Detailed Progress
- [x] Step 1: Update `.github/workflows/snapshot.yml` so pushes to `develop` are treated as develop snapshot publishes
- [x] Step 2: Pass `develop` as the publish tag for that path instead of `canary`
- [x] Step 3: Keep the job restricted to trusted contexts that have npm credentials

### Phase 2 — Detailed Progress
- [x] Step 1: Update `scripts/release-snapshot.sh` to generate a unique develop snapshot version using build identity
- [x] Step 2: Preserve lockstep versioning across all public packages
- [x] Step 3: Ensure the generated version remains semver-valid

### Phase 3 — Detailed Progress
- [x] Step 1: Keep standalone integration validation against the exact snapshot version emitted by the workflow
- [x] Step 2: Update workflow summaries or PR comments to show the exact snapshot version and moving install target when applicable
- [x] Step 3: Document `@develop` as the official moving channel for unreleased integration work
