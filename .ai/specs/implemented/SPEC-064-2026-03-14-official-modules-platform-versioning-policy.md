# SPEC-064: Official Modules Platform Versioning Policy

**Date:** 2026-03-14
**Status:** Draft
**Scope:** OSS — versioning and compatibility policy for `open-mercato/official-modules`
**Author:** Open Mercato Team
**Related:** [SPEC-061-2026-03-13-official-modules-lifecycle-management.md](./SPEC-061-2026-03-13-official-modules-lifecycle-management.md), [SPEC-062-2026-03-13-official-modules-development-monorepo.md](./SPEC-062-2026-03-13-official-modules-development-monorepo.md), [SPEC-063-2026-03-13-official-modules-verdaccio-prototyping.md](./SPEC-063-2026-03-13-official-modules-verdaccio-prototyping.md)

---

## TLDR

**Key Points:**
- `official-modules` packages MUST NOT use `workspace:*` for `@open-mercato/*` platform packages unless that package is actually a local workspace in the same repository
- Published module packages MUST express Open Mercato platform compatibility through `peerDependencies`, not through regular `dependencies`
- The repository MUST centralize exact development/tested platform versions in one root-managed policy file and sync scripts, so maintainers do not manually bump `@open-mercato/*` versions in every package
- Preview/canary platform testing MUST be a repo-wide override for sandbox/dev flows, not a package-level pinned peer contract on the main branch

**Scope:**
- package manifest rules for `official-modules`
- central platform version matrix
- compatibility metadata policy
- preview/stable channel rules
- validation and CI requirements

**Concerns:**
- naive `workspace:*` usage breaks `yarn install` in the standalone `official-modules` repo
- per-package manual version pinning creates drift and unnecessary maintenance cost
- canary versions can leak into published compatibility contracts and block stable consumers

---

## Overview

SPEC-062 establishes that `official-modules` is a standalone monorepo that develops publishable Open Mercato extensions against published platform packages rather than against local workspaces from the core monorepo. That repository architecture is correct, but it leaves one operational question underspecified:

How should module packages declare their relationship to `@open-mercato/shared`, `@open-mercato/ui`, `@open-mercato/core`, and related platform packages without forcing maintainers to manually rewrite versions across every package?

This spec defines that missing contract.

The goal is to separate four concerns that are currently too easy to conflate:

1. the version of a published module package
2. the platform version range that the module claims to support
3. the exact platform versions used locally in the `official-modules` repo for development and CI
4. the temporary preview/canary platform versions used for pre-release validation

> **Market Reference:** Modeled after plugin ecosystems such as ESLint/Vite/Next.js extensions and Changesets-based monorepos. Adopted: peer dependency compatibility contracts, centralized local version matrix, independent package versioning, and preview-only prerelease testing. Rejected: `workspace:*` across repository boundaries, exact platform version pinning repeated in every publishable package, and canary versions baked into stable package manifests.

---

## Problem Statement

Without an explicit platform versioning policy, `official-modules` will fail in predictable ways:

1. **Cross-repo workspace assumptions break installation**
   A module package copied from the main monorepo may contain:
   - `@open-mercato/shared: "workspace:*"`
   - `@open-mercato/ui: "workspace:*"`

   In `official-modules`, those packages are not local workspaces. Yarn correctly fails with `Workspace not found`.

2. **Maintainers are forced into repetitive manual bumps**
   If every module package duplicates exact versions of `@open-mercato/*` platform packages in `devDependencies`, then every platform release requires touching many package manifests even when package compatibility policy did not change.

3. **Compatibility contracts become unclear**
   Exact versions in package manifests do not answer the key consumer question:
   “Which Open Mercato platform range is this module compatible with?”

   That contract belongs in `peerDependencies` and in marketplace metadata, not in arbitrary dev pins.

4. **Preview/canary work can poison stable consumers**
   If prerelease platform versions are committed directly into module package manifests, then stable users may get incorrect install warnings or impossible dependency constraints for packages that otherwise work on the stable line.

5. **CI may validate the wrong thing**
   If the sandbox app, root repo, and package manifests drift apart, CI may be green while published packages are semantically incompatible with the actual Open Mercato release line they claim to support.

The repository needs one versioning policy that is explicit, automatable, and safe for both stable publication and preview prototyping.

---

## Proposed Solution

Define `official-modules` versioning around three mandatory layers and one optional preview layer:

1. **Per-package release version**
   Each module package keeps its own semantic version and is released independently via Changesets. This version reflects changes in the module itself, not the platform line alone.

2. **Per-package platform compatibility contract**
   Each publishable module package declares the Open Mercato platform packages it needs in `peerDependencies`, using semver ranges such as `>=0.4.8 <0.5.0`.

3. **Repo-wide exact development matrix**
   The `official-modules` root keeps one machine-managed policy file describing the exact platform package versions used for:
   - local builds
   - sandbox tests
   - CI smoke tests
   - preview package validation

4. **Repo-wide preview override**
   Prerelease platform versions are opt-in, repo-wide overrides used only in dedicated preview/testing flows. They do not become the default stable peer contract for published packages on `main`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| `peerDependencies` are the source of truth for platform compatibility | The consuming app owns platform package installation and version resolution |
| Root policy file controls exact dev/test versions | Prevents manual bumps across many package manifests |
| Stable and preview channels are separate concerns | Keeps stable published contracts clean while still allowing canary validation |
| `open-mercato` metadata mirrors compatibility intent for CLI/marketplace UX | npm peers enforce install-time compatibility; metadata supports diagnostics and discovery |
| `workspace:*` is forbidden for non-local platform packages | Avoids broken installs in the standalone `official-modules` repo |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Repeat exact `@open-mercato/*` versions in every module package `devDependencies` | High maintenance cost and guaranteed drift |
| Use `workspace:*` for platform packages in external module repo | Invalid unless those packages are real local workspaces |
| Put platform packages in regular `dependencies` | Makes the module try to own host platform versions instead of integrating with them |
| Pin canary versions directly in package peers on `main` | Turns temporary preview work into a false stable compatibility contract |
| Use `*` or very wide peer ranges | Produces meaningless compatibility promises and hides real minimum-version requirements |

---

## User Stories / Use Cases

- **Module maintainer** wants to update the repository to a newer Open Mercato stable release by editing one version policy input, not twenty package manifests
- **Module maintainer** wants a package to declare the minimum supported Open Mercato version line so that consumers get correct peer dependency behavior
- **CI maintainer** wants sandbox tests to run against one exact, explicit platform matrix so that green builds are trustworthy
- **Preview maintainer** wants to test modules against canary platform builds without permanently rewriting stable package manifests
- **Marketplace user** wants CLI diagnostics and registry metadata to show whether a module is compatible with their installed platform version

---

## Architecture

### 1. Version Dimensions

The repository MUST treat these dimensions as separate:

| Dimension | Owner | Example | Purpose |
|-----------|-------|---------|---------|
| Module release version | module package | `1.3.0` | Version of the published module itself |
| Platform compatibility range | module package peers | `>=0.4.8 <0.5.0` | What Open Mercato platform line the module supports |
| Repo dev/test version | root policy | `0.4.8` | Exact version used in local builds and CI |
| Preview platform override | root preview policy | `0.4.9-canary-abcd1234` | Temporary prerelease testing only |

These dimensions MUST NOT be collapsed into one field or one package-manager trick.

### 2. Package Manifest Contract

Every publishable module package in `official-modules` MUST follow these rules:

#### 2.1 `dependencies`

`dependencies` MAY contain:
- third-party runtime libraries required by the module itself
- other publishable official module packages only when there is a real runtime dependency

`dependencies` MUST NOT contain:
- `@open-mercato/shared`
- `@open-mercato/ui`
- `@open-mercato/core`
- other Open Mercato host/platform packages that are expected to be provided by the consuming app

#### 2.2 `peerDependencies`

`peerDependencies` MUST contain every Open Mercato platform package directly imported by the module package at runtime or typecheck time.

Typical examples:
- `@open-mercato/shared`
- `@open-mercato/ui`
- `@open-mercato/core`
- `@open-mercato/queue`
- `react`
- `react-dom` when directly required by client components

The peer range MUST express the real supported platform line, for example:

```json
{
  "peerDependencies": {
    "@open-mercato/shared": ">=0.4.8 <0.5.0",
    "@open-mercato/ui": ">=0.4.8 <0.5.0",
    "react": "^19.0.0"
  }
}
```

Rules:

- lower bound MUST match the minimum platform version the module actually requires
- upper bound SHOULD stop before the next breaking platform line
- peer ranges MUST be explicit; `*` and empty compatibility markers are forbidden

#### 2.3 `devDependencies`

Package-local `devDependencies` MAY contain package-specific test/build libraries.

