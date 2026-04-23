# Empty App Starter Presets

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Codex |
| **Created** | 2026-04-02 |
| **Related** | [2026-03-02-ready-apps-framework.md](./2026-03-02-ready-apps-framework.md), [SPEC-067-2026-03-17-cli-standalone-app-support.md](./SPEC-067-2026-03-17-cli-standalone-app-support.md), [BACKWARD_COMPATIBILITY.md](../../BACKWARD_COMPATIBILITY.md) |

## TLDR

Open Mercato currently scaffolds a "kitchen sink" starter with roughly 44 non-enterprise modules enabled by default. This spec defines an additive, backward-compatible way to create much leaner starters:

- `classic`: current behavior, unchanged
- `empty`: the smallest builder-ready baseline
- `crm`: `empty` plus CRM-only capabilities

Target preset sizes:

| Preset | Enabled modules |
|--------|-----------------|
| `classic` | current default set |
| `empty` | `auth`, `directory`, `configs`, `entities`, `query_index`, `api_docs` |
| `crm` | `empty` + `customers`, `dictionaries`, `feature_toggles` |

This work MUST NOT remove or rename any public module, route, event, feature ID, CLI command, or import path. The change is additive: keep `classic` as the default, introduce preset-based scaffolding, and harden existing hidden module couplings so disabled modules do not crash bootstrap, init, or page rendering.

## Overview

The current starter is excellent for demos but too heavy for teams that want to build from a nearly blank foundation. The user goal is explicit:

- remove `workflows`
- remove `staff`
- remove `customers`
- remove `sales`
- remove `business_rules`
- remove `checkout`
- remove `example`
- remove `catalog`
- preserve a second variant that keeps only CRM
- keep 100% backward compatibility while improving loose coupling

This spec treats that as a scaffold-preset problem plus a module-decoupling problem. The lowest-risk path is:

1. keep the current scaffold as `classic`
2. add new presets for lean starters
3. fix the specific hidden cross-module assumptions that currently make slim presets unsafe

## Problem Statement

Today the generated app and standalone template assume a broad business baseline. That causes four problems:

1. New apps start with many modules that are irrelevant for a blank build.
2. Some modules are only "optional" on paper; runtime code still imports or seeds against them implicitly.
3. The example app module and home page hardcode demo routes that should not exist in an empty starter.
4. Changing the default scaffold directly would be a backward compatibility violation for `create-mercato-app`.

## Current Coupling Audit

The analysis below is limited to runtime-relevant coupling, not tests, docs, or i18n strings.

