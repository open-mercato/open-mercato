# SPEC-061: Official Modules Marketplace Lifecycle Management

**Date:** 2026-03-13
**Status:** Draft
**Scope:** OSS — extension of external draft `SPEC-060: Official Modules Marketplace Repository`
**Author:** Open Mercato Team
**Related:** `packages/cli`, `packages/create-app`, external `official-modules` repository

---

## TLDR

**Key Points:**
- Extend the official modules marketplace with a full lifecycle layer after initial install support lands
- Add module state tracking, compatibility checks, update discovery, safe upgrades, and diagnostics to the `mercato` CLI
- Support both installed modes from SPEC-060:
  - package-backed modules (`from: '@open-mercato/module-...'`)
  - ejected modules (`from: '@app'`)
- Treat ejected-module upgrades as assisted merges, not blind overwrites

**New CLI surface:**
- `yarn mercato module search <query>`
- `yarn mercato module info <name>`
- `yarn mercato module outdated`
- `yarn mercato module upgrade <name>`
- `yarn mercato module doctor`

**Important constraint:**
- This extension assumes the marketplace package layout aligns with current CLI resolver conventions: published packages MUST expose module source under `src/modules/<moduleId>/`, not only flat `src/`

---

## Overview

SPEC-060 covers repository creation, npm publication, discovery, and initial installation of official modules. That is enough to make modules installable, but not enough to make them operationally safe over time.

After install, app developers need answers to basic lifecycle questions:

1. Which marketplace modules are installed in this app?
2. Which ones are ejected vs package-backed?
3. Which ones are outdated?
4. Which upgrades are safe with the current core version?
5. How do I update an ejected module without losing local modifications?
6. How do I diagnose a broken module registration or compatibility mismatch?

This spec defines that missing lifecycle layer. The goal is to make official modules feel maintainable over months, not just installable on day one.

---

## Problem Statement

Without a lifecycle layer, the marketplace introduced in SPEC-060 has four structural weaknesses:

1. **No install-state memory**
   The CLI can install or eject a module, but has no first-class record of what was installed, from which package version, through which channel, and in which mode.

2. **No update path**
   Package-backed modules can technically be updated via package manager commands, but there is no Open Mercato-aware compatibility check or workflow. Ejected modules have no upgrade story at all.

3. **No diagnostics**
   If a module is missing files, has an invalid `src/modules.ts` registration, or targets an incompatible core version, there is no single command that explains the problem.

4. **No trustable compatibility UX**
   npm metadata can declare minimum core versions, but the CLI needs a consistent policy for warning, blocking, and surfacing upgrade risk before files or dependencies are changed.

The result would be a marketplace that is easy to start using but expensive to maintain.

---

## Proposed Solution

Add a second-phase lifecycle layer centered on three ideas:

1. **Local module state file**
   Introduce a machine-managed file at app root: `mercato.modules.json`.
   It records installed marketplace modules, source mode, installed version, package name, last known upstream version, compatibility metadata, and basic upgrade history.

2. **Lifecycle-aware CLI commands**
   Extend the CLI with discovery, diagnostics, and upgrade commands that understand Open Mercato module conventions instead of delegating everything to raw `yarn add`.

3. **Mode-specific upgrade strategies**
   - **Package-backed modules**: upgrade by package version bump plus compatibility validation
   - **Ejected modules**: upgrade by staged source extraction plus diff/merge guidance; never overwrite modified user code silently

This remains CLI-first. A backend marketplace UI may be added later, but the source of truth for lifecycle management in this phase is the app-local state file plus npm metadata.

---

## Architecture

### 1. Lifecycle Scope

This extension begins after SPEC-060 Phase 2 exists:

- `module add`
- `module list`
- npm-backed official module discovery
- default eject flow

This spec does not replace that workflow. It layers on top of it.

### 2. Required Package Layout Contract

To remain compatible with the current CLI resolver and eject flow, official marketplace packages MUST publish source in this shape:

```text
@open-mercato/module-foo/
├── package.json
├── src/
│   └── modules/
│       └── foo/
│           ├── index.ts
│           ├── api/
│           ├── backend/
│           ├── data/
│           └── ...
└── dist/
    └── modules/
        └── foo/
            └── ...
```

This differs from the flat `src/` package sketch in external SPEC-060. The current CLI resolver expects `src/modules/<moduleId>` and package imports in the form `@scope/pkg/modules/<moduleId>`.

### 3. App-Local State Tracking

Add a root-level file:

```text
mercato.modules.json
```

This file is written by `module add`, `module upgrade`, `module remove` (future), and `module doctor --fix` when safe.

Purpose:

- remember install source and version independent of `src/modules.ts`
- distinguish ejected modules from manually-created app modules
- retain the last known upstream version for outdated checks
- store metadata needed for upgrade UX

### 4. Mode Model

