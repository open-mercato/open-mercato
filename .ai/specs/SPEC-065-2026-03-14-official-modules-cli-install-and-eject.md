# SPEC-065: Official Modules CLI Install and Eject

**Date:** 2026-03-14
**Status:** Draft
**Scope:** OSS — `@open-mercato/cli` support for installing official npm modules into Mercato apps and optionally materializing them as app source
**Author:** Open Mercato Team
**Related:** [SPEC-061-2026-03-13-official-modules-lifecycle-management.md](./SPEC-061-2026-03-13-official-modules-lifecycle-management.md), [SPEC-062-2026-03-13-official-modules-development-monorepo.md](./SPEC-062-2026-03-13-official-modules-development-monorepo.md), [SPEC-063-2026-03-13-official-modules-verdaccio-prototyping.md](./SPEC-063-2026-03-13-official-modules-verdaccio-prototyping.md), [SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md](./SPEC-064-2026-03-14-official-modules-platform-versioning-policy.md)

---

## TLDR

**Key Points:**
- Add first-class `mercato module` commands for installing official npm modules into a Mercato app and registering them in app-level `src/modules.ts`.
- Support two installation outcomes: the default installed flow loads modules from official npm packages, while `--eject` materializes module source under app `src/modules/<moduleId>` via an install-plus-eject flow.
- When `--eject` is used, the original npm package remains installed as the origin package for provenance, diffing, and future lifecycle flows, while runtime/build ownership moves to the app module.

**Scope:**
- CLI commands for module install, enable, and eject aliasing
- package manifest contract for official modules
- registration flow into app `src/modules.ts`
- build/generate behavior after package-backed and source-backed install modes
- template/bootstrap changes required for package-backed UI modules

**Concerns:**
- current resolver and generator behavior assumes module source lives under `src/modules/<moduleId>` and compiled output under `dist/modules/<moduleId>`
- Tailwind source scanning in the app is currently static and does not automatically include newly installed UI modules
- lifecycle state tracking from SPEC-061 is intentionally deferred from this MVP

## Overview

Official modules are moving toward a package-based distribution model, but the app-side CLI still has no install UX that understands Open Mercato module conventions. Today a developer can manually run `yarn add`, manually inspect the package for `moduleId`, manually edit `src/modules.ts`, and optionally run `eject` later. That workflow is error-prone, hard to document, and not aligned with the intended official-modules experience.

This spec defines the app-side CLI layer that turns official module packages into usable Mercato modules. It focuses on install and registration, plus an explicit source-materialization path that uses the existing app-module model instead of inventing a second build system inside `apps/mercato/src/modules`.

> **Market Reference:** The design adopts the split seen in shadcn CLI and Backstage plugin installation flows. From shadcn, it adopts source ownership after add. From Backstage, it adopts explicit package installation into the app plus explicit app registration. It rejects copying full package workspaces into the app and rejects implicit auto-enable behavior based only on package presence.

## Problem Statement

The current platform has four gaps that block a clean official-modules experience:

1. There is no single command that installs a package and safely registers its `moduleId` in app `src/modules.ts`.
2. The existing `eject` behavior works at the module-source level, but there is no install-time flow that intentionally lands a module as local app source from the start.
3. The app build pipeline assumes package-backed modules are predeclared in static paths and package layouts, which breaks down once arbitrary official modules are installed.
4. There is no explicit contract for package metadata needed by CLI install flows, such as `moduleId`, ejectability, and supported core range.

Without a formal CLI layer, official modules remain technically possible but operationally manual.

## Proposed Solution

Introduce a `mercato module` command namespace with a manifest-driven install flow limited to official Open Mercato module packages.

Planned MVP command surface:

- `yarn mercato module add <packageSpec>`
- `yarn mercato module add <packageSpec> --eject`
- `yarn mercato module enable <packageName>`
- `yarn mercato module enable <packageName> --eject`
- `yarn mercato module eject <moduleId>`

High-level behavior:

1. CLI installs the package into the consuming app dependency graph.
2. CLI reads package metadata from `package.json` and resolves `moduleId`.
3. CLI validates package layout against current resolver/generator expectations.
4. CLI updates app `src/modules.ts` with either package-backed or app-backed registration.
5. CLI runs module generation and surfaces follow-up steps.

