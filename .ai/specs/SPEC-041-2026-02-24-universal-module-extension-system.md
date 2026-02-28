# SPEC-041 — Universal Module Extension System (UMES)

| Field | Value |
|-------|-------|
| **Status** | In Progress (Phases A-H Implemented) |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Issue** | [#675](https://github.com/open-mercato/open-mercato/issues/675) |
| **Related** | [PR #635 — Record Locking](https://github.com/open-mercato/open-mercato/pull/635), SPEC-035 (Mutation Guard), SPEC-036 (Request Lifecycle Events), SPEC-043 (Reactive Notification Handlers) |

## TLDR

Evolve the widget injection system into a **Universal Module Extension System (UMES)** — a coherent, DOM-inspired framework that lets modules extend any UI surface, intercept any mutation, transform any API response, and replace any component — all without touching core code. Unify the currently fragmented extension mechanisms (widget injection, event subscribers, entity extensions, mutation guards) under a single mental model with consistent APIs.

---

## Phased Implementation Plan

Each phase is a separate PR, independently mergeable, with example module demonstrations and integration tests. Phase sub-specs contain full technical detail, code examples, integration tests, and testing notes.

| Phase | Sub-Spec | PR Branch | Summary | Depends On |
|-------|----------|-----------|---------|------------|
| **A** | [SPEC-041a — Foundation](./SPEC-041a-foundation.md) | `feat/umes-foundation` | `InjectionPosition` enum, headless widget types, `useInjectionDataWidgets` hook | — |
| **B** | [SPEC-041b — Menu Injection](./SPEC-041b-menu-injection.md) | `feat/umes-menu-injection` | `useInjectedMenuItems`, `mergeMenuItems`, profile/sidebar/topbar chrome | A |
| **C** | [SPEC-041c — Events & DOM Bridge](./SPEC-041c-events-dom-bridge.md) | `feat/umes-event-bridge` | `onFieldChange`, transformers, `clientBroadcast`, `useAppEvent`, SSE bridge | A |
| **D** | [SPEC-041d — Response Enrichers](./SPEC-041d-response-enrichers.md) | `feat/umes-response-enrichers` | `ResponseEnricher` contract, `enrichMany`, CRUD factory integration | — |
| **E** | [SPEC-041e — API Interceptors](./SPEC-041e-api-interceptors.md) | `feat/umes-api-interceptors` | `ApiInterceptor` before/after, Zod re-validation, metadata passthrough | D |
| **F** | [SPEC-041f — DataTable Extensions](./SPEC-041f-datatable-extensions.md) | `feat/umes-datatable-extensions` | Column, row action, bulk action, filter injection into DataTable | A, D |
| **G** | [SPEC-041g — CrudForm Fields](./SPEC-041g-crudform-fields.md) | `feat/umes-crudform-fields` | Field injection into form groups, triad pattern (enricher→field→onSave) | A, D |
| **H** | [SPEC-041h — Component Replacement](./SPEC-041h-component-replacement.md) | `feat/umes-component-replacement` | Component registry, `useRegisteredComponent`, replace/wrapper/props modes | A |
| **I** | [SPEC-041i — Detail Page Bindings](./SPEC-041i-detail-page-bindings.md) | `feat/umes-detail-bindings` | `useExtensibleDetail`, `InjectedField`, `runSectionSave` | D, G |
| **J** | [SPEC-041j — Recursive Widgets](./SPEC-041j-recursive-widgets.md) | `feat/umes-recursive-widgets` | Widget-level `InjectionSpot`, nested event handlers | A |
| **K** | [SPEC-041k — DevTools](./SPEC-041k-devtools.md) | `feat/umes-devtools` | UMES DevTools panel, build-time conflict detection | All |
| **L** | [SPEC-041l — Integration Extensions](./SPEC-041l-integration-extensions.md) | `feat/umes-integration-extensions` | Wizard widgets, status badges, external ID mapping display | A, C, D, G |
| **M** | [SPEC-041m — Mutation Lifecycle](./SPEC-041m-mutation-lifecycle.md) | `feat/umes-mutation-lifecycle` | Guard registry, sync event subscribers (lifecycle events), client-side event filtering, command interceptors | E |
| **N** | [SPEC-041n — Query Engine Extensibility](./SPEC-041n-query-engine-extensibility.md) | `feat/umes-query-engine-extensibility` | Query-level enricher opt-in, unified enricher registry for Basic/Hybrid query engines, sync query events (`*.querying`/`*.queried`) with filter/query/result transforms | D, M |

### Implementation Progress Snapshot (2026-02-27)

| Phase | Status | Notes |
|-------|--------|-------|
| A — Foundation | Done | `InjectionPosition`, headless injection loader path, and `useInjectionDataWidgets` are implemented with docs and tests. |
| B — Menu Injection | Done | `useInjectedMenuItems` + `mergeMenuItems` are implemented for sidebar/topbar/profile surfaces with integration coverage. |
| C — Events & DOM Bridge | Done | Extended widget event handlers and SSE DOM bridge (`useAppEvent`, `useOperationProgress`) are implemented. |
| D — Response Enrichers | Done | Enricher contract/registry/runner and CRUD factory integration are implemented with generator/bootstrap wiring. |
| E — API Interceptors | Done | Core contracts/registry/runner, CRUD integration, generation/bootstrap, unit tests, and Playwright coverage are implemented. |
| F — DataTable Extensions | Done | Column/row-action/filter deep extension surfaces and bulk-actions runtime execution are wired with unit/integration coverage. |
| G — CrudForm Fields | Done | Injected field pipeline, full example triad flow, and Playwright coverage are implemented. |
| H — Component Replacement | Done | Registry/hook/provider/generator wiring, handles, replace-mode props schema validation, and integration coverage are implemented. |

### Dependency Graph

```
A (Foundation) ──────┬────────────────────────────────────────────────┐
  │                  │                                                │
  ├── B (Menus)      ├── C (Events + DOM Bridge) ────────────────────┤
  │                  │                                                │
  │                  │          D (Enrichers) ── independent ─────────┤
  │                  │            │                                   │
  │                  │            ├── E (Interceptors)                │
  │                  │            │     │                             │
  │                  │            │     └── M (Mutation Lifecycle) ◄──┤
  │                  │            │                                   │
  │                  │            ├── F (DataTable Ext.)              │
  │                  │            │                                   │
  │                  │            ├── G (CrudForm Fields)             │
  │                  │            │     │                             │
  │                  │            │     ├── I (Detail Bindings)       │
  │                  │            │     │                             │
  │                  │            │     └── L (Integration Ext.) ◄── C
  │                  │            │                                   │
  │                  ├── H (Component Replacement) ──────────────────┤
  │                  │                                                │
  │                  └── J (Recursive Widgets) ──────────────────────┤
  │                                                                   │
  └──────────────────────────── K (DevTools) ◄───────────────────────┘
```

### Parallelization

- **Wave 1** (after A): B, C, D, H, J — all independent
- **Wave 2** (after D): E, F, G — all depend only on D
- **Wave 3** (after E+G+C): I, L, M — I depends on G; L depends on A, C, D, G; M depends on E
- **Wave 4** (after D+M): N — extends both query engines with opt-in query enrichers + sync query events
- **Wave 5** (after all): K — integrates everything

### Minimum Viable UMES

For teams wanting the highest-impact subset: **A + D + F** gives cross-module data enrichment + injected DataTable columns and row actions.

---

## Problem Statement

Open Mercato has **five separate extension mechanisms** that evolved independently:

| Mechanism | What it extends | Where defined |
|-----------|----------------|---------------|
| Widget Injection | UI surfaces (CrudForm, DataTable headers, detail tabs) | `widgets/injection-table.ts` + `widgets/injection/*/widget.ts` |
| Event Subscribers | Backend side-effects (create/update/delete reactions) | `subscribers/*.ts` |
| Entity Extensions | Data model (add fields/relations to other module's entities) | `data/extensions.ts` |
| Mutation Guards | Write operations (block/modify saves) | `@open-mercato/shared/lib/crud/mutation-guard.ts` |
| Custom Fields | User-defined entity attributes | `ce.ts` |

### Problems

1. **No component replacement** — Cannot replace another module's dialog, form section, or table cell renderer
2. **No API response enrichment** — No GraphQL-federation-like "extend the response from outside"
3. **No API action interception** — Modules cannot inject middleware into another module's API routes
4. **Limited DataTable extensibility** — No way to add columns, row actions, or bulk actions externally
5. **No CrudForm field injection** — Widgets add UI sections but cannot inject fields into existing groups
6. **Widgets can't extend widgets** — No recursive extensibility; the injection system is flat
7. **Fragmented mental model** — Five different patterns for five different kinds of extension

### Goal

Create a unified extension framework where **any module can extend any other module's UI, data, and behavior** through a single, coherent API.

---

## Design Principles

| # | Principle | Inspiration |
|---|-----------|-------------|
| 1 | **Actions vs Transformers** — Distinguish "do something" from "transform something" | WordPress actions vs filters |
| 2 | **Declarative Registration, Lazy Activation** — Declare capabilities in metadata; load code only when needed | VSCode contribution points |
| 3 | **Named, Typed Extension Points** — Every extension point has a string ID, typed contract | Shopify extension targets |
| 4 | **Priority & Ordering** — Deterministic priority-based ordering | WordPress priority system |
| 5 | **Federation over Modification** — Extend data by composition, not mutation | GraphQL Federation |
| 6 | **Removal & Override** — Extensions can be disabled, overridden, or replaced | WordPress `remove_action` |
| 7 | **Recursive Extensibility** — Extensions can define their own extension points | WordPress custom hooks |
| 8 | **Coherence over Duplication** — Integrate with existing systems, don't duplicate | Open Mercato architecture |
| 9 | **Progressive Disclosure** — Simple cases stay simple; advanced cases are possible | Existing widget injection |
| 10 | **Type Safety** — All contracts fully typed via TypeScript generics and Zod | Open Mercato convention |

---

## Architecture Overview

### Unified Extension Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNIVERSAL MODULE EXTENSION SYSTEM             │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │  UI Layer     │  │  Data Layer  │  │  Behavior Layer        ││
│  │              │  │              │  │                        ││
│  │ • Slots      │  │ • Response   │  │ • Mutation Guards      ││
│  │ • Replacements│  │   Enrichment │  │ • API Middleware       ││
│  │ • Field Inj. │  │ • Field      │  │ • Sync Subscribers     ││
│  │ • Column Inj.│  │   Extension  │  │   (lifecycle hooks)    ││
│  │ • Action Inj.│  │   (existing) │  │ • Async Subscribers    ││
│  │ • Widget Ext.│  │              │  │   (existing)           ││
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────────┘│
│         │                 │                    │                │
│  ┌──────┴─────────────────┴────────────────────┴───────────────┐│
│  │                 Extension Registry                          ││
│  │  • Module manifests (extensions.ts)                         ││
│  │  • Auto-discovery & code generation                         ││
│  │  • Priority resolution & conflict detection                 ││
│  │  • Feature-gated activation                                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Extension Point Taxonomy

All extension points use a unified string ID format: `<layer>:<module>.<entity>:<surface>:<position>`

Examples:
- `ui:catalog.product:crud-form:fields` — inject fields into product form
- `ui:catalog.product:data-table:columns` — inject columns into product table
- `data:customers.person:response:enrich` — enrich customer API response
- `api:sales.order:create:before` — intercept before order creation

**Backward compatibility**: Existing spot IDs remain fully supported. The new taxonomy is additive.

---

## Coherence with Existing Systems

### When to Use What

| I want to... | Use | Phase |
|--------------|-----|-------|
| Add UI to another module's page | Widget Injection (UI slots) | A |
| Add items to profile menu / sidebar nav | Menu Item Injection | B |
| React to app events in widgets | DOM Event Bridge (`useAppEvent`) | C |
| Add data to another module's API response | Response Enricher | D |
| Validate/block an API mutation | API Interceptor `before` | E |
| Add columns to a data table | Column Injection | F |
| Add fields to a form | Field Injection (triad pattern) | G |
| Replace a component entirely | Component Replacement | H |
| Extend detail pages (fields, columns, tabs) | `useExtensibleDetail` | I |
| Multi-step setup wizards (OAuth, sync config) | Wizard Widget | L |
| Persistent health/status badges | Status Badge Widget | L |
| Display external ID mappings on entities | External ID Enricher + Widget | L |
| Share state between widgets in same module | Widget Shared State | A |
| Track long-running operation progress | `useOperationProgress` | C |
| Dynamic field options from external APIs | `optionsLoader` on field | G |
| Custom field component (mapping editor, etc.) | `type: 'custom'` field | G |
| Conditional field visibility | `visibleWhen` on field | G |
| Block/modify mutation cross-module (entity-level) | Sync subscriber for `*.creating`/`*.updating` | M |
| Post-mutation side-effect cross-module (sync, entity-level) | Sync subscriber for `*.created`/`*.updated` | M |
| Final validation gate (locks, policies, limits) | Mutation Guard Registry | M |
| Post-mutation cleanup (multi-guard) | Mutation Guard afterSuccess | M |
| Filter widget handlers by operation (create/update) | Widget event filter | M |
| Modify input before a command runs (cross-module) | Command Interceptor `beforeExecute` | M |
| Block undo of a specific command | Command Interceptor `beforeUndo` | M |
| Add side-effects after command execute/undo | Command Interceptor `afterExecute`/`afterUndo` | M |
| Validate/block a form save from UI | Widget `onBeforeSave` | Existing |
| React to a completed operation | Event Subscriber | Existing |
| Add data model relations | Entity Extension | Existing |
| Add user-configurable fields | Custom Fields/Entities | Existing |

### What Does NOT Change

| Existing System | Status |
|----------------|--------|
| Event subscribers (`subscribers/*.ts`) | **Extended** — new `sync: true` metadata flag for lifecycle events; async subscribers unchanged |
| Entity extensions (`data/extensions.ts`) | **Unchanged** — remain the pattern for data model links |
| Custom fields/entities (`ce.ts`) | **Unchanged** — remain the pattern for user-defined attributes |
| Mutation guards (`mutation-guard.ts`) | **Evolved** — singleton bridged to registry; interceptors complement at different layer |
| Widget injection (current) | **Extended** — all existing APIs preserved, new capabilities added |

### Complete Event Flow

```
User clicks Save (Cmd+Enter)
  │
  ├─  1. [UI]    Client-side Zod validation              (existing)
  ├─  2. [UI]    Widget transformFormData pipeline         (Phase C — filtered by operation, Phase M)
  ├─  3. [UI]    Widget onBeforeSave handlers             (existing — can block, filtered by operation)
  ├─  4. [UI]    Widget onSave handlers                   (existing — widget data persists BEFORE core API)
  ├─  5. [UI→API] Core API call (onSubmit)                (existing — sends core fields to server)
  │    │
  │    ├─  5a. [API]  Server-side Zod validation          (existing)
  │    ├─  5b. [API]  API Interceptor before hooks        (Phase E — cross-module, route-level)
  │    ├─  5c. [API]  Sync before-event subscribers       (Phase M — cross-module, event-driven)
  │    ├─  5d. [API]  CrudHooks.beforeCreate/Update/Delete (existing — module-local)
  │    ├─  5e. [API]  Mutation Guard Registry validate    (Phase M — cross-module, multi-guard)
  │    ├─  5f. [Core] Entity mutation + ORM flush         (existing)
  │    ├─  5g. [API]  CrudHooks.afterCreate/Update/Delete (existing — module-local)
  │    ├─  5h. [API]  Mutation Guard Registry afterSuccess (Phase M — cross-module, multi-guard)
  │    ├─  5i. [API]  Sync after-event subscribers        (Phase M — cross-module, event-driven)
  │    ├─  5j. [API]  API Interceptor after hooks         (Phase E — cross-module, route-level)
  │    └─  5k. [API]  Response Enrichers                  (Phase D)
  │
  ├─  6. [UI]    Widget onAfterSave handlers              (existing — filtered by operation, Phase M)
  └─  7. [Async] Event Subscribers                        (existing — fire-and-forget)
```

**Important**: Widget `onSave` (step 4) fires BEFORE the core API call (step 5). This matches the actual `CrudForm.tsx` implementation (lines 1483 vs 1495). See [SPEC-041g](./SPEC-041g-crudform-fields.md) for implications and mitigation.

---

## Extension Manifest & Discovery

### Module Extension Files

```
src/modules/<module>/
├── index.ts               # Existing: module metadata
├── acl.ts                 # Existing: permissions
├── events.ts              # Existing: event declarations
├── data/
│   ├── entities.ts        # Existing
│   ├── extensions.ts      # Existing: entity extensions
│   ├── enrichers.ts       # NEW (Phase D): response enrichers
│   └── guards.ts          # NEW (Phase M): mutation guards
├── api/
│   ├── <routes>           # Existing
│   └── interceptors.ts    # NEW (Phase E): API interceptors
├── commands/
│   └── interceptors.ts    # NEW (Phase M): command interceptors
├── widgets/
│   ├── injection-table.ts # Existing: slot mappings
│   ├── injection/         # Existing: widget implementations
│   └── components.ts      # NEW (Phase H): component replacements
└── subscribers/           # Existing: event subscribers
```

### Auto-Discovery

`yarn generate` discovers new files and generates registries into `apps/mercato/.mercato/generated/`:
- `enrichers.generated.ts` — enricher registry (Phase D)
- `interceptors.generated.ts` — interceptor registry (Phase E)
- `component-overrides.generated.ts` — component override registry (Phase H)
- `status-badges.generated.ts` — status badge widget registry (Phase L)
- `guards.generated.ts` — mutation guard registry (Phase M)
- `command-interceptors.generated.ts` — command interceptor registry (Phase M)

---

## Integration Test Summary

| Phase | Tests | Count |
|-------|-------|-------|
| A — Foundation | TC-UMES-F01–F02 | 2 |
| B — Menus | TC-UMES-M01–M04 | 4 |
| C — Events + DOM Bridge | TC-UMES-E01–E06 | 6 |
| D — Response Enrichers | TC-UMES-R01–R06 | 6 |
| E — API Interceptors | TC-UMES-I01–I09 | 9 |
| F — DataTable Extensions | TC-UMES-D01–D06 | 6 |
| G — CrudForm Fields | TC-UMES-CF01–CF05 | 5 |
| H — Component Replacement | TC-UMES-CR01–CR06 | 6 |
| I — Detail Bindings | TC-UMES-DP01–DP04 | 4 |
| J — Recursive Widgets | TC-UMES-RW01–RW02 | 2 |
| K — DevTools | TC-UMES-DT01–DT02 | 2 |
| L — Integration Extensions | TC-UMES-L01–L06 | 6 |
| M — Mutation Lifecycle | TC-UMES-ML01–ML10 | 10 |
| M — Command Interceptors | TC-UMES-CI01–CI10 | 10 |
| **Total** | | **78** |

See each phase sub-spec for detailed test scenarios, example module additions, and testing notes.

---

## API & UI Coverage Matrix

This matrix links each phase test pack to the primary API paths and key UI surfaces it must cover.

| Phase | API Paths (minimum) | UI Paths (minimum) |
|-------|----------------------|--------------------|
| A — Foundation | Widget registry bootstrap + generated injection registries | Sidebar injection spots, generic injection host rendering |
| B — Menus | Nav metadata endpoint consumption (existing path) | Profile dropdown, main sidebar, settings/profile section nav, backend header actions |
| C — Events + DOM Bridge | SSE notifications stream + event broadcast transport | CrudForm widget handlers, `useAppEvent` listeners on data pages |
| D — Response Enrichers | CRUD list/detail routes of target entities (e.g., `/api/customers/people`, `/api/customers/people/:id`) | DataTable/detail pages consuming enriched fields |
| E — API Interceptors | Target CRUD routes for before/after interception (including wildcard route patterns) | Forms and flows that call intercepted APIs |
| F — DataTable Extensions | List routes that power table rows and filter queries | `DataTable` columns, row actions, bulk actions, filter UI |
| G — CrudForm Fields | Detail/read routes (load), field persistence routes (save) | `CrudForm` field groups, validation/save lifecycle |
| H — Component Replacement | Any API route used by replaced/wrapped component | Target components and their host pages |
| I — Detail Bindings | Detail page load + section save routes | Customer and sales detail pages using `useExtensibleDetail` |
| J — Recursive Widgets | Existing CRUD save/delete routes reached by nested widgets | Nested `InjectionSpot` rendering and nested lifecycle hooks |
| K — DevTools | Dev-only extension inspection endpoint(s) and generator conflict checks | DevTools panel toggle, extension inspection UI |
| L — Integration Extensions | Integration health check routes, sync external ID mapping routes, wizard data persistence routes | Wizard step navigation, status badge polling, external ID section on detail pages |
| M — Mutation Lifecycle | All CRUD mutation routes (POST/PUT/DELETE) for guarded entities, guard registry bootstrap, command bus execute/undo | CrudForm save pipeline with filtered widget handlers, guard rejection error display, command interceptor error handling |

---

## Performance Acceptance Criteria

These are release-gate thresholds for the first production rollout of UMES:

| Area | Threshold | Gate |
|------|-----------|------|
| Response enrichers (`enrichMany`) | P95 enricher stage latency <= 100ms; hard fail threshold 500ms | Block release if hard threshold exceeded in integration profiling |
| Interceptor chain | Added P95 request latency <= 50ms for routes with <=3 interceptors | Block release if exceeded without approved exception |
| DataTable extension merge | Column/action/filter merge adds <= 16ms on client render for 100-row page | Block release if exceeded |
| DevTools overhead | Production bundle impact = 0 (dev-only code path) | Block release if any devtools code ships to prod bundle |

Profiling and measurement MUST be included in phase-level implementation PR notes.

---

## Final Compliance Report

| Check | Status |
|-------|--------|
| No direct ORM relationships between modules | PASS — enrichers use read-only EM, no cross-module entity imports |
| All entities filtered by organization_id | PASS — enricher context always includes organizationId |
| Zod validation for all inputs | PASS — interceptor schemas, component propsSchema |
| RBAC feature gating | PASS — all extension types support `features` array |
| No raw fetch | PASS — enrichers use EM, interceptors use framework internals |
| Backward compatible with existing injection system | PASS — all existing APIs preserved |
| Auto-discovery via CLI generator | PASS — follows existing `yarn generate` pattern |
| i18n for user-facing strings | PASS — all labels use i18n keys |

---

## Risks & Impact Review

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Performance from enrichers (N+1) | High | Require `enrichMany`; timing budget (100ms warn, 500ms error); cache |
| 2 | Component replacement breaks props | High | Enforce `propsSchema` via Zod; runtime validation in dev |
| 3 | Circular extension dependencies | Medium | Dependency graph analysis at `yarn generate`; circular = build error |
| 4 | Priority conflicts | Medium | Build-time detection; require explicit priority |
| 5 | Interceptor blocks legitimate requests | High | Include `interceptorId` in errors; fail-closed with timeout (5s default); dev-mode error details |
| 6 | Backward compatibility | Critical | All existing APIs preserved; new features additive |
| 7 | Complexity for simple modules | Medium | Progressive disclosure; AGENTS.md scaffolding guides |
| 8 | Enrichers expose cross-tenant data | Critical | `EnricherContext` scoped to tenant; code review checklist |

---

## Feature-Gated Activation

All extension types support `features?: string[]` for ACL-based activation. Extensions are only loaded when the current user has the required features. This reuses the existing RBAC system — no new permission model needed.

---

## Migration & Backward Compatibility

UMES changes several public contract surfaces and therefore follows the deprecation protocol from `BACKWARD_COMPATIBILITY.md`.

### Contract Surfaces Affected

- Type definitions and interfaces in shared/widget and CRUD extension contracts
- Function signatures and hooks in CRUD factory + injection hooks
- Auto-discovery conventions (`data/enrichers.ts`, `data/guards.ts`, `api/interceptors.ts`, `commands/interceptors.ts`, `widgets/components.ts`) as additive files
- Subscriber metadata extension (`sync`, `priority` fields) in existing `subscribers/*.ts`
- Generated bootstrap contracts (`enrichers.generated.ts`, `interceptors.generated.ts`, `component-overrides.generated.ts`, `guards.generated.ts`, `command-interceptors.generated.ts`)

### Compatibility Rules

1. Existing spot IDs and existing widget contracts remain valid and unmodified.
2. Existing CRUD hooks (`beforeList`, `afterList`, etc.) remain available with unchanged signatures.
3. Existing APIs are additive-only: no route removals, no response field removals.
4. Existing generated bootstrap fields remain intact; new fields/files are additive.
5. Any future rename/removal of UMES contracts requires:
   - `@deprecated` JSDoc
   - compatibility bridge for at least one minor version
   - RELEASE_NOTES entry with migration guidance

### Migration Guidance for Module Authors

- Existing injection widgets continue to work without migration.
- New UMES extension types are opt-in and can be adopted incrementally.
- Module authors should adopt `enrichMany` for list scenarios from day one to avoid N+1 regressions.

---

## AGENTS.md Changes Required for UMES

This section specifies what must change in each AGENTS.md file to make UMES a first-class documented pattern.

### Root `AGENTS.md` — Additions

**Task Router rows to add:**

| Task | Guide |
|------|-------|
| Adding mutation guards, entity-level validation/blocking | `packages/core/AGENTS.md` → Mutation Guards |
| Adding sync event subscribers, cross-module before/after lifecycle hooks | `packages/core/AGENTS.md` → Sync Event Subscribers |
| Adding command interceptors, before/after execute/undo hooks | `packages/core/AGENTS.md` → Command Interceptors |
| Adding response enrichers, data federation | `packages/core/AGENTS.md` → Response Enrichers |
| Adding API interceptors, cross-module validation | `packages/core/AGENTS.md` → API Interceptors |
| Replacing or wrapping another module's component | `packages/core/AGENTS.md` → Component Replacement |
| Injecting columns/row actions into DataTable | `packages/ui/AGENTS.md` → DataTable Extension Injection |
| Injecting fields into CrudForm groups | `packages/ui/AGENTS.md` → CrudForm Field Injection |
| Adding menu items to sidebar/profile/topbar | `packages/core/AGENTS.md` → Menu Item Injection |
| Bridging server events to client widgets | `packages/events/AGENTS.md` → DOM Event Bridge |
| Using `useExtensibleDetail` for detail pages | `packages/ui/src/backend/AGENTS.md` → Extensible Detail Pages |
| Scaffolding a new UMES extension (widget, enricher, interceptor, component override) | `packages/core/AGENTS.md` → UMES Scaffolding Guide |

**Optional Module Files to add:**

| File | Export | Purpose |
|------|--------|---------|
| `data/enrichers.ts` | `enrichers` | Response enrichers for other modules' entities |
| `data/guards.ts` | `guards` | Mutation guards (entity-level validation/blocking) |
| `api/interceptors.ts` | `interceptors` | API route interceptors (before/after hooks) |
| `commands/interceptors.ts` | `interceptors` | Command bus interceptors (before/after execute + undo hooks) |
| `widgets/components.ts` | `componentOverrides` | Component replacement/wrapper declarations |

**Imports to add:**

| Need | Import |
|------|--------|
| Response enricher types | `import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'` |
| Mutation guard types | `import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'` |
| Sync event subscriber types | `import type { SyncCrudEventPayload, SyncCrudEventResult } from '@open-mercato/shared/lib/crud/sync-event-types'` |
| API interceptor types | `import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'` |
| Command interceptor types | `import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'` |
| Injection position enum | `import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'` |
| App event hook | `import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'` |
| Extensible detail hook | `import { useExtensibleDetail } from '@open-mercato/ui/backend/injection/useExtensibleDetail'` |
| Injected menu items hook | `import { useInjectedMenuItems } from '@open-mercato/ui/backend/injection/useInjectedMenuItems'` |

**Key Rules to add:**
- Response enrichers MUST implement `enrichMany` for list endpoints (N+1 prevention)
- Response enrichers MUST NOT modify or remove existing fields (additive only)
- API interceptors that modify request body MUST return data that passes the route's Zod schema
- Injected columns read data from response enrichers — pair every column injection with an enricher
- `clientBroadcast: true` on events enables the DOM Event Bridge
- Mutation guards MUST handle `resourceId: null` for create operations
- Sync after-event subscribers MUST NOT return `ok: false` (after-subscribers cannot block)
- Guards targeting `'*'` and sync subscribers matching broad patterns MUST be lightweight — they run on every mutation
- Sync event subscribers use `sync: true` + `priority` in existing `subscribers/*.ts` metadata — no new file convention
- Command interceptors use `commands/interceptors.ts` auto-discovery — symmetric with `api/interceptors.ts`
- Command interceptor `beforeExecute` can block (return `ok: false`) or modify input (`modifiedInput`) — no Zod re-validation since the command owns its schema
- Command interceptor `beforeUndo` can block undo — **only mechanism** for undo interception

**Critical Rules → Architecture to add:**
- NO direct entity import from another module's enricher — use EntityManager
- Response enrichers run AFTER `CrudHooks.afterList` — they do not change what existing hooks receive
- API interceptor `before` hooks run AFTER Zod validation; modified body is re-validated
- Component replacements MUST maintain the original component's props contract

### Package-Level AGENTS.md New Sections

| File | New Sections |
|------|-------------|
| `packages/core/AGENTS.md` | Response Enrichers, API Interceptors, Command Interceptors, Mutation Guards, Sync Event Subscribers, Component Replacement, Menu Item Injection, UMES Scaffolding Guide |
| `packages/ui/AGENTS.md` | DataTable Extension Injection, CrudForm Field Injection |
| `packages/ui/src/backend/AGENTS.md` | Extensible Detail Pages |
| `packages/events/AGENTS.md` | DOM Event Bridge |
| `.ai/qa/AGENTS.md` | Testing UMES Extension Points |

**Total**: 11 new sections across 6 files. All existing content preserved — changes are purely additive.

---

## UMES Scaffolding Guide (for AGENTS.md)

Instead of CLI scaffolding commands, UMES scaffolding is handled by LLM agents via AGENTS.md instructions. The following section MUST be added to `packages/core/AGENTS.md` under a new "UMES Scaffolding Guide" heading.

### Scaffolding a Widget Injection

When asked to scaffold a widget injection into another module's page:

1. Create `widgets/injection/<widget-name>/widget.ts` (or `widget.client.tsx` if it needs React)
2. Export `metadata` with `id` (`<module>.injection.<name>`), `title`, and `features`
3. If headless (columns, fields, menu items): export the data declaration only, no `Widget` component
4. If interactive: export a `Widget` React component with `({ context, data }: WidgetProps)` signature
5. Add event handlers (`onBeforeSave`, `onSave`, `onAfterSave`) if the widget participates in save lifecycle
6. Add entry to `widgets/injection-table.ts` mapping spot ID → `{ widgetId, priority }`
7. Run `yarn generate` to register the widget

**Spot ID format**: `<surface>:<entityId>:<position>` (e.g., `crud-form:customers.person:group:details`, `data-table:customers.person:columns`)

### Scaffolding a Response Enricher

When asked to add data to another module's API response:

1. Create `data/enrichers.ts` in the module root
2. Export an array of `ResponseEnricher` objects with: `id`, `targetEntity`, `enrichOne(record, context)`, `enrichMany(records, context)`
3. Enricher MUST use `context.em` (EntityManager) for data access — NO direct entity imports from target module
4. Enriched data MUST be namespaced under `_<module>` prefix (e.g., `_loyalty.tier`)
5. `enrichMany` MUST batch-load to prevent N+1 queries
6. Run `yarn generate` to register the enricher

### Scaffolding an API Interceptor

When asked to validate, block, or modify another module's API operations:

1. Create `api/interceptors.ts` in the module root
2. Export an array of `ApiInterceptor` objects with: `id`, `targetRoute`, `methods`, `before?(request, context)`, `after?(request, response, context)`
3. `before` hooks can return `{ ok: false, message }` to reject, `{ ok: true, body }` to modify
4. Modified body MUST pass the target route's Zod schema (re-validated automatically)
5. `after` hooks can transform the response body
6. Run `yarn generate` to register the interceptor

### Scaffolding a Component Replacement

When asked to replace or wrap another module's component:

1. Create `widgets/components.ts` in the module root
2. Export an array of component override declarations with: `id`, `targetComponentId`, `mode` (`replace` | `wrapper` | `propsTransform`)
3. For `replace`: provide the full replacement component maintaining the original props contract
4. For `wrapper`: provide a wrapper that renders children and adds behavior
5. For `propsTransform`: provide a function that transforms props before they reach the original component
6. Include `propsSchema` (Zod) for runtime validation in dev mode
7. Run `yarn generate` to register the override

### Scaffolding a Mutation Guard

When asked to validate, block, or transform another module's mutations:

1. Create `data/guards.ts` in the module root
2. Export an array of `MutationGuard` objects with: `id`, `targetEntity`, `operations`, `validate(input)`
3. `validate` can return `{ ok: false, message }` to block, `{ ok: true, modifiedPayload }` to transform
4. Guards for `create` operations must handle `resourceId: null`
5. `afterSuccess` is optional — use for cleanup, cache invalidation, or audit logging
6. Run `yarn generate` to register the guard

### Scaffolding a Sync Event Subscriber

When asked to react to or modify another module's entity operations cross-module:

1. Create a subscriber file in `subscribers/` (e.g., `subscribers/validate-customer-email.ts`)
2. Export `metadata` with: `event` (lifecycle event ID like `customers.person.creating`), `sync: true`, `priority`, `id`
3. Export a default async handler receiving `(payload: SyncCrudEventPayload, ctx)` and returning `SyncCrudEventResult | void`
4. Before-event subscribers (event ends in `*.creating`/`*.updating`/`*.deleting`) can block (`ok: false`) or modify data (`modifiedPayload`)
5. After-event subscribers (event ends in `*.created`/`*.updated`/`*.deleted`) are for side-effects only — they cannot block or modify
6. Before-events are auto-derived from existing `events.ts` config — NOT declared separately
7. Run `yarn generate` to register the subscriber (uses existing subscriber auto-discovery)

### Scaffolding a Command Interceptor

When asked to hook into another module's command execute/undo lifecycle:

1. Create `commands/interceptors.ts` in the module root
2. Export an array of `CommandInterceptor` objects with: `id`, `targetCommand`, `priority`, optional `features`
3. `beforeExecute` can return `{ ok: false, message }` to block, `{ ok: true, modifiedInput }` to transform command input
4. `afterExecute` receives the result and can return `{ modifiedResult }` to augment it
5. `beforeUndo` can block undo — this is the **only mechanism** for undo interception
6. `afterUndo` runs cleanup after successful undo (cannot block)
7. Target command patterns: exact (`customers.people.update`), module wildcard (`customers.*`), global (`*`)
8. Run `yarn generate` to register the interceptor

### Scaffolding a Field Injection (Triad Pattern)

When asked to add fields to another module's CrudForm:

1. Create a response enricher (`data/enrichers.ts`) to load the field data — see "Scaffolding a Response Enricher"
2. Create a headless field widget (`widgets/injection/<name>/widget.ts`) declaring the `fields` array with `id`, `label`, `type`, `group`, `placement`, and `readOnly`
3. Add `onSave` handler to persist the field value via the module's own API
4. Add `onBeforeSave` handler if validation is needed before core save
5. Map the widget to the target form's field injection spot in `injection-table.ts`
6. Add translations for field labels
7. Run `yarn generate`

**This is the "triad pattern"**: enricher loads data → field widget renders → onSave persists.

---

## Appendices

### Appendix A — Codebase Analysis Insights

Key implementation details from deep-diving into the actual codebase:

1. **Runtime Architecture**: Widget injection uses `globalThis` keys for HMR (`__openMercatoCoreInjectionWidgetEntries__`, `__openMercatoCoreInjectionTables__`), lazy loading via `entry.loader()`, wildcard matching via regex, priority sorting `(b.priority ?? 0) - (a.priority ?? 0)`
2. **Scoped Headers**: `withScopedApiRequestHeaders` bridges client widgets to server API — standard pattern for all UMES extensions. Widget `onBeforeSave` returns `requestHeaders`, `useGuardedMutation` wraps the operation, and all `apiCall()` invocations within include the scoped headers
3. **CRUD Factory Hooks**: `CrudHooks` (before/afterList, before/afterCreate, before/afterUpdate, before/afterDelete) + mutation guards already exist; UMES interceptors compose with them at precise pipeline positions
4. **Bootstrap Order**: New registries follow existing pattern — generated files → bootstrap registration → `globalThis` for HMR
5. **Record-Locking Patterns**: Primary instance election (global Map), client-side state store (pub/sub), beacon-based cleanup, portal rendering — UMES should formalize these as standard widget utilities
6. **Command Bus Integration**: Command Interceptors (Phase M) hook into the command bus pipeline (`beforeExecute` → `prepare` → `execute` → `captureAfter` → `buildLog` → `afterExecute`) and undo (`beforeUndo` → `undo` → `markUndone` → `afterUndo`). See [SPEC-041m4](./SPEC-041m4-command-interceptors.md)
7. **Event System**: Ephemeral (in-process) vs persistent (queue) subscribers; interceptors are synchronous and can modify, subscribers are async and react
8. **DataTable Current Gaps**: Supports header/footer injection spots but no column, row action, filter, or bulk action injection — Phase F fills this
9. **CrudForm Save Flow**: `handleSubmit` → blur flush → required validation → CE validation → Zod → widget `onBeforeSave` → `withScopedApiRequestHeaders` → `onSubmit` → widget `onAfterSave`
10. **Generated Files**: `apps/mercato/.mercato/generated/` — `injection-widgets.generated.ts` and `injection-tables.generated.ts` use `loader: () => import(...)` for lazy loading

### Appendix B — Competitive Analysis Summary

| Platform | Strengths Adopted | Weaknesses Avoided |
|----------|-------------------|---------------------|
| **WordPress** | Actions vs Filters; priority system; recursive hooks | Global mutable state; no type safety |
| **Shopify** | Extension targets (typed string IDs); constrained components | Overly restrictive; no cross-extension communication |
| **VSCode** | Contribution points (declarative); lazy activation | Complex activation model; process isolation overhead |
| **GraphQL Federation** | `@key` + `@extends` for data composition | Gateway complexity; debugging distributed queries |
| **Browser Extensions** | Content scripts inject into any page; pattern-based targeting | No component-level granularity; security risks |

**Key patterns adopted:**
1. Actions vs Transformers (WordPress) → `onBeforeSave` vs `transformFormData`
2. Typed Extension Targets (Shopify) → Standardized spot ID taxonomy
3. Lazy Activation (VSCode) → Existing `loader()` pattern
4. Data Federation (GraphQL) → Response enrichers
5. Pattern Matching (Browser) → Wildcard spot IDs
6. Priority System (WordPress) → Existing priority in injection tables
7. Removal API (WordPress) → Component override with conditional hiding

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial draft — complete spec with all phases |
| 2026-02-24 | Split into phased sub-specs (SPEC-041a through SPEC-041k) for LLM context management |
| 2026-02-24 | Replace CLI scaffolding commands with AGENTS.md scaffolding guide for LLM-driven scaffolding |
| 2026-02-25 | Add API/UI coverage matrix, rollout strategy, migration/backward compatibility section, and measurable performance acceptance criteria |
| 2026-02-25 | Add Phase L (Integration Extensions) — wizard widgets, status badges, external ID mapping display. Amend phases A, C, D, G with integration-driven improvements: widget shared state, async operation progress, enricher timeout/fallback, dynamic field options, custom field components, conditional field visibility |
| 2026-02-25 | Add Phase M (Mutation Lifecycle) — mutation guard registry (evolve singleton to multi-guard), sync event subscribers via existing `subscribers/*.ts` with `sync: true` metadata (lifecycle events: `*.creating`/`*.updating`/`*.deleting`), client-side widget event filtering, guard on POST/create, normalize DELETE pipeline ordering. Update complete event flow pipeline, dependency graph, auto-discovery paths, scaffolding guides. |
| 2026-02-25 | Refactor Phase M — replace `data/crud-handlers.ts` file convention with sync event subscribers reusing existing subscriber auto-discovery. Remove `crud-handlers.generated.ts`, `CrudEventHandler` interface. Lifecycle before-events auto-derived from `events.ts` config. |
| 2026-02-26 | Fix save flow ordering in Phase G and parent to match CrudForm.tsx reality (widget onSave fires BEFORE core API call). Remove rollout/kill-switch section. Phase E: add error handling (fail-closed), timeout, query re-validation, dual-path coverage, container in context, priority collision handling. Phase F: add tableId convention, sorting constraint, Tier 3 pagination UX, bulk action error contract, ID deduplication, client-side filter strategy. Phase G: fix stray code fence, add custom field type to InjectedField, add group fallback, dirty tracking, optionsLoader empty-state, visibleWhen dot-path clarification, fix carrier example to upsert. Phase H: require propsSchema for replace mode, remove displayName targeting, add wrapper composition order, error boundary, HMR cleanup, SSR note, cross-module example, propsTransform and error boundary tests. |
| 2026-02-26 | Add Phase N (SPEC-041n) — query-engine extensibility with opt-in query enrichers, unified enricher registry shared by API and query engines, and synchronous query lifecycle events (`*.querying`/`*.queried`) for safe filter/query/result transformation across Basic and Hybrid engines. |
| 2026-02-27 | Refresh implementation progress snapshot: phases A-H marked done in parent spec and status moved to "In Progress (Phases A-H Implemented)". |