| Area | Current coupling | Impact on empty starter | Required fix |
|------|------------------|-------------------------|-------------|
| App defaults | `apps/mercato/src/modules.ts` and `packages/create-app/template/src/modules.ts` enable the full suite | Empty starter is impossible without manual editing | Introduce preset-owned module manifests |
| App template UX | `apps/mercato/src/app/page.tsx` and template equivalent hard-link to example routes | Empty starter shows dead links | Make start page links preset-aware and omit example links outside `classic` |
| Example module | `apps/mercato/src/modules/example/**` and template equivalent inject into `customers`, `sales`, `catalog`, `checkout` | Example module cannot survive lean presets | Exclude example module entirely from `empty` and `crm` |
| Auth bootstrap | `packages/core/src/modules/auth/lib/setup-app.ts` imports `entities` encryption maps directly | `auth` is not truly independent | Move default encryption map seeding out of auth into entities-owned setup or a shared optional hook |
| Customers setup/runtime | `packages/core/src/modules/customers/setup.ts` and multiple CRM pages import `feature_toggles`, `dictionaries`, `entities`, `directory`, `auth` | CRM is not just `customers` | Define CRM support modules explicitly and add `ModuleInfo.requires` where appropriate |
| Catalog reverse dependency | catalog commands/routes import `sales` entities/services such as `SalesTaxRate` and `SalesChannel` | `catalog` is not independently removable in a principled way | Short term: disable `catalog` together with `sales`; long term: extract shared tax/channel contracts so `catalog` no longer imports `sales` |
| Sales dependency chain | `sales` already declares `requires: ['catalog', 'customers', 'dictionaries']` and also imports them widely | `sales` must be removed from empty and CRM | No special fix beyond preset exclusion |
| Workflows to business rules | `workflows/lib/start-validator.ts`, `transition-handler.ts`, `seeds.ts`, CLI, and examples depend on `business_rules` | `workflows` is unsafe alone | Add explicit dependency declaration and keep both modules out of lean presets |
| Workflow demos | workflow examples and frontend pages reference `sales` and `checkout` | Demo-only coupling leaks into module package | Move demo/example assets behind classic-only example data or separate example bundle |
| Staff / planner / resources cycle | `planner/api/access.ts` imports `StaffTeamMember`; `resources` requires `planner`; `staff` requires `planner` and `resources` | Removing `staff` alone leaves an incoherent trio | Empty and CRM presets must disable all three; later phase should break the cycle intentionally |
| Customer accounts / portal | `customer_accounts` enrichers and subscribers import `customers`; `portal` already requires `customer_accounts` | Empty starter should not carry portal identity assumptions | Exclude `customer_accounts` and `portal` from `empty` and `crm`; add explicit `customers` dependency if retained later |
| Dashboards | dashboard analytics and widgets import `customers`, `sales`, and `catalog` data | Dashboard module is not minimal | Exclude dashboards from lean presets |
| Backend nav ordering | auth nav and app shell hardcode group order for `customers`, `catalog`, `sales`, `staff` | Cosmetic only, not fatal | Keep behavior; no blocker because absent groups are simply skipped |
| Attachments / query index | attachments and query index contain guarded special cases for `catalog`, `customers`, `sales` via runtime entity checks | Mostly safe | Leave as-is for this phase unless runtime failures appear in tests |

## Proposed Solution

### 1. Add starter presets to `create-mercato-app`

Add a new additive CLI flag:

```bash
npx create-mercato-app my-app --preset classic
npx create-mercato-app my-app --preset empty
npx create-mercato-app my-app --preset crm
```

Rules:

- `classic` is the default when `--preset` is omitted
- `classic` matches current scaffold behavior
- `--preset` is additive to the CLI surface
- `--preset` applies only to the built-in template path, not imported ready apps
- `--preset` is mutually exclusive with `--app` and `--app-url`
- imported ready apps continue to use the snapshot rules from the Ready Apps framework

### 2. Define preset-owned enabled module lists

#### Preset `classic`

Use the current default template module list unchanged.

#### Preset `empty`

Enabled modules:

- `auth`
- `directory`
- `configs`
- `entities`
- `query_index`
- `api_docs`

Rationale:

- `auth` gives login, users, roles, RBAC
- `directory` gives tenant/organization context required by auth and admin scope
- `configs` gives settings surfaces
- `entities` + `query_index` keep the app ready for extension/custom entities
- `api_docs` keeps the starter inspectable for builders and integrators

#### Preset `crm`

Enabled modules:

- all `empty` modules
- `customers`
- `dictionaries`
- `feature_toggles`

Rationale:

- `customers` currently depends on dictionary-backed UI, customer custom fields, and interaction feature flags
- `feature_toggles` is required by current customer interaction setup/runtime
- `dictionaries` is required by current customer forms and detail pages

### 3. Treat collateral removals explicitly

The user-requested removals imply the following additional exclusions in lean presets:

| Requested removal | Collateral exclusion needed now | Why |
|-------------------|---------------------------------|-----|
| `staff` | `planner`, `resources` | current cycle and direct planner import of staff entities |
| `customers` | `customer_accounts`, `portal` | customer identity and portal auth enrich CRM data |
| `sales` | `checkout`, `payment_gateways`, `shipping_carriers` | current sales-adjacent operational chain is not useful in lean presets |
| `catalog` | `dashboards` | dashboard analytics/widgets assume catalog + customers + sales |
| `example` | example routes/widgets/homepage links | app template demo content assumes business modules |
| `workflows` | workflow demo pages/examples | demos reference `sales` and `checkout` |