Each marketplace module is in one of these states:

| Mode | Meaning |
|------|---------|
| `package` | Module is enabled from an installed npm package |
| `ejected-clean` | Module was ejected and no local changes are detected relative to the last installed snapshot |
| `ejected-modified` | Module was ejected and local changes exist |
| `broken` | Registered or tracked, but package/files/metadata are inconsistent |

State is inferred from `mercato.modules.json`, `src/modules.ts`, local file existence, and optional file checksums.

### 5. Upgrade Strategy

#### Package-backed modules

`module upgrade <name>` performs:

1. fetch latest npm metadata
2. validate core compatibility
3. update dependency version
4. ensure `src/modules.ts` still points to package source
5. run `yarn mercato generate`

#### Ejected modules

`module upgrade <name>` performs:

1. fetch latest npm metadata
2. download/install package in a temp workspace
3. compare published source snapshot against:
   - previous installed snapshot
   - current local ejected source
4. classify upgrade:
   - no local changes: replace safely
   - local changes but non-overlapping diff: apply assisted patch
   - conflicting changes: stop with merge instructions and diff output
5. refresh `mercato.modules.json`
6. run `yarn mercato generate`

The CLI MUST never overwrite a modified ejected module without explicit user action.

### 6. Diagnostics

`module doctor` validates:

- package installed vs missing from `node_modules`
- module registered in `src/modules.ts`
- tracked module exists in `mercato.modules.json`
- `from` field matches tracked install mode
- module source path exists
- `metadata.ejectable` presence for ejected-origin modules
- peer compatibility with installed `@open-mercato/core`
- generated import path assumptions (`pkg/modules/<id>`) remain valid

Output is grouped into:

- errors
- warnings
- suggested fixes

### 7. Search and Info

`module search <query>` extends `module list` with npm search text filtering.

`module info <name>` shows:

- package name
- latest version
- installed version, if any
- display name and description
- install mode
- core compatibility range
- repository URL
- whether module is ejectable
- whether local ejected changes are detected

---

## Data Models

### `mercato.modules.json`

```json
{
  "version": 1,
  "modules": [
    {
      "id": "n8n-integration",
      "packageName": "@open-mercato/module-n8n-integration",
      "installMode": "ejected-modified",
      "source": "official-marketplace",
      "installedVersion": "1.2.0",
      "lastCheckedVersion": "1.3.0",
      "coreRange": ">=0.14.0 <0.15.0",
      "ejectable": true,
      "registeredFrom": "@app",
      "installedAt": "2026-03-13T14:00:00.000Z",
      "lastCheckedAt": "2026-03-13T15:00:00.000Z",
      "lastUpgradedAt": "2026-03-13T14:00:00.000Z",
      "snapshotHash": "sha256:abcd1234",
      "localHash": "sha256:ffff9999"
    }
  ]
}
```

### npm `package.json` extension

Marketplace modules continue using the SPEC-060 `open-mercato` field, extended with optional lifecycle metadata:

```json
{
  "open-mercato": {
    "displayName": "n8n Integration",
    "ejectable": true,
    "minCoreVersion": "0.14.0",
    "testedCoreRange": ">=0.14.0 <0.15.0",
    "upgradeNotesUrl": "https://github.com/open-mercato/official-modules/tree/main/packages/n8n-integration/CHANGELOG.md"
  }
}
```

Rules:

- `minCoreVersion` remains supported for backward compatibility
- `testedCoreRange` is additive and preferred when present
- absence of `testedCoreRange` falls back to peer dependency plus `minCoreVersion`

---

## API Contracts

No application HTTP routes are introduced. External interfaces are CLI commands plus npm registry requests.

### npm Registry Calls

| Call | Purpose |
|------|---------|
| `GET /-/v1/search?text=scope:open-mercato keywords:open-mercato-module <query>` | `module search` and `module list` |
| `GET /@open-mercato/module-<name>` | `module info`, `module add`, `module upgrade`, `module outdated` |

### CLI Commands

| Command | Description |
|---------|-------------|
| `yarn mercato module search <query>` | Search official marketplace modules |
| `yarn mercato module info <name>` | Show detailed module metadata and local install state |
| `yarn mercato module outdated` | Compare installed modules against npm latest versions |
| `yarn mercato module upgrade <name>` | Upgrade one installed marketplace module |
| `yarn mercato module upgrade --all` | Upgrade all compatible package-backed modules; ejected modules remain review-gated |
| `yarn mercato module doctor` | Validate local marketplace module state |

### CLI Internal Library Split

New files:

```text
packages/cli/src/lib/module-registry.ts    # npm metadata fetch + zod parsing
packages/cli/src/lib/module-state.ts       # read/write mercato.modules.json
packages/cli/src/lib/module-doctor.ts      # diagnostics
packages/cli/src/lib/module-upgrade.ts     # mode-aware upgrades
packages/cli/src/lib/module-search.ts      # search/list/info
```