For `--eject`, the package is treated as a distribution vehicle plus retained origin package. The build continues from the main app after source is copied into app `src/modules/<moduleId>` and registered as `from: '@app'`.

This spec explicitly defers:

- `mercato.modules.json`
- update discovery
- outdated/upgrade/doctor lifecycle commands from SPEC-061
- support for non-`@open-mercato/*` packages
- automatic removal of the origin package after source extraction

### Design Decisions

| Decision | Direction |
|----------|-----------|
| Build ownership after eject | Main app build only; no nested package build in `apps/mercato/src/modules` |
| Eject copy scope | Copy module directory only, not whole npm package |
| Resolver compatibility | Keep current `src/modules/<moduleId>` and `dist/modules/<moduleId>` contract |
| App registration source of truth | Continue using app-level `src/modules.ts` |
| Official package scope | Support only `@open-mercato/*` packages with explicit official module metadata |
| `--eject` package retention | Keep package installed after extraction |
| Lifecycle state file | Deferred to SPEC-061 phase |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Copy the full npm package into app source | `apps/mercato/src/modules` is a module tree, not a nested workspace root; copying `package.json` and build scripts there creates a second packaging model |
| Support any third-party package with a matching manifest in MVP | Official-modules rollout already has enough moving parts; cross-vendor trust, support, and diagnostics widen scope too early |
| Remove the origin package immediately after source extraction | Requires dependency promotion and provenance storage in the same MVP, which is a separate architectural problem |
| Ship `module add` without CSS source discovery changes | Package-backed UI modules would install successfully but render with incomplete Tailwind output |
| Infer module eligibility from package name prefix alone | `@open-mercato/*` also contains host packages such as `core`, `ui`, and `shared`; explicit metadata is required |

## User Stories / Use Cases

- **Mercato app developer** wants to run one CLI command to install an official module so that manual editing of `src/modules.ts` is no longer required.
- **Mercato app developer** wants to install an official module directly as local source so that the code is immediately editable inside the app.
- **Framework maintainer** wants package-backed installs to work in standalone apps and monorepo apps so that official modules are tested the same way users consume them.
- **Framework maintainer** wants the old `mercato eject <moduleId>` command to remain valid so that CLI backward compatibility is preserved.

## Architecture

### Command Namespace

The CLI gains a new `module` namespace under `mercato`.

MVP commands:

| Command | Purpose |
|---------|---------|
| `yarn mercato module add <packageSpec> [--module <moduleId>]` | Install and enable a module using the default installed flow |
| `yarn mercato module add <packageSpec> [--module <moduleId>] --eject` | Install, extract source into app modules, and enable as `@app` |
| `yarn mercato module enable <packageName> [--module <moduleId>]` | Enable a package that is already installed |
| `yarn mercato module enable <packageName> [--module <moduleId>] --eject` | Copy an already-installed package into app modules and enable as `@app` |
| `yarn mercato module eject <moduleId>` | Alias to existing eject flow, preserving old top-level `yarn mercato eject <moduleId>` |

Rules:

- `module add` is a compound operation: install package, validate package, mutate app registration, run generators.
- `module enable` MUST NOT install dependencies; with `--eject`, it may also copy source into app `src/modules/`.
- `module eject` is additive and MUST NOT remove or rename the existing top-level `eject` command.

### Official Package Eligibility

This MVP supports only official Open Mercato module packages.

A package is eligible only if all conditions are met:

1. package name is under `@open-mercato/`
2. package `package.json` contains an `open-mercato` block
3. `open-mercato.kind === "module-package"`
4. `open-mercato.moduleId` exists and matches the module folder
5. package contains `dist/modules/<moduleId>`
6. package contains `src/modules/<moduleId>`

This explicit contract prevents accidental treatment of platform packages such as `@open-mercato/core` or `@open-mercato/ui` as installable optional modules.

### Package Manifest Contract

Official module packages MUST expose:

```json
{
  "name": "@open-mercato/test-package",
  "version": "0.1.0",
  "open-mercato": {
    "kind": "module-package",
    "moduleId": "test_package",
    "ejectable": true
  }
}
```