This is a preset concern only. No public module is removed from the repository.

## Architecture

### Starter preset manifest

Add a single declarative preset manifest in `packages/create-app` that owns:

- enabled module list
- optional file deletions
- optional quick-link/start-page behavior
- optional package dependency pruning rules

Suggested file split:

- `packages/create-app/src/lib/starter-presets.ts` for preset definitions only
- `packages/create-app/src/lib/apply-starter-preset.ts` for resolver, validator, and template mutation logic

The manifest MUST be data-only. Presets MUST NOT embed ad hoc functions or imperative mutation code. All behavioral differences should flow through bounded strategies interpreted by the resolver. This keeps new presets additive, testable, and backward-compatible.

Suggested shape:

```ts
type StarterPresetId = 'classic' | 'empty' | 'crm' | (string & {})

type StarterPresetModules = {
  mode: 'replace' | 'patch'
  enabled?: ModuleEntry[]
  add?: ModuleEntry[]
  remove?: string[]
}

type StarterPreset = {
  id: StarterPresetId
  label: string
  description: string
  extends?: StarterPresetId
  modules: StarterPresetModules
  ui: {
    startPageVariant: 'classic' | 'minimal' | 'crm'
    hideDemoLinks: boolean
  }
  files?: {
    remove?: string[]
  }
  packages?: {
    mode: 'inherit' | 'classic' | 'lean-safe'
    removeDependencies?: string[]
    removeDevDependencies?: string[]
  }
  constraints?: {
    rejectWithReadyApps?: boolean
  }
}
```

This avoids copying the whole template three times.

Notes:

- `modules.mode = 'replace'` declares the full module manifest for a baseline preset
- `modules.mode = 'patch'` allows derived presets such as `crm` to add or remove modules around a base preset
- `extends` is optional and SHOULD be limited to a single parent to avoid deep inheritance trees
- `StarterPresetId` remains open-ended for future built-in presets without changing resolver logic

### Manifest design rules

- `classic` remains an explicit first-class preset, not an implicit fallback hidden in CLI code
- `empty` should be explicit, not derived, because it is the true lean baseline
- `crm` should extend `empty`, because it is semantically "empty plus CRM"
- Built-in presets are for template composition only: module selection, scaffold UI variants, and safe file/dependency pruning
- If a future preset needs its own app module, domain seed data, dedicated README, or onboarding flow, it should become a ready app/example instead of expanding the built-in preset system
- Resolver validation MUST reject duplicate module IDs, unresolved parents, cyclic inheritance, unknown strategy values, and broken `ModuleInfo.requires` combinations

### Example built-in presets

```ts
const starterPresets = {
  classic: {
    id: 'classic',
    label: 'Classic',
    description: 'Current full starter behavior',
    modules: {
      mode: 'replace',
      enabled: CLASSIC_MODULES,
    },
    ui: {
      startPageVariant: 'classic',
      hideDemoLinks: false,
    },
    packages: {
      mode: 'classic',
    },
    constraints: {
      rejectWithReadyApps: true,
    },
  },

  empty: {
    id: 'empty',
    label: 'Empty',
    description: 'Minimal builder-ready baseline',
    modules: {
      mode: 'replace',
      enabled: [
        { id: 'auth', from: '@open-mercato/core' },
        { id: 'directory', from: '@open-mercato/core' },
        { id: 'configs', from: '@open-mercato/core' },
        { id: 'entities', from: '@open-mercato/core' },
        { id: 'query_index', from: '@open-mercato/core' },
        { id: 'api_docs', from: '@open-mercato/core' },
      ],
    },
    ui: {
      startPageVariant: 'minimal',
      hideDemoLinks: true,
    },
    files: {
      remove: ['src/modules/example'],
    },
    packages: {
      mode: 'lean-safe',
    },
    constraints: {
      rejectWithReadyApps: true,
    },
  },

  crm: {
    id: 'crm',
    label: 'CRM',
    description: 'Empty preset plus CRM capabilities',
    extends: 'empty',
    modules: {
      mode: 'patch',
      add: [
        { id: 'customers', from: '@open-mercato/core' },
        { id: 'dictionaries', from: '@open-mercato/core' },
        { id: 'feature_toggles', from: '@open-mercato/core' },
      ],
    },
    ui: {
      startPageVariant: 'crm',
      hideDemoLinks: true,
    },
    packages: {
      mode: 'lean-safe',
    },
    constraints: {
      rejectWithReadyApps: true,
    },
  },
} satisfies Record<string, StarterPreset>
```

