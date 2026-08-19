# Manufacturing Package and Module Bootstrap

## TLDR

P1.0a creates the additive OSS workspace package `packages/manufacturing`, published as `@open-mercato/manufacturing`, with one opt-in runtime module named `manufacturing`. The module has one hard dependency, `catalog`; WMS, `resources`, and `planner` remain optional peers. The first release exposes only the package root and module discovery entrypoint and does not freeze domain constants or types.

This bootstrap establishes package build, discovery, activation, export, and isolation mechanics only. It introduces no Manufacturing entities, APIs, UI, migrations, ACL, events, WMS calls, or speculative domain contracts. Work is tracked by [Issue #5387](https://github.com/open-mercato/open-mercato/issues/5387) under [Wave 0 tracker #5386](https://github.com/open-mercato/open-mercato/issues/5386).

## Overview

Open Mercato has no standalone workspace package for Manufacturing. P1.0a creates the stable home required by the later Wave 0 capability specifications without mixing package mechanics with BOM, routing, fact-ledger, order, or inventory behavior.

The package contains one runtime module:

```text
packages/manufacturing/                 @open-mercato/manufacturing
  src/index.ts                          intentionally empty package root
  src/modules/manufacturing/index.ts    module metadata and discovery entrypoint
```

The first product flow is discrete manufacturing, but `manufacturing` is the durable module ID. P1.4a/P1.4b and P1.5–P1.11 are separate capability and specification boundaries inside that module, not sibling runtime modules. Model-neutral seams stay separated from discrete aggregates in the internal source layout. A future capability may add an explicit package subpath only when a real second consumer proves the contract; P1.0a does not publish such a seam pre-emptively.

> **Market reference:** N/A. This slice is repository-native package and discovery plumbing rather than a business capability. Existing Open Mercato package, generator, template, and compatibility contracts are the authoritative benchmark.

## Problem Statement

Creating package structure as part of the first BOM or order feature would combine two independently reviewable concerns and make it easy to freeze accidental exports, module IDs, or dependencies. The previous two-module proposal also imposed a runtime boundary between `manufacturing_base` and `manufacturing_discrete` before any separate deployment or lifecycle need existed.

The bootstrap must therefore provide one discoverable, buildable, disabled-by-default module while preserving optional integrations and leaving all business contracts to their dedicated specifications.

## Proposed Solution

Create `@open-mercato/manufacturing` using the repository's standalone-package conventions and expose the generator-compatible module subpath `@open-mercato/manufacturing/modules/manufacturing/index`. Add the package dependency to the standard app and `create-mercato-app` template so it is available for opt-in, but do not add it to either default `enabledModules` registry.

The module metadata declares `name: 'manufacturing'` and `requires: ['catalog']`. It declares no hard dependency on WMS, `resources`, or `planner`; later capability specs must use sanctioned optional-provider, event, widget, or response-enricher seams and define module-absent behavior.

### Design Decisions

| Decision | Rationale |
|---|---|
| One package and one runtime module | Wave 0 capabilities share one product lifecycle and deployment boundary; internal code boundaries are sufficient until evidence supports another module. |
| Module ID `manufacturing` | It is stable, product-facing, and does not make the first discrete model the permanent architecture. |
| Opt-in activation | An empty bootstrap provides no user value and must not change default application behavior. |
| Hard `catalog` requirement | Every planned Manufacturing definition references Catalog-owned product/variant and UoM identity. |
| WMS, `resources`, and `planner` remain optional | Draft authoring and non-stock lifecycle must work without those peers; optional consumers own their glue. |
| Entrypoints only | Publishing unused domain constants/types would freeze contracts before their capability specs exist. |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| `manufacturing_base` plus `manufacturing_discrete` runtime modules | Adds activation, dependency, and compatibility surface without an independent deployable capability. |
| Runtime module `manufacturing_base` | Describes an implementation layer rather than the product capability and would still require another module for the initial workflow. |
| Runtime module `manufacturing_discrete` | Couples the stable module ID to the first operating model and complicates future shared contracts. |
| Enable by default | The bootstrap contains no end-user functionality and should not affect existing installations. |
| Publish domain types immediately | No approved consumer or behavior yet defines their correct shape. |

## User Stories / Use Cases

- **Module developer** wants to enable `manufacturing` explicitly so that later Manufacturing capabilities have a stable package and discovery home.
- **Application maintainer** wants the package installed but disabled by default so that upgrading or generating an app does not change runtime behavior.
- **Capability author** wants a single internal module boundary so that P1.4a/P1.4b and P1.5–P1.11 can be specified independently without inventing sibling runtime modules.

## Architecture

```text
apps/mercato/package.json                 create-app package template
              \                              /
               +-- @open-mercato/manufacturing --+
                                                    |
                                      modules/manufacturing/index
                                                    |
                                      requires: catalog only
                                                    |
                    optional later: WMS / resources / planner
```

Discovery continues to use `src/modules.ts` as the explicit activation list. When an application owner adds `{ id: 'manufacturing', from: '@open-mercato/manufacturing' }`, generators resolve the source tree in the monorepo and built `dist/modules` output in standalone installations. Generated registries remain generated artifacts and are never hand-edited.

The source layout introduced by P1.0a contains metadata only. Later specs may add internal directories for model-neutral contracts and discrete capabilities, but no public package subpath is created until a demonstrated external consumer requires one. Optional peer modules and integrations must not import discrete aggregates or internals.

### Module Metadata Contract

Illustrative metadata, with the standard initial module version:

```ts
export const metadata = {
  name: 'manufacturing',
  title: 'Manufacturing',
  version: '0.1.0',
  description: 'Manufacturing definitions, execution, and production history',
  author: 'Open Mercato Team',
  license: 'MIT',
  ejectable: true,
  requires: ['catalog'],
}
```

The description wording may be refined during implementation. The module `name`, initial `version`, single `catalog` requirement, and absence of optional peer requirements are acceptance contracts.

### Commands & Events

N/A. P1.0a performs no runtime mutation and defines no event. Later business mutations and events belong to their capability specifications.

## Data Models

N/A. The bootstrap creates no entities, migrations, storage, tenant-scoped records, caches, or indexes.

## API Contracts

N/A. The bootstrap creates no API routes, request schemas, or public business interfaces. The module subpath is a discovery/build entrypoint, not a domain API.

## Internationalization (i18n)

N/A. There is no UI or user-facing runtime content in this slice. The metadata title and description follow existing module metadata conventions.

## UI/UX

N/A. No page, navigation item, form, table, dialog, or widget is introduced.

## Configuration

No environment variable is added. Activation is explicit in the host application's `src/modules.ts`:

```ts
{ id: 'manufacturing', from: '@open-mercato/manufacturing' }
```

The line is documentation for opt-in consumers and is not added to the standard app or generated template by default.

## Migration & Compatibility

The package and module are additive. Existing applications remain unchanged because their enabled-module registry does not include `manufacturing`. There is no database migration or backfill. `@open-mercato/shared` is a package peer dependency and development dependency because the entrypoint types its metadata with the canonical `ModuleInfo`; `catalog` remains a runtime module requirement expressed in metadata, not a direct package dependency on `@open-mercato/core`.

Once released, the package name, module ID, and module import subpath become compatibility surfaces under `BACKWARD_COMPATIBILITY.md`. The explicit export map includes only:

- `.` mapped to `src/index.ts` / `dist/index.js`;
- `./modules/manufacturing/index` mapped to the source/dist module entrypoint.

No wildcard or domain export is required by this slice. The normative export shape is:

```json
{
  ".": {
    "types": "./src/index.ts",
    "default": "./dist/index.js"
  },
  "./modules/manufacturing/index": {
    "types": "./src/modules/manufacturing/index.ts",
    "default": "./dist/modules/manufacturing/index.js"
  }
}
```

Source and dist shapes must both support repository discovery. The package dependency appears in both `apps/mercato/package.json` and `packages/create-app/template/package.json.template`; activation appears in neither default `src/modules.ts` file.

## Implementation Plan

### Phase 1: Package scaffold

1. Create `packages/manufacturing/package.json`, `tsconfig.json`, `jest.config.cjs`, `build.mjs`, and `watch.mjs` following a current standalone OSS module package.
2. Create an intentionally empty `src/index.ts` and the single `src/modules/manufacturing/index.ts` metadata entrypoint.
3. Use explicit source/dist export mappings for the package root and module entrypoint.
4. Add the package to the standard app and create-app template dependencies without modifying default enabled-module registries.
5. Add the strict design-system ESLint override for the new module path so later UI starts compliant.

### Phase 2: Discovery and isolation verification

1. Add focused metadata tests for the exact module ID and dependency list.
2. Extend package/template parity coverage for dependency installation and disabled-by-default activation.
3. Exercise generator discovery after explicit fixture activation from source and built package output.
4. Extend module-decoupling/static checks to reject the retired IDs and hard requirements on WMS, `resources`, or `planner`.
5. Verify no generated file is manually committed as source and no domain contract is exported.

### Phase 3: Validation

1. Run package build, typecheck, test, and pack checks.
2. Run the required standalone build order: `yarn build:packages`, `yarn generate`, then `yarn build:packages`.
3. Run create-app template tests and focused module-decoupling/generator tests.
4. Confirm `git diff` contains no unintended generated output or default activation.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/manufacturing/package.json` | Create | Package metadata, scripts, dependencies, and explicit exports |
| `packages/manufacturing/src/index.ts` | Create | Empty package-root entrypoint |
| `packages/manufacturing/src/modules/manufacturing/index.ts` | Create | Single runtime module metadata entrypoint |
| `packages/manufacturing/src/modules/manufacturing/__tests__/metadata.test.ts` | Create | Exact ID, version, and dependency assertions |
| `packages/manufacturing/build.mjs` | Create | Shared package build configuration |
| `packages/manufacturing/watch.mjs` | Create | Shared watch configuration |
| `packages/manufacturing/tsconfig.json` | Create | TypeScript project configuration |
| `packages/manufacturing/jest.config.cjs` | Create | Package test configuration |
| `apps/mercato/package.json` | Modify | Install workspace package; do not activate it |
| `packages/create-app/template/package.json.template` | Modify | Install released package; do not activate it |
| `eslint.ds.config.mjs` | Modify | Add strict design-system lint scope for the new module |
| Relevant generator/template/decoupling tests | Modify | Prove discovery, parity, opt-in behavior, and dependency isolation |

### Testing Strategy

- Assert metadata exports exactly one module ID, `manufacturing`, with `requires: ['catalog']`.
- Assert neither default module registry contains `manufacturing` while both app manifests contain its package dependency.
- Activate the module in a test fixture and assert generated imports resolve from `@open-mercato/manufacturing/modules/manufacturing/index` in source and standalone dist modes.
- Assert no `manufacturing_base` or `manufacturing_discrete` module metadata/entrypoint remains.
- Assert no hard requirement or direct package import is introduced for WMS, `resources`, or `planner`.
- Assert only root and module entrypoint exports exist and no domain constants/types are public.
- Run `yarn workspace @open-mercato/manufacturing build`, `typecheck`, `test`, and package packing validation.
- Run `yarn test:create-app`, focused CLI generator tests, `yarn generate`, and the package build-order sequence.

## Risks & Impact Review

### Data Integrity, Tenant Isolation, and Cache

N/A. There are no records, reads, writes, cross-tenant operations, or cached values. The first data-bearing capability spec must independently define tenant isolation, transactions, indexes, encryption, and cache behavior.

### Commands, APIs, Events, and UI

N/A. There are no mutations, routes, event subscribers, pages, or user input. Canonical commands, zod validation, mutation guards, OpenAPI, DS primitives, and i18n remain mandatory when later specs introduce those surfaces.

#### Accidental default activation
- **Scenario**: The package is added to manifests and also copied into a default `enabledModules` list, enabling an empty or incomplete feature in existing/new applications.
- **Severity**: High
- **Affected area**: Standard app, create-app output, generated registries
- **Mitigation**: Explicit negative tests for both registries and fixture-only activation tests.
- **Residual risk**: A downstream application owner can opt in intentionally, which is the supported behavior.

#### Premature compatibility surface
- **Scenario**: Wildcard exports or placeholder domain types become public and later constrain BOM, fact, or order designs.
- **Severity**: High
- **Affected area**: Package consumers and later capability specs
- **Mitigation**: Explicit two-entry export map and tests that reject domain exports in P1.0a.
- **Residual risk**: The package/module IDs and module entrypoint intentionally become stable after release.

#### Optional peer becomes a hidden hard dependency
- **Scenario**: WMS, `resources`, or `planner` appears in metadata or direct imports and prevents draft-only deployments.
- **Severity**: High
- **Affected area**: Module loading and minimal Manufacturing deployments
- **Mitigation**: Metadata assertions, module-decoupling tests, and no integration code in this slice.
- **Residual risk**: Later stock execution legitimately requires a compatible WMS provider at operation time and must fail closed when unavailable.

#### Source/dist discovery drift
- **Scenario**: Monorepo generation succeeds from source while a published standalone app cannot resolve built module files.
- **Severity**: Medium
- **Affected area**: CLI generation and published package consumers
- **Mitigation**: Explicit source/dist exports, standalone fixture coverage, and prescribed build/generate/build validation order.
- **Residual risk**: Packaging tool changes may require additive test updates.

#### One module leaks discrete internals
- **Scenario**: Later code treats discrete aggregates as reusable model-neutral contracts, blocking safe process or repetitive capabilities.
- **Severity**: High
- **Affected area**: Future Manufacturing operating models
- **Mitigation**: Keep model-neutral seams in internal boundaries, forbid optional modules from importing discrete internals, and publish a reusable subpath only after a real consumer validates it.
- **Residual risk**: A future second model may require additive extraction or a new module boundary; it must not rename the stable `manufacturing` module.

## Final Compliance Report — 2026-08-19

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `packages/shared/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| Root / module-development guide | Modules are discovered from the enabled registry and generated files are not hand-edited | Compliant | Spec uses explicit opt-in activation and `yarn generate`. |
| Root AGENTS | Optional cross-module dependencies degrade gracefully and avoid direct coupling | Compliant | Only Catalog is hard-required; WMS, Resources, and Planner are excluded from bootstrap imports/metadata. |
| Core AGENTS | Test disabled-module behavior and module decoupling | Compliant | Negative registry and dependency tests are required. |
| CLI AGENTS | Support monorepo source and standalone dist discovery with correct build order | Compliant | Both fixture modes and build/generate/build are acceptance checks. |
| create-app AGENTS | Keep template package shape synchronized and tested | Compliant | Dependency is added to both manifests; neither default registry enables the module. |
| Shared AGENTS | Public module/package types must be deliberate compatibility surfaces | Compliant | Only root and discovery entrypoints are exported. |
| BACKWARD_COMPATIBILITY | Auto-discovery, import paths, and generated-file contracts are stable | Compliant | The design is additive and validates source/dist resolution without editing generated artifacts. |
| Design System rules | New module paths use strict DS linting | Compliant | ESLint override is included before any UI exists. |
| Data/API/UI/security rules | Define tenancy, commands, APIs, UI, encryption, and caching | N/A | This metadata-only bootstrap introduces none of these surfaces. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Scope is one independently deployable capability | Pass | One package bootstrap with one opt-in runtime module. |
| Module name matches package, exports, activation, and tests | Pass | `manufacturing` is used consistently. |
| Dependency contract matches degradation behavior | Pass | Catalog is hard; WMS, Resources, and Planner are optional and absent from this slice. |
| Data models match API contracts | N/A | Neither exists. |
| API contracts match UI/UX | N/A | Neither exists. |
| Risks cover all write operations | N/A | No runtime write exists; package/discovery risks are covered. |
| Commands defined for all mutations | N/A | No mutation exists. |
| Cache strategy covers all read APIs | N/A | No read API exists. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Approved at specification level. Implementation remains gated by parent roadmap acceptance.**

## Changelog

- 2026-08-19: Created the P1.0a skeleton and recorded activation, dependency, and export questions.
- 2026-08-19: Resolved the design as one opt-in `manufacturing` module with hard `catalog` dependency, optional WMS/Resources/Planner peers, and entrypoint-only exports.
- 2026-08-19: Expanded the skeleton into an implementation-ready package/discovery specification with compatibility, testing, risks, and compliance review.
- 2026-08-19: Aligned capability numbering after the accepted P1.4a authoring/P1.4b preview split; package, module, dependency, and export contracts are unchanged.

### Review — 2026-08-19

- **Reviewer**: Codex
- **Security**: Passed; no runtime data or user-input surface exists.
- **Performance**: Passed; no runtime workload exists.
- **Cache**: N/A; no read API exists.
- **Commands**: N/A; no mutation exists.
- **Risks**: Passed; activation, public-surface, dependency, discovery, and future-model risks are explicit.
- **Verdict**: Approved. Fresh-context scope-cohesion review returned **KEEP**; no split is warranted.