Package-local `devDependencies` MUST NOT duplicate exact platform package versions solely to make the repo installable. That responsibility belongs to the root development matrix.

#### 2.4 `workspace:*`

`workspace:*` is allowed only for actual local workspaces inside `official-modules`.

Therefore:

- `workspace:*` for `@open-mercato/shared` is invalid unless `official-modules` itself contains a workspace named `@open-mercato/shared`
- `workspace:*` for `@open-mercato/ui` is invalid unless that package exists locally in the same repo

In the default repository design from SPEC-062, these platform packages come from npm, not from local workspaces. Therefore `workspace:*` MUST be treated as a validation error.

### 3. `open-mercato` Metadata Contract

The existing package metadata block from SPEC-061 / SPEC-062 is extended and clarified:

```json
{
  "open-mercato": {
    "displayName": "Stripe Payments",
    "moduleId": "stripe_payments",
    "ejectable": true,
    "minCoreVersion": "0.4.8",
    "testedCoreRange": ">=0.4.8 <0.5.0"
  }
}
```

Semantics:

- `minCoreVersion`
  - lower bound used by CLI/marketplace UX
  - MUST align with the effective peer floor for required platform packages
- `testedCoreRange`
  - human/CLI-visible statement of the platform line validated in CI
  - MUST be equal to or narrower than the effective peer contract
- `moduleId`
  - runtime module identifier from the Open Mercato module system

This metadata does not replace `peerDependencies`. It complements them.

### 4. Root Platform Version Policy

The repository MUST define one machine-readable root file, for example:

```text
config/platform-version-policy.json
```

Recommended shape:

```json
{
  "version": 1,
  "defaultPlatformRange": ">=0.4.8 <0.5.0",
  "stablePackages": {
    "@open-mercato/shared": "0.4.8",
    "@open-mercato/ui": "0.4.8",
    "@open-mercato/core": "0.4.8",
    "@open-mercato/queue": "0.4.8"
  },
  "previewPackages": {},
  "reactVersion": "^19.0.0"
}
```

This file is the source of truth for exact dev/test versions.

It MUST drive:
- root `package.json` development/test dependencies and/or resolutions
- `apps/sandbox/package.json` exact platform dependencies
- template package peer defaults where no package-specific override is needed
- validation rules that ensure package metadata stays consistent

### 5. Root `package.json` Responsibilities

The root repo package file SHOULD:

- install one exact platform version set for local development
- use `resolutions` where needed to prevent transitive drift during repo tests
- expose scripts such as:
  - `yarn sync:platform-versions`
  - `yarn validate:platform-versions`
  - `yarn platform:use-preview` (optional)

The root is responsible for local determinism.

Module packages are responsible only for compatibility contracts.

### 6. Sandbox Responsibilities

`apps/sandbox/package.json` MUST install one exact platform version set matching the root policy.

The sandbox is the repository’s consumer simulation. Therefore it MUST test:

- package installation against exact stable platform versions
- `mercato generate all`
- at least one module-enabled runtime flow
- preview override installs when preview mode is intentionally enabled

If the sandbox is green on one exact version set, the repo may claim that line as its tested baseline. Without that, `testedCoreRange` is not credible.

### 7. Preview / Canary Policy

Preview platform builds are allowed, but only under a controlled policy:

#### Stable Mainline Rule

The `main` branch of `official-modules` MUST target the latest stable Open Mercato platform line by default.

#### Preview Rule

Canary or preview platform versions MAY be used for:
- feature branches
- temporary preview CI
- Verdaccio validation
- coordinated cross-repo prototyping before a stable platform release

Preview versions MUST be applied through the root version policy and sandbox override flow, not by permanently pinning prerelease versions into every module package manifest.

#### Publication Rule

A module package published as a stable release MUST NOT advertise a prerelease-only Open Mercato peer floor.

If a module truly depends on unreleased platform APIs, then one of these must happen:
- publish only a preview/prerelease module version
- keep the module unreleased until the platform release is stable
- intentionally raise the peer floor only after the relevant stable platform release exists

### 8. Synchronization & Validation Tooling

The repository MUST include two script classes:

#### 8.1 Sync script

Example:

```text
scripts/sync-platform-versions.mjs
```

Responsibilities:
- read `config/platform-version-policy.json`
- update root `package.json`
- update `apps/sandbox/package.json`
- update package template defaults
- optionally update `open-mercato.minCoreVersion` / `testedCoreRange` when using repo-wide defaults