### Integration Coverage Matrix

Because this phase is CLI-only, coverage is defined per command path:

| Flow | Coverage Requirement |
|------|----------------------|
| `module search` success + empty result + npm failure | Unit tests |
| `module info` for package-backed, ejected, and missing modules | Unit tests |
| `module outdated` with mixed states | Unit tests |
| `module upgrade` package-backed success + compatibility failure | Unit tests |
| `module upgrade` ejected-clean success | Integration test |
| `module upgrade` ejected-modified conflict | Integration test |
| `module doctor` broken registration, missing package, incompatible core | Unit tests |

---

## Internationalization (i18n)

Not applicable in the application UI. CLI output remains English-only in this phase.

---

## UI/UX

CLI output should be structured and stable:

- compact table output for `list`, `search`, `outdated`
- detail view for `info`
- grouped findings for `doctor`
- explicit dry-run style summary before destructive or merge-like upgrade steps

This phase does not add a backend marketplace page.

---

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `MERCATO_NPM_REGISTRY` | `https://registry.npmjs.org` | npm registry override |
| `MERCATO_MODULE_UPGRADE_STRATEGY` | `safe` | Upgrade policy; `safe` blocks conflicting ejected upgrades |
| `MERCATO_MODULE_SEARCH_SIZE` | `100` | Max result size for npm search calls |

---

## Migration & Backward Compatibility

- No existing CLI command is removed or renamed
- `eject` remains supported as a standalone command
- Existing `src/modules.ts` entries remain the runtime source of module enablement
- `mercato.modules.json` is additive and optional at first run
- If a module is enabled in `src/modules.ts` but missing from `mercato.modules.json`, `module doctor` reports it as untracked and offers a repair path
- `minCoreVersion` in npm metadata remains supported even after `testedCoreRange` is introduced

### Frozen/Stable Surface Review

| Surface | Impact |
|---------|--------|
| CLI commands | Additive-only |
| `src/modules.ts` contract | Unchanged |
| Module import path shape | Clarified and enforced |
| Existing `eject` behavior | Wrapped, not replaced |

---

## Implementation Plan

### Phase 1 — State & Metadata

1. Introduce `mercato.modules.json` schema and read/write helpers
2. Add zod-validated npm metadata parsers
3. Extend `module add` from SPEC-060 to record install state
4. Extend `eject` integration to mark modules as `ejected-clean`

### Phase 2 — Discovery & Diagnostics

1. Add `module search`
2. Add `module info`
3. Add `module doctor`
4. Add unit tests for state reconstruction and broken-state reporting

### Phase 3 — Outdated & Compatibility

1. Add `module outdated`
2. Add compatibility evaluation using `testedCoreRange`, `peerDependencies`, and `minCoreVersion`
3. Add clear warning/blocking policy
4. Add unit tests for compatibility matrix cases

### Phase 4 — Upgrade Engine

1. Add package-backed upgrade flow
2. Add ejected-clean upgrade flow
3. Add ejected-modified conflict detection using snapshot hashes and file diffs
4. Add integration tests covering safe and conflicting upgrades

### Phase 5 — Future Hooks

1. Reserve `module remove` and `module diff` for a future spec
2. Reserve backend marketplace UI for a future spec
3. Reserve provenance/signature verification for a future trust-focused spec

### File Manifest

| File | Repo | Action | Purpose |
|------|------|--------|---------|
| `packages/cli/src/lib/module-state.ts` | open-mercato | Create | `mercato.modules.json` read/write helpers |
| `packages/cli/src/lib/module-registry.ts` | open-mercato | Create | npm metadata fetch/parsing |
| `packages/cli/src/lib/module-doctor.ts` | open-mercato | Create | diagnostics engine |
| `packages/cli/src/lib/module-upgrade.ts` | open-mercato | Create | lifecycle-aware upgrades |
| `packages/cli/src/lib/module-search.ts` | open-mercato | Create | search/list/info support |
| `packages/cli/src/mercato.ts` | open-mercato | Modify | route new `module:*` commands |
| `packages/cli/src/bin.ts` | open-mercato | Modify | mark lifecycle commands bootstrap-free where required |
| `mercato.modules.json` | app root | Create | local marketplace state |

### Testing Strategy

- Unit tests for npm metadata parsing and compatibility evaluation
- Unit tests for `mercato.modules.json` reads/writes and recovery from corruption
- Unit tests for `module doctor` findings
- Integration tests for:
  - install package-backed module → upgrade
  - install ejectable module → eject → upgrade without changes
  - install ejectable module → modify source → upgrade conflict
- Local Verdaccio support remains required for end-to-end lifecycle testing

---

## Risks & Impact Review

### Data Integrity Failures