This example is illustrative, but the architecture intent is important: new built-in presets should mostly be additive manifest entries, not new imperative branches in `create-mercato-app`.

### Preset resolver / applier

The CLI entrypoint should parse `--preset` and then delegate to a single resolver/applier function. `packages/create-app/src/index.ts` SHOULD NOT accumulate preset-specific `if/else` branches beyond flag parsing, conflict checks, and passing the selected preset ID into the resolver.

The resolver/applier should:

1. resolve the selected preset from the manifest before any filesystem writes
2. reject incompatible source-of-truth combinations such as `--preset` with `--app` or `--app-url`
3. resolve one-level `extends` inheritance in memory
4. validate the final module set for duplicate IDs and `ModuleInfo.requires` compatibility
5. copy the base template
6. write the resolved `src/modules.ts`
7. remove preset-excluded paths such as `src/modules/example`
8. apply start-page and quick-link strategies
9. apply package mutation strategies
10. optionally write `.mercato/starter-preset.json` for later diagnostics

### Template processing flow

For built-in template scaffolding:

1. parse CLI flags and resolve the selected preset in memory
2. validate the preset before any filesystem writes
3. copy the normal template
4. apply preset mutations
5. write preset-specific `src/modules.ts`
6. remove preset-excluded app module folders such as `src/modules/example`
7. rewrite `package.json` only for dependencies the preset explicitly changes
8. rewrite the home page quick links and any visible demo CTA blocks
9. optionally persist a scaffold marker such as `.mercato/starter-preset.json`

### Hidden dependency hardening

The preset system alone is not enough. The following hardening changes are required:

1. `auth` tenant bootstrap must no longer hard-require `entities`
2. `customers` must declare or gracefully gate its real support-module dependencies
3. `workflows` must explicitly declare the `business_rules` dependency
4. `customer_accounts` should explicitly declare dependence on `customers` if it remains CRM-backed
5. module dependency metadata (`ModuleInfo.requires`) must be audited for modules used by lean presets

### Package dependency policy

Phase 1 should optimize for safety, not perfect npm minimalism.

Rules:

- module count is the primary deliverable in this spec
- package pruning is secondary and may be conservative
- infrastructure packages imported by bootstrap (`@open-mercato/core`, `@open-mercato/shared`, `@open-mercato/ui`, `@open-mercato/cli`, `@open-mercato/cache`, `@open-mercato/events`, `@open-mercato/search`) may remain installed even when their module IDs are not enabled
- obviously unused package-backed modules such as `@open-mercato/checkout`, `@open-mercato/ai-assistant`, `@open-mercato/content`, `@open-mercato/onboarding`, `@open-mercato/webhooks`, `@open-mercato/gateway-stripe`, and `@open-mercato/sync-akeneo` may be pruned in the lean presets once green tests confirm no bootstrap import path depends on them

## Data Models

No application entity changes are required.

Optional new create-app internal data:

- data-only starter preset manifest in `packages/create-app/src/lib/starter-presets.ts`
- preset resolver/applier metadata in `packages/create-app/src/lib/apply-starter-preset.ts`
- optional generated marker file such as `.mercato/starter-preset.json`

Both are additive and internal.