#### 8.2 Validation script

Example:

```text
scripts/validate-platform-manifests.mjs
```

Responsibilities:
- fail if a publishable package uses `workspace:*` for a non-local platform package
- fail if a package places platform packages in `dependencies` instead of `peerDependencies`
- fail if peer ranges do not match policy or package-specific override rules
- fail if `open-mercato.minCoreVersion` and `testedCoreRange` drift from peer ranges
- fail if sandbox/root exact versions drift from policy file

This validator MUST run in CI on every PR.

### 9. Package Versioning vs Platform Compatibility

This policy does not eliminate independent module versioning.

Rule:

- module package version changes when the package changes
- platform compatibility metadata changes only when support requirements change

Examples:

| Change | Module version bump? | Peer range change? |
|--------|----------------------|-------------------|
| Internal bugfix, no new platform API | Yes | No |
| New feature using existing supported platform API | Yes | No |
| Feature now requires `@open-mercato/shared >=0.4.10` | Yes | Yes |
| Repo CI starts testing on newer patch but package still supports old floor | No package change required | No |
| Preview branch tests canary platform | Preview only | No stable peer change |

---

## Data Models

This spec introduces repository configuration and manifest contracts, not business entities.

### `PlatformVersionPolicy`

```ts
type PlatformVersionPolicy = {
  version: 1
  defaultPlatformRange: string
  stablePackages: Record<string, string>
  previewPackages: Record<string, string>
  reactVersion?: string
}
```

### Module Package Compatibility Block

```ts
type ModuleCompatibility = {
  peerDependencies: Record<string, string>
  openMercato: {
    moduleId: string
    minCoreVersion: string
    testedCoreRange: string
    ejectable?: boolean
    displayName?: string
  }
}
```

### Invariants

1. Every required Open Mercato host package imported by a module package must appear in `peerDependencies`
2. No non-local platform package may use `workspace:*`
3. `testedCoreRange` must be a subset of or equal to the package peer contract
4. Root and sandbox exact versions must come from the same policy source
5. Stable publication must not depend on preview-only platform versions

---

## API Contracts

No product HTTP APIs are introduced by this spec. The relevant contracts are repository scripts and package manifest semantics.

### Repository Commands

| Command | Purpose |
|---------|---------|
| `yarn sync:platform-versions` | Apply the root platform policy to manifests and sandbox deps |
| `yarn validate:platform-versions` | Fail on invalid peer/dependency/version contract drift |
| `yarn build` | Build packages against the root exact platform matrix |
| `yarn sandbox:generate` | Validate generator compatibility with compiled package artifacts |
| `yarn sandbox:build` | Smoke-test modules against the exact tested platform versions |
| `yarn publish:preview` | Publish preview module builds without mutating stable peer contracts |

### Manifest Contract

The following package.json semantics are part of the repository contract:

| Field | Contract |
|-------|----------|
| `peerDependencies` | Open Mercato compatibility contract |
| `dependencies` | Third-party runtime dependencies only, except explicit approved runtime package-to-package dependencies |
| `devDependencies` | Local tooling/tests only; not the source of platform compatibility |
| `open-mercato.minCoreVersion` | CLI-visible minimum supported platform version |
| `open-mercato.testedCoreRange` | CI-validated platform line |

### Integration Coverage Matrix

| Flow | Coverage Requirement |
|------|----------------------|
| Clean clone `yarn install` succeeds | Contract test |
| A package using peers only still builds in workspace | Build smoke test |
| Sandbox install/generate/build uses exact stable platform versions from policy | Integration test |
| Validator rejects `workspace:*` on non-local platform package | Unit/contract test |
| Preview override installs canary platform versions without mutating stable peers | CI preview smoke test |
| Published preview package still exposes stable peer contract unless intentionally prerelease-only | Publish contract test |

---

## Internationalization (i18n)

Not applicable. This spec defines repository/package version policy, not product UI copy.

---

## UI/UX

Not applicable in the Open Mercato product UI.

Developer UX requirements:

- one source of truth for exact platform versions
- zero manual bumping of duplicated `@open-mercato/*` versions across packages
- obvious validation error when a maintainer accidentally uses `workspace:*`
- explicit preview workflow for canary testing

---

## Configuration