The CLI now manages both `src/modules.ts` and `mercato.modules.json`. If these diverge, users may get false outdated reports or broken upgrades.

Mitigation:

- `module doctor` checks both files together
- writes use atomic temp-file replacement
- generation runs only after state mutation succeeds

### Cascading Failures & Side Effects

An incorrect compatibility evaluator could either block safe installs or allow broken upgrades.

Mitigation:

- compatibility policy is additive and conservative
- package-backed upgrades can be rolled back through lockfile/package manager history
- ejected upgrades stop on uncertainty

### Operational Risks

- npm outages still affect metadata refresh
- large ejected modules may make diffing slower
- local workspace corruption may leave stale snapshots

Mitigation:

- registry override via `MERCATO_NPM_REGISTRY`
- temp snapshots kept per upgrade run
- `module doctor --fix` may rebuild state from current app and installed packages

### Risk Register

#### Ejected Upgrade Overwrites Local Customizations

- **Scenario**: A user upgrades an ejected module with local edits and the CLI overwrites files.
- **Severity**: High
- **Affected area**: App-local source under `src/modules/<id>`
- **Mitigation**: snapshot hash tracking, diff-based conflict detection, no silent overwrite policy
- **Residual risk**: Medium — complex merges may still require manual resolution

#### State File Drift Causes False Diagnostics

- **Scenario**: `mercato.modules.json` is edited manually or becomes stale after git operations.
- **Severity**: Medium
- **Affected area**: `module info`, `module outdated`, `module doctor`, `module upgrade`
- **Mitigation**: doctor reconciliation against `src/modules.ts` and package manifests
- **Residual risk**: Low

#### Package Layout Deviates From Resolver Contract

- **Scenario**: official-modules publishes flat `src/` packages instead of `src/modules/<id>/`
- **Severity**: High
- **Affected area**: install, eject, generate, upgrade
- **Mitigation**: make package layout a documented release contract in SPEC-060 follow-up work
- **Residual risk**: Low if enforced in CI

#### Compatibility Metadata Is Too Optimistic

- **Scenario**: module declares a wide tested range but fails on a newer core release.
- **Severity**: Medium
- **Affected area**: upgraded apps using package-backed modules
- **Mitigation**: sandbox CI matrix against supported core versions in official-modules repo
- **Residual risk**: Medium

---

## Final Compliance Report — 2026-03-13

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Use spec for non-trivial architecture | Compliant | This is an additive architecture spec |
| root AGENTS.md | No breaking contract removals | Compliant | All command changes are additive |
| root AGENTS.md | Generated/runtime module contract stability | Compliant | `src/modules.ts` remains source of enablement |
| packages/cli/AGENTS.md | Bootstrap-free commands must be declared explicitly | Compliant | Spec includes `bin.ts` updates |
| packages/create-app/AGENTS.md | Verdaccio-based registry testing for package flows | Compliant | Included in testing strategy |
| root AGENTS.md | No raw/unstructured compatibility assumptions | Compliant | Explicit compatibility model and diagnostics added |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Extends SPEC-060 rather than replacing it | Pass | Focused on lifecycle after install |
| Aligns with current CLI resolver package layout | Pass | Explicitly requires `src/modules/<id>` |
| Treats ejected upgrades safely | Pass | No overwrite-by-default |
| Distinguishes runtime enablement vs lifecycle tracking | Pass | `src/modules.ts` and `mercato.modules.json` have separate roles |
| Includes test coverage for affected command paths | Pass | CLI coverage matrix included |

### Non-Compliant Items

None.

### Verdict

**Approved as a follow-up draft** — this is a coherent next-phase extension after SPEC-060. It should not begin before the base install/list workflow exists.

---

## Out of Scope

- Backend marketplace browser
- Paid/licensed modules
- Module dependency graphs between marketplace modules
- Cryptographic signature verification of published tarballs
- Automatic rollback of failed ejected upgrades
- Multi-registry federation beyond one configured npm-compatible registry

---

## References

- [packages/cli/src/lib/eject.ts](/Users/dpalatynski/Private/open-mercato-latest/packages/cli/src/lib/eject.ts)
- [packages/cli/src/lib/resolver.ts](/Users/dpalatynski/Private/open-mercato-latest/packages/cli/src/lib/resolver.ts)
- [packages/cli/src/mercato.ts](/Users/dpalatynski/Private/open-mercato-latest/packages/cli/src/mercato.ts)
- [packages/cli/src/bin.ts](/Users/dpalatynski/Private/open-mercato-latest/packages/cli/src/bin.ts)

---

## Changelog

### 2026-03-13

- Initial draft for lifecycle management extension to external SPEC-060
- Added app-local module state tracking via `mercato.modules.json`
- Added lifecycle CLI surface: `search`, `info`, `outdated`, `upgrade`, `doctor`
- Clarified required package layout to match current CLI resolver conventions