Rules:

- `moduleId` MUST be the source of truth for runtime registration; CLI MUST NOT derive it from the package name.
- `ejectable` gates `--eject` and `module eject`.
- module title and description come from the module `index.ts` metadata, not from `package.json`.

### Installation Target

The dependency owner is the consuming app manifest.

Rules:

- standalone app: install into the app root `package.json`
- monorepo app: install into `apps/mercato/package.json` via workspace-aware package-manager command
- monorepo root `package.json` is not the official install target for this feature

For Yarn-based examples:

- standalone: `yarn add @open-mercato/test-package@preview`
- monorepo: `yarn workspace @open-mercato/app add @open-mercato/test-package@preview`

The CLI MAY detect package manager from `packageManager` or lockfiles, but Yarn support is the mandatory MVP path because current Open Mercato monorepo and standalone guidance are Yarn-first.

### Registration Contract

App-level `src/modules.ts` remains the runtime source of truth.

Registration writes:

- default install:

```ts
{ id: 'test_package', from: '@open-mercato/test-package' }
```

- with `--eject`:

```ts
{ id: 'test_package', from: '@app' }
```

Rules:

- writes MUST be idempotent
- CLI MUST update the `enabledModules` declaration without disturbing conditional feature toggles already present in the file
- duplicate registration of the same module ID MUST fail with a clear error unless the operation is a no-op
- a local app module directory already present at the target path MUST fail closed when `--eject` is used

### Default Install Flow

`module add <packageSpec>` performs:

1. install package into the app dependency graph
2. resolve installed package directory
3. validate official package metadata
4. validate module layout under both `src/modules/<moduleId>` and `dist/modules/<moduleId>`
5. update app `src/modules.ts`
6. update generated CSS source file for package-backed UI scanning
7. run `mercato generate`

Runtime/build ownership remains package-backed.

### Eject Flag Flow

`module add <packageSpec> --eject` performs:

1. run the same install and validation flow as the default install
2. verify `open-mercato.ejectable === true`
3. copy only `src/modules/<moduleId>` into app `src/modules/<moduleId>`
4. rewrite cross-module relative imports using the existing eject behavior
5. register the module as `from: '@app'`
6. run `mercato generate`

Rules:

- the origin package remains installed
- the active runtime source becomes the app module, not the package
- CLI MUST NOT copy package root files such as `package.json`, `build.mjs`, or `tsconfig.json`
- ejectable packages MUST keep module-owned runtime code inside `src/modules/<moduleId>`; imports to sibling package files outside the module directory are invalid when `--eject` is used

### Eject Alias and Backward Compatibility

The current top-level command:

```bash
yarn mercato eject <moduleId>
```

MUST continue to work unchanged.

The new command:

```bash
yarn mercato module eject <moduleId>
```

is an alias and shared entrypoint, not a replacement. This keeps CLI contract surface #12 additive-only per `BACKWARD_COMPATIBILITY.md`.

### Build and Generator Behavior

#### Package-backed modules

- standalone apps consume built `dist/modules/<moduleId>` JavaScript
- app registration points to the package import path
- source remains in the package only

#### Source-backed modules

- app registration points to `@app`
- generator imports resolve to app-local source
- app build compiles the copied source as part of the main app
- the retained origin package is not the active runtime source

### CSS Source Discovery

Package-backed UI modules require dynamic Tailwind source registration.

This spec introduces one generated CSS include, for example:

```text
.mercato/generated/module-package-sources.css
```

The file contains `@source` entries for installed package-backed official modules.

App bootstrap changes:

- `apps/mercato/src/app/globals.css` imports the generated CSS file once
- the equivalent template file in `packages/create-app/template/src/app/globals.css` MUST be updated in the same implementation

Rules:

- only package-backed modules appear in the generated CSS source file
- source-backed modules rely on normal app-source scanning and do not need package-source entries
- generated CSS files remain machine-managed under `.mercato/generated/`

### Failure and Undo Model

`module add` is not a transactional database operation. It is a filesystem/package-manager compound command.

Required behavior:

- if package installation fails, CLI exits with no registration changes
- if validation fails after package install, CLI MUST NOT mutate app source or `src/modules.ts`
- if registration or source extraction fails, CLI MUST leave the app in a fail-closed state and print remediation guidance
- if `mercato generate` fails after registration, CLI exits non-zero and reports that the module is enabled but generated artifacts are stale

This MVP does not require automatic rollback of package-manager side effects.

## Data Models

This spec introduces no database entities. The relevant data models are manifest and generated-file contracts.

### `OpenMercatoModulePackageMetadata`

```ts
type OpenMercatoModulePackageMetadata = {
  kind: 'module-package'
  moduleId: string
  ejectable: boolean
}
```

### `ModuleAddFlags`

```ts
type ModuleAddFlags = {
  eject?: boolean
}
```

### Generated CSS Source File

The generated CSS include is an additive generated-file contract.

Content shape example:

```css
@source "../../../../node_modules/@open-mercato/test-package/src/**/*.{ts,tsx}";
@source "../../../../node_modules/@open-mercato/another-module/src/**/*.{ts,tsx}";
```

## API Contracts

This spec introduces CLI contracts, not HTTP APIs.

### `module add`

- Usage: `yarn mercato module add <packageSpec> [--module <moduleId>] [--eject]`
- Input:
  - `packageSpec`: npm package spec such as `@open-mercato/test-package@preview`
  - optional `--module <moduleId>` for multi-module packages
  - optional `--eject`, default `false`
- Validation:
  - package must resolve under `@open-mercato/*`
  - package must declare `open-mercato.kind === "module-package"`
  - module layout must match CLI expectations
- Side effects:
  - installs package
  - mutates `src/modules.ts`
  - optionally copies source into app module tree
  - regenerates generated artifacts

### `module enable`

- Usage: `yarn mercato module enable <packageName> [--module <moduleId>] [--eject]`
- Input:
  - installed package name only
  - optional `--module <moduleId>` for multi-module packages
  - optional `--eject`, default `false`
- Validation:
  - package must already be installed
  - package must satisfy the same official-module checks as `module add`
  - `ejectable` is required when `--eject` is used
- Side effects:
  - mutates `src/modules.ts`
  - optionally copies source into app module tree
  - regenerates generated artifacts

### `module eject`

- Usage: `yarn mercato module eject <moduleId>`
- Contract:
  - shares behavior with existing `yarn mercato eject <moduleId>`
  - MUST preserve old command behavior

### Exit Semantics

- `0`: command completed successfully
- non-zero: package not installed, invalid manifest, registration failure, extraction failure, or generator failure

## Internationalization (i18n)

No product UI i18n changes are introduced by this spec.

CLI console output remains aligned with current CLI conventions and is outside the backend UI translation system.

## UI/UX

This is a CLI UX spec.

Expected experience:

- the default installed flow is the simplest path
- `--eject` is explicit and opt-in
- manual `yarn add` followed by `module enable` is supported for registry testing and Verdaccio workflows
- manual `yarn add` followed by `module enable --eject` is supported when the package is already present but local ownership is desired
- CLI errors are fail-closed and explain the exact missing contract, for example:
  - missing `open-mercato.kind`
  - missing `src/modules/<moduleId>`
  - module already registered
  - `ejectable` required for `--eject`

Sample flows:

```bash
yarn mercato module add @open-mercato/test-package@preview
yarn mercato module add @open-mercato/test-package@preview --eject
yarn add @open-mercato/test-package@preview
yarn mercato module enable @open-mercato/test-package
yarn mercato module enable @open-mercato/test-package --eject
yarn mercato module eject test_package
```

## Configuration

This spec adds no new mandatory env vars.

The install flow reuses existing package-manager and registry configuration, including `.npmrc` and scoped registry overrides already used for Verdaccio prototyping.

## Migration & Compatibility

- This is now a breaking CLI contract change relative to the earlier module-add option shape.
- Existing `yarn mercato eject <moduleId>` remains supported unchanged.
- `module add` now exposes a single optional install-shape flag: `--eject`.
- `module enable` also accepts the same optional `--eject` flag for already-installed packages.
- No database migration is introduced.
- No generated-file contract is removed; the CSS source file is additive.
- `mercato.modules.json` is explicitly deferred to later lifecycle work in SPEC-061.