## CLI Contract

New contract:

```bash
create-mercato-app <app-name> [--preset classic|empty|crm]
```

Rules:

- default: `classic`
- invalid preset value fails fast before any filesystem writes
- `--preset` is ignored for imported ready apps only if explicitly documented; otherwise reject the combination and ask the user to choose one source of truth

Recommended behavior:

- `--preset` may be combined with `--skip-agentic-setup`, `--registry`, `--verdaccio`
- `--preset` must be rejected when combined with `--app` or `--app-url`

Reason:

- ready apps are complete source snapshots
- presets are built-in template mutations
- combining them creates ambiguous ownership

## UI / UX

For `empty` and `crm`:

- home page must not show example links
- backend navigation must render only existing groups
- no visible link should point at `/example`, `/backend/example`, `/backend/todos`, or demo blog routes
- start page copy should describe the app as a starter foundation, not a demo

For `crm`:

- CRM routes are present
- commerce/workflow/example links are absent

## Migration & Backward Compatibility

This spec is explicitly BC-preserving.

### What MUST stay unchanged

- current no-flag scaffold behavior
- all existing module IDs
- all existing import paths
- all existing API URLs
- all existing event IDs
- all existing ACL feature IDs
- all existing generated file contracts
- `create-mercato-app --app` and `--app-url`

### BC strategy

1. keep current scaffold as `classic`
2. add `--preset` as an optional flag
3. do not remove modules from the repository
4. do not rename any contract surface
5. harden hidden dependencies via additive guards or dependency metadata

### Non-goals for this phase

- changing the default scaffold from classic to empty
- deleting or renaming existing modules
- changing module auto-discovery rules
- restructuring official ready apps

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|------|----------|---------------|------------|---------------|
| Hidden dependency missed during preset creation | High | `mercato init`, bootstrap, page render | Add explicit integration tests for each preset plus dependency audit | Medium |
| Auth bootstrap still implicitly depends on entities | High | tenant initialization | Move encryption-map seeding to entities-owned path before claiming empty preset support | Low |
| CRM preset drifts from real customer dependencies | High | CRM runtime | Add `ModuleInfo.requires` and preset tests that exercise customer pages and seedDefaults | Medium |
| Package pruning removes bootstrap-needed package | Medium | standalone scaffold startup | Phase package pruning separately behind green tests; keep infra packages initially | Low |
| Developers assume empty replaces classic default | Medium | DX / docs | Document default as `classic`; update help text and README examples | Low |
| Workflow/business-rules coupling remains confusing | Medium | future modularity | Declare dependency explicitly now; deeper refactor can be deferred | Low |

## Phasing

### Phase 1: Preset plumbing

- add `--preset`
- implement preset manifest
- generate preset-specific `src/modules.ts`
- remove example app module and demo links in lean presets
- keep `classic` unchanged

### Phase 2: Required coupling fixes

- remove auth bootstrap dependence on entities-owned setup concerns
- add or correct `ModuleInfo.requires` for modules used by `empty` and `crm`
- gate workflow demo/example assets from lean presets

### Phase 3: CRM preset hardening

- make `crm` green with `customers + dictionaries + feature_toggles + empty base`
- verify no accidental dependence on `sales`, `catalog`, `checkout`, `staff`, `workflows`

### Phase 4: Optional lean package pruning

- prune obviously unused package dependencies from `empty` and `crm`
- keep infra packages if bootstrap still imports them

## Implementation Plan

1. Add `--preset` parsing, validation, help text, and mutual-exclusion rules in `packages/create-app/src/index.ts`.
2. Add a data-only preset manifest in `packages/create-app/src/lib/starter-presets.ts`.
3. Add a resolver/applier in `packages/create-app/src/lib/apply-starter-preset.ts` that handles inheritance, validation, and template mutations.
4. Replace the static template `src/modules.ts` with preset-generated content.
5. Remove `src/modules/example/**` from `empty` and `crm`.
6. Rewrite the start page and visible quick links for lean presets.
7. Add bounded strategy handlers for scaffold UI and package mutations instead of preset-specific imperative branches in the CLI.
8. Move default encryption-map seeding out of `packages/core/src/modules/auth/lib/setup-app.ts` into an entities-owned or shared optional path.
9. Audit and add `ModuleInfo.requires` for currently implicit support-module dependencies:
   - `customers`
   - `workflows`
   - `customer_accounts`
   - any other module found during implementation tests