| File / Env | Purpose |
|------------|---------|
| `config/platform-version-policy.json` | Source of truth for exact platform version matrix |
| `OM_PLATFORM_CHANNEL=stable|preview` | Optional CI/local channel selector |
| `OM_PLATFORM_PREVIEW_VERSION` | Optional explicit prerelease version override |
| `OM_PLATFORM_PREVIEW_TAG` | Optional prerelease dist-tag selector (for example `canary`) |

Rules:

- configuration MUST default to stable
- preview configuration MUST be explicit and opt-in
- preview configuration MUST NOT silently rewrite stable package peer ranges

---

## Migration & Compatibility

This spec is additive relative to SPEC-061 / SPEC-062 / SPEC-063. It clarifies repository versioning rules; it does not change product runtime APIs.

### Migration Rules for `official-modules`

If the repository currently contains package manifests copied from the main monorepo, migration MUST:

1. remove `workspace:*` for non-local `@open-mercato/*` packages
2. move Open Mercato host packages from `dependencies` to `peerDependencies` where applicable
3. centralize exact root/sandbox versions into the platform policy file
4. add sync and validation scripts
5. update package template so new modules inherit the correct contract

### Backward Compatibility Contract

This spec does not alter frozen/stable runtime surfaces in the main monorepo. Its compatibility focus is repository behavior:

- stable published module packages remain independently versioned
- CLI/marketplace compatibility metadata remains additive
- stable consumers must not be forced onto prerelease platform lines by accident

### Compatibility Rules

| Contract | Rule |
|---------|------|
| Standalone repo install | MUST succeed without local Open Mercato platform workspaces |
| Published module package | MUST describe host compatibility with peer ranges |
| Sandbox app | MUST consume exact versions from root policy, not ad hoc per-package pins |
| Preview flow | MUST be isolated from stable package compatibility unless intentionally publishing a prerelease module |

---

## Implementation Plan

### Phase 1 — Policy Source of Truth

1. Create `config/platform-version-policy.json`
2. Decide the default stable platform line and exact package versions
3. Add repository documentation for the difference between package version, peer range, and tested version

### Phase 2 — Manifest Normalization

1. Update package templates to remove invalid `workspace:*` usage for platform packages
2. Move Open Mercato platform packages to `peerDependencies`
3. Add `open-mercato.minCoreVersion` and `testedCoreRange` defaults
4. Remove duplicated exact platform pins from package-local manifests where they are only serving repo installability

### Phase 3 — Root and Sandbox Wiring

1. Sync root `package.json` exact versions from policy
2. Sync `apps/sandbox/package.json` exact platform versions from policy
3. Add `resolutions` or equivalent guardrails where needed
4. Verify `yarn install`, `yarn build`, `yarn sandbox:generate`, and `yarn sandbox:build`

### Phase 4 — Preview Channel

1. Add preview override support to the policy and scripts
2. Wire preview mode into Verdaccio/prototype flows from SPEC-063
3. Ensure preview runs do not mutate default stable peer contracts on `main`

### Phase 5 — Validation & CI

1. Add `scripts/validate-platform-manifests.mjs`
2. Run the validator in CI on every PR
3. Add a clean-install smoke test for the repository
4. Add a preview-mode smoke test

### File Manifest

| File | Repo | Action | Purpose |
|------|------|--------|---------|
| `config/platform-version-policy.json` | official-modules | Create | canonical exact platform version matrix |
| `package.json` | official-modules | Modify | root exact platform deps, scripts, optional resolutions |
| `apps/sandbox/package.json` | official-modules | Modify | exact tested platform versions |
| `packages/_template/package.json` | official-modules | Modify | correct peer/dependency contract for new modules |
| `scripts/sync-platform-versions.mjs` | official-modules | Create | apply version policy to manifests |
| `scripts/validate-platform-manifests.mjs` | official-modules | Create | enforce repository contract |
| `.github/workflows/ci.yml` | official-modules | Modify | add install/build/validator/sandbox checks |

### Testing Strategy

- Unit tests for manifest validator rules
- Contract tests for package manifest normalization
- Clean repository install smoke test
- Sandbox integration test on stable platform matrix
- Preview smoke test on explicit canary override

---

## Risks & Impact Review

### Data Integrity Failures

This spec affects repository manifests and install/build flows, not tenant business data. The main integrity risk is incorrect package metadata causing broken installs or misleading compatibility claims.

### Cascading Failures & Side Effects

Incorrect version policy can cascade into:
- broken local installs
- false-green CI
- modules published with invalid peer contracts
- sandbox results that do not represent real consumers