Compatibility rules:

| Contract | Rule |
|---------|------|
| CLI commands | Existing commands remain intact; new `module` commands are additive |
| Package layout | Packages MUST ship both `src/modules/<moduleId>` and `dist/modules/<moduleId>` |
| App module model | `--eject` reuses existing `@app` module semantics |
| Standalone template | Bootstrap changes in `apps/mercato/src/app/**` must be mirrored in `packages/create-app/template/src/app/**` |

## Implementation Plan

### Phase 1 — Manifest and Registration Contract
1. Add official module package manifest parser/validator in `packages/cli/src/lib/`.
2. Add `src/modules.ts` update utility that is idempotent and preserves existing conditional pushes.
3. Keep install validation limited to official manifest and module layout checks.

### Phase 2 — Package Mode Install
1. Add `mercato module add` and `mercato module enable` command parsing in `packages/cli/src/mercato.ts`.
2. Implement package-manager install flow for the consuming app manifest.
3. Add generated CSS source file support for package-backed modules.
4. Update `apps/mercato/src/app/globals.css` and `packages/create-app/template/src/app/globals.css` to import the generated CSS include.

### Phase 3 — Eject Flag and Eject Alias
1. Reuse and harden existing eject internals for `module add --eject`.
2. Add `mercato module eject` alias while preserving `mercato eject`.
3. Validate `--eject` constraints around module-local file boundaries.

### Phase 4 — Verification
1. Add unit tests for manifest parsing, modules.ts mutation, and CSS source generation.
2. Add integration coverage for monorepo and standalone install flows.
3. Add Verdaccio-backed standalone smoke tests for preview package install.

### File Manifest

| File | Repo | Action | Purpose |
|------|------|--------|---------|
| `packages/cli/src/mercato.ts` | main repo | Modify | add `module` command namespace |
| `packages/cli/src/lib/eject.ts` | main repo | Modify | share eject implementation with `--eject` |
| `packages/cli/src/lib/resolver.ts` | main repo | Modify | support install-target and package validation helpers |
| `packages/cli/src/lib/generators/*` | main repo | Modify | generate package-source CSS include and related artifacts |
| `apps/mercato/src/app/globals.css` | main repo | Modify | import generated package-source CSS |
| `packages/create-app/template/src/app/globals.css` | main repo | Modify | keep standalone template in sync |
| `packages/create-app/agentic/**` | main repo | Review/Modify | update standalone guidance if CLI command surface changes user workflow |
| `packages/cli/src/**/__tests__` | main repo | Create/Modify | unit coverage |
| `.ai/qa/tests/**` | main repo | Create/Modify | integration coverage for install flows |

### Testing Strategy

- Unit tests:
  - official package manifest validation
  - module ID resolution from installed package
  - idempotent `src/modules.ts` update
  - package-source CSS generation
  - `--eject` rejection when package is not ejectable
- Integration tests:
  - `module add` installs and enables package-backed module in monorepo dev
  - `module add --eject` installs, copies source, and builds from app source
  - manual `yarn add` plus `module enable`
  - standalone app install against Verdaccio preview package
  - old `mercato eject` command remains valid

### Integration Coverage Matrix

| Flow | Coverage Requirement |
|------|----------------------|
| package-backed install via CLI | Integration test |
| `--eject` install via CLI | Integration test |
| enable already installed official package | Integration test |
| package-backed UI module CSS source generation | Integration test |
| standalone app generate/build after install | Integration test |
| old eject alias compatibility | Unit + integration test |

## Risks & Impact Review

### Data Integrity Failures

#### Partial Install Without Registration
- **Scenario**: Package manager install succeeds, but manifest validation or registration fails afterward.
- **Severity**: Medium
- **Affected area**: App dependency graph, CLI UX
- **Mitigation**: CLI validates before mutating app source and reports "installed but not enabled" as a distinct state.
- **Residual risk**: The app may keep an unused dependency until the developer removes it manually.

#### Stale Generated Artifacts After Registration
- **Scenario**: `src/modules.ts` or source extraction succeeds, but `mercato generate` fails.
- **Severity**: Medium
- **Affected area**: Buildability of the app after command exit
- **Mitigation**: CLI exits non-zero and gives explicit remediation guidance to rerun generation after resolving the underlying error.
- **Residual risk**: App workspace remains changed and may not build until generators are rerun.