10. Keep `catalog`, `sales`, `checkout`, `staff`, `planner`, `resources`, `workflows`, `business_rules`, `customer_accounts`, `portal`, `dashboards`, and `example` disabled in lean presets.
11. Add template/package dependency mutation rules, but keep bootstrap infrastructure packages unless verified safe to remove.
12. Optionally write `.mercato/starter-preset.json` after scaffold completion for diagnostics and future upgrade tooling.
13. Verify monorepo app and standalone template both scaffold and initialize correctly for all presets.

## Integration Test Coverage

| Scenario | Type |
|----------|------|
| `create-mercato-app my-app` still produces current scaffold | Integration |
| `create-mercato-app my-app --preset empty` produces the 6-module baseline | Integration |
| `create-mercato-app my-app --preset crm` produces the 9-module baseline | Integration |
| preset resolver merges `crm -> empty` inheritance correctly | Unit |
| preset validator rejects duplicate module IDs or unresolved preset parents before filesystem writes | Unit |
| `empty` scaffold: `yarn generate` succeeds | Integration |
| `empty` scaffold: `yarn initialize` succeeds | Integration |
| `empty` scaffold: login page works at `/login` | Integration |
| `empty` scaffold: user/role/settings pages work under `/backend/users`, `/backend/roles`, `/backend/settings` | Integration |
| `empty` scaffold: no example links on `/` and no `/backend/example` navigation entry | Integration |
| `crm` scaffold: customer routes work under `/backend/customers/people`, `/backend/customers/companies`, `/backend/customers/deals` | Integration |
| `crm` scaffold: no `sales`, `catalog`, `checkout`, `workflows`, `staff`, or example navigation | Integration |
| dependency validator rejects broken preset/module combinations | Unit |
| standalone Verdaccio scaffold works for `classic`, `empty`, and `crm` | Integration |

## Final Compliance Report

| Check | Status | Notes |
|------|--------|-------|
| TLDR & Overview | Pass | Included |
| Problem Statement | Pass | Included |
| Proposed Solution | Pass | Included |
| Architecture | Pass | Included |
| Data Models | Pass | Internal-only metadata, no entity changes |
| API / CLI Contracts | Pass | `--preset` defined |
| UI / UX | Pass | Start page and nav rules included |
| Risks & Impact Review | Pass | Concrete risks and mitigations included |
| Phasing | Pass | Four phases defined |
| Implementation Plan | Pass | Concrete steps listed |
| Integration Coverage | Pass | CLI + runtime scenarios listed |
| Migration & BC | Pass | Explicit additive strategy |

## Changelog

- 2026-04-02: Initial draft for additive `empty` and `crm` starter presets, with coupling audit and BC constraints.
- 2026-04-11: Implemented the auth bootstrap encryption-map decoupling step by moving default encryption maps to per-module `encryption.ts` registration discovered by the module generator.
- 2026-04-22: Expanded the spec with a declarative preset manifest contract, resolver/applier split, example preset definitions, and extensibility rules for future built-in presets.
- 2026-04-23: Implemented Phase 1 preset plumbing — `packages/create-app/src/lib/starter-presets.ts` (data-only manifest), `packages/create-app/src/lib/apply-starter-preset.ts` (resolver/applier with inheritance, validation, and filesystem mutations), unit tests in `apply-starter-preset.test.ts` (9 tests, all passing), and `--preset` flag wiring in `packages/create-app/src/index.ts` with mutual-exclusion guard against `--app`/`--app-url`.