### Tenant & Data Isolation Risks

Not applicable directly. This is repository/package infrastructure, not runtime tenant data handling.

### Migration & Deployment Risks

The main migration risk is partially converting package manifests and ending up with mixed contracts across packages.

### Operational Risks

- preview channel may drift from stable validation
- maintainers may bypass the sync script and hand-edit manifests
- package managers or linker mode changes may invalidate assumptions about root-installed peer satisfaction

### Risk Register

#### Invalid `workspace:*` Dependency Reintroduced

- **Scenario**: A maintainer copies a package from the main monorepo and leaves `@open-mercato/shared: "workspace:*"` or similar in the package manifest.
- **Severity**: High
- **Affected area**: fresh installs of `official-modules`, CI, contributor onboarding
- **Mitigation**: validator fails PRs; template package uses the correct peer contract
- **Residual risk**: Low

#### Stable Package Publishes Canary Compatibility by Accident

- **Scenario**: Preview platform versions are committed into package peers or metadata on `main`, making a stable module claim prerelease-only requirements.
- **Severity**: High
- **Affected area**: package consumers, marketplace compatibility checks
- **Mitigation**: preview channel handled only through root override policy and prerelease flows; stable release job validates no preview-only peer floors
- **Residual risk**: Low

#### Repo Tests a Different Platform Version Than It Claims

- **Scenario**: `testedCoreRange` says one platform line, but sandbox/root install another due to manual edits or drift.
- **Severity**: High
- **Affected area**: CI trust, release quality, lifecycle diagnostics
- **Mitigation**: one policy file, sync script, CI validator, sandbox smoke tests
- **Residual risk**: Low

#### Peer Range Too Wide for Real Compatibility

- **Scenario**: A module publishes `>=0.4.0 <0.5.0` but actually uses APIs introduced in `0.4.8`.
- **Severity**: Medium
- **Affected area**: consumers on older patch/minor versions within the declared range
- **Mitigation**: lower bound must be derived from real API usage; CI verifies against the claimed tested floor where practical
- **Residual risk**: Medium

#### Root-Linker Assumptions Stop Working

- **Scenario**: The repo switches package-manager linker behavior and package builds can no longer rely on root-installed platform packages satisfying peers during local development.
- **Severity**: Medium
- **Affected area**: local builds, contributor workflow
- **Mitigation**: document node-modules linker assumption for the repo; if linker changes, revisit dev dependency strategy explicitly rather than ad hoc
- **Residual risk**: Medium

---

## Final Compliance Report — 2026-03-14

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/shared/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Keep changes simple and focused | Compliant | Spec isolates package-versioning policy instead of mixing it into lifecycle, sandbox, and publish specs |
| root AGENTS.md | Prefer package-level imports and stable contracts | Compliant | Spec uses package manifest contracts and explicit compatibility metadata |
| root AGENTS.md | Backward compatibility must be respected on stable surfaces | Compliant | No runtime route/type/event removal; spec is additive and repository-scoped |
| `.ai/specs/AGENTS.md` | Non-trivial spec must include full structure | Compliant | Includes TLDR, architecture, risks, compatibility, implementation plan, and compliance report |
| `packages/cli/AGENTS.md` | Standalone apps consume compiled package artifacts from installed packages | Compliant | Sandbox exact-version policy and build/generate validation preserve standalone behavior |
| `packages/create-app/AGENTS.md` | MUST test standalone app behavior realistically | Compliant | Sandbox remains the required validation surface for exact stable and preview platform versions |
| `packages/shared/AGENTS.md` | Shared contracts should remain narrow and reusable | Compliant | Spec keeps compatibility semantics at package boundaries rather than adding domain coupling |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Package manifest rules align with standalone repo architecture | Pass | `workspace:*` forbidden for non-local platform packages |
| Compatibility metadata matches package-manager semantics | Pass | `peerDependencies` plus `open-mercato` metadata have distinct responsibilities |
| Stable vs preview flows are separated clearly | Pass | Preview overrides are repo-wide and opt-in |
| Risks cover install, publish, CI, and drift scenarios | Pass | All major repository failure modes documented |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved as the versioning-policy companion to the `official-modules` repository specs. It closes the gap between package architecture and day-to-day dependency management.

---

## Changelog

### 2026-03-14

- Initial specification for platform/package versioning policy in `official-modules`
- Added rules for peer dependencies, root version policy, preview overrides, and manifest validation