### Cascading Failures & Side Effects

#### Hidden Runtime Dependency Leakage with `--eject`
- **Scenario**: Ejected source compiles only because the origin package still happens to pull transitive dependencies into the install tree.
- **Severity**: High
- **Affected area**: Source-backed module portability and long-term maintainability
- **Mitigation**: Ejectable packages must keep module-owned code inside `src/modules/<moduleId>` and MUST NOT rely on sibling package files; `--eject` validation blocks obviously invalid layouts.
- **Residual risk**: Some package-manager hoisting behaviors can still mask undeclared direct dependencies until a stricter environment is used.

#### Broken Styling for Package-Backed UI Modules
- **Scenario**: Module installs and registers successfully, but Tailwind does not scan package sources.
- **Severity**: High
- **Affected area**: Backend/frontend UI rendering of installed module pages and widgets
- **Mitigation**: Generated CSS source include is part of MVP, not a follow-up.
- **Residual risk**: If the bootstrap import is removed manually, package-backed UI modules can silently degrade.

### Tenant & Data Isolation Risks

This feature does not introduce tenant-scoped storage or cross-tenant APIs. Isolation risk is minimal because the CLI modifies app configuration and source files only.

#### Wrong Module Registered in the App
- **Scenario**: CLI mis-resolves `moduleId` and enables the wrong module path.
- **Severity**: Medium
- **Affected area**: App routing, generated registries, module bootstrap
- **Mitigation**: `moduleId` comes from explicit package metadata and must match both `src/modules/<moduleId>` and `dist/modules/<moduleId>`.
- **Residual risk**: A malformed official package can still publish inconsistent metadata if validation in the upstream repo is weak.

### Migration & Deployment Risks

#### Standalone Template Drift
- **Scenario**: Monorepo app shell is updated to support package-backed CSS scanning, but the standalone template is not.
- **Severity**: High
- **Affected area**: `create-mercato-app` generated projects
- **Mitigation**: Template sync is part of the implementation plan and mandatory per `packages/create-app/AGENTS.md`.
- **Residual risk**: Future bootstrap changes can drift again if template sync discipline is not enforced in reviews.

#### CLI Contract Drift
- **Scenario**: New `module eject` behavior diverges from legacy `eject`.
- **Severity**: Medium
- **Affected area**: Existing users and scripts depending on `mercato eject`
- **Mitigation**: Alias behavior shares one implementation path and the old command remains supported.
- **Residual risk**: Future refactors can accidentally privilege one entrypoint over the other if tests cover only the new namespace.

### Operational Risks

#### Registry-Specific Failures During Preview Installs
- **Scenario**: Verdaccio or scoped registry configuration is unavailable during `module add`.
- **Severity**: Medium
- **Affected area**: Local prototyping and preview validation
- **Mitigation**: CLI relies on existing package-manager registry configuration and fails before source mutation if package install cannot complete.
- **Residual risk**: The user still needs correct `.npmrc` setup; CLI cannot heal registry auth/config automatically in this MVP.

## Final Compliance Report — 2026-03-14

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Spec-first for non-trivial features | Compliant | New CLI feature captured in SPEC-065 before implementation |
| root AGENTS.md | Generated files under `apps/mercato/.mercato/generated/` are machine-managed | Compliant | CSS source include is additive and generated |
| root AGENTS.md | Enable modules in app `src/modules.ts` | Compliant | Spec keeps `src/modules.ts` as source of truth |
| root AGENTS.md | CLI commands are stable contract surface | Compliant | Old `eject` command retained, new commands additive |
| `.ai/specs/AGENTS.md` | Non-trivial spec includes core sections and risks | Compliant | Spec includes required sections and risk review |
| `packages/cli/AGENTS.md` | Standalone apps rely on package-backed module discovery | Compliant | Spec keeps `dist/modules/<moduleId>` requirement |
| `packages/cli/AGENTS.md` | Generated output goes to `.mercato/generated/` | Compliant | New CSS include is generated there |
| `packages/create-app/AGENTS.md` | Standalone template must not break | Compliant | Template sync explicitly required |
| `packages/create-app/AGENTS.md` | Build before publish for standalone consumption | Compliant | Spec validates `dist/modules` and aligns with published-package flow |
| `BACKWARD_COMPATIBILITY.md` | CLI commands additive-only | Compliant | `module` namespace adds commands, does not remove old ones |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | Manifest model drives command validation |
| API contracts match UI/UX section | Pass | CLI flows and sample commands align |
| Risks cover all write operations | Pass | install, registration, extraction, generation covered |
| Commands defined for all mutations | Pass | add, enable, eject alias specified |
| Cache strategy covers all read APIs | N/A | No HTTP read API or cache introduced |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation

## Changelog

### 2026-03-14
- Initial skeleton specification created
- Resolved scope decisions:
  - `--eject` keeps the origin package installed
  - MVP supports only official `@open-mercato/*` module packages
  - `mercato.modules.json` deferred to later lifecycle work
- Expanded skeleton into full install/eject CLI specification

### 2026-03-19
- Replaced the documented `module add` mode selector with a single `--eject` flag.
- Simplified `module add` to a single optional `--eject` flag.

### Review — 2026-03-14
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: N/A
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Manifest and Registration Contract | Done | 2026-03-14 | Added manifest parsing/validation and AST-aware `src/modules.ts` mutation helpers |
| Phase 2 — Package Mode Install | Done | 2026-03-14 | Added `mercato module add` / `mercato module enable`, install flow, package-source CSS generator, and app/template CSS imports |
| Phase 3 — Eject Flag and Eject Alias | Done | 2026-03-14 | Reused eject internals for `--eject`, added `mercato module eject`, preserved legacy `mercato eject`, and validated `--eject` boundaries |
| Phase 4 — Verification | Done | 2026-03-14 | Added unit + integration coverage; standalone preview install is validated with self-contained package-spec fixtures in this repo while Verdaccio publish infrastructure remains covered by SPEC-063 |

### Phase 1 — Detailed Progress
- [x] Step 1: Add official module package manifest parser/validator in `packages/cli/src/lib/`
- [x] Step 2: Add `src/modules.ts` update utility that is idempotent and preserves existing conditional pushes
- [x] Step 3: Keep install validation limited to official manifest and module layout checks

### Phase 2 — Detailed Progress
- [x] Step 1: Add `mercato module add` and `mercato module enable` command parsing in `packages/cli/src/mercato.ts`
- [x] Step 2: Implement package-manager install flow for the consuming app manifest
- [x] Step 3: Add generated CSS source file support for package-backed modules
- [x] Step 4: Update `apps/mercato/src/app/globals.css` and `packages/create-app/template/src/app/globals.css` to import the generated CSS include

### Phase 3 — Detailed Progress
- [x] Step 1: Reuse and harden existing eject internals for `module add --eject`
- [x] Step 2: Add `mercato module eject` alias while preserving `mercato eject`
- [x] Step 3: Validate `--eject` constraints around module-local file boundaries

### Phase 4 — Detailed Progress
- [x] Step 1: Add unit tests for manifest parsing, `modules.ts` mutation, hoisted package resolution, and CSS source generation
- [x] Step 2: Add integration coverage for monorepo and standalone install/eject flows in `.ai/qa/tests/integration/TC-INT-007.spec.ts`
- [x] Step 3: Validate standalone preview-style package installation with self-contained package-spec fixtures; external Verdaccio publication workflow remains specified in SPEC-063

### Verification
- [x] `yarn workspace @open-mercato/cli test`
- [x] `yarn workspace @open-mercato/cli typecheck`
- [x] `yarn workspace @open-mercato/cli build`
- [x] `npx playwright test --config .ai/qa/tests/playwright.config.ts .ai/qa/tests/integration/TC-INT-007.spec.ts --workers=1 --retries=0`
- [x] `yarn build:packages`
- [x] `yarn test`
- [ ] `yarn lint` — fails in existing `@open-mercato/app` lint script with `Invalid project directory provided, no such directory: /Users/dpalatynski/Private/open-mercato-latest/apps/mercato/lint`
