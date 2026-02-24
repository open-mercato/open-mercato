# SPEC-041 — Universal Module Extension System (UMES)

| Field | Value |
|-------|-------|
| **Status** | Draft |
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

### Dependency Graph

```
A (Foundation) ──────┬────────────────────────────────────────────────┐
  │                  │                                                │
  ├── B (Menus)      ├── C (Events + DOM Bridge)                      │
  │                  │                                                │
  │                  │          D (Enrichers) ── independent ─────────┤
  │                  │            │                                   │
  │                  │            ├── E (Interceptors)                │
  │                  │            │                                   │
  │                  │            ├── F (DataTable Ext.)              │
  │                  │            │                                   │
  │                  │            ├── G (CrudForm Fields)             │
  │                  │            │     │                             │
  │                  │            │     └── I (Detail Bindings)       │
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
- **Wave 3** (after G): I — depends on G
- **Wave 4** (after all): K — integrates everything

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
│  │ • Field Inj. │  │ • Field      │  │ • Event Subscribers    ││
│  │ • Column Inj.│  │   Extension  │  │   (existing)           ││
│  │ • Action Inj.│  │   (existing) │  │ • Lifecycle Hooks      ││
│  │ • Widget Ext.│  │              │  │                        ││
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
| Validate/block a form save from UI | Widget `onBeforeSave` | Existing |
| React to a completed operation | Event Subscriber | Existing |
| Add data model relations | Entity Extension | Existing |
| Add user-configurable fields | Custom Fields/Entities | Existing |

### What Does NOT Change

| Existing System | Status |
|----------------|--------|
| Event subscribers (`subscribers/*.ts`) | **Unchanged** — remain the pattern for async side-effects |
| Entity extensions (`data/extensions.ts`) | **Unchanged** — remain the pattern for data model links |
| Custom fields/entities (`ce.ts`) | **Unchanged** — remain the pattern for user-defined attributes |
| Mutation guards (`mutation-guard.ts`) | **Integrated** — interceptors complement, not replace |
| Widget injection (current) | **Extended** — all existing APIs preserved, new capabilities added |

### Complete Event Flow

```
User clicks Save
  │
  ├─ 1. [UI] Client-side Zod validation (existing)
  ├─ 2. [UI] Widget onBeforeSave handlers (client-side validation)
  ├─ 3. [API] Server-side Zod validation (existing)
  ├─ 4. [API] API Interceptor before hooks (Phase E)
  ├─ 5. [API] CrudHooks.beforeCreate/Update (existing)
  ├─ 6. [API] Mutation Guard check (existing)
  ├─ 7. [Core] Entity mutation + ORM flush (existing)
  ├─ 8. [API] CrudHooks.afterCreate/Update (existing)
  ├─ 9. [API] Mutation Guard afterSuccess (existing)
  ├─ 10. [API] API Interceptor after hooks (Phase E)
  ├─ 11. [API] Response Enrichers (Phase D)
  ├─ 12. [UI] Widget onAfterSave handlers (Phase A)
  └─ 13. [Async] Event Subscribers (existing)
```

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
│   └── enrichers.ts       # NEW (Phase D): response enrichers
├── api/
│   ├── <routes>           # Existing
│   └── interceptors.ts    # NEW (Phase E): API interceptors
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

---

## Integration Test Summary

| Phase | Tests | Count |
|-------|-------|-------|
| A — Foundation | TC-UMES-F01–F02 | 2 |
| B — Menus | TC-UMES-M01–M04 | 4 |
| C — Events + DOM Bridge | TC-UMES-E01–E06 | 6 |
| D — Response Enrichers | TC-UMES-R01–R05 | 5 |
| E — API Interceptors | TC-UMES-I01–I06 | 6 |
| F — DataTable Extensions | TC-UMES-D01–D05 | 5 |
| G — CrudForm Fields | TC-UMES-CF01–CF05 | 5 |
| H — Component Replacement | TC-UMES-CR01–CR04 | 4 |
| I — Detail Bindings | TC-UMES-DP01–DP04 | 4 |
| J — Recursive Widgets | TC-UMES-RW01–RW02 | 2 |
| K — DevTools | TC-UMES-DT01–DT02 | 2 |
| **Total** | | **45** |

See each phase sub-spec for detailed test scenarios, example module additions, and testing notes.

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
| 5 | Interceptor blocks legitimate requests | High | Include `interceptorId` in errors; admin can disable per-tenant |
| 6 | Backward compatibility | Critical | All existing APIs preserved; new features additive |
| 7 | Complexity for simple modules | Medium | Progressive disclosure; CLI scaffolding |
| 8 | Enrichers expose cross-tenant data | Critical | `EnricherContext` scoped to tenant; code review checklist |

---

## Appendices

Technical appendices covering codebase analysis and competitive analysis are preserved in the phase sub-specs where relevant. Key insights:

- **Current runtime**: Widget injection uses `globalThis` keys for HMR, lazy loading via `entry.loader()`, wildcard matching via regex, priority sorting
- **Scoped headers**: `withScopedApiRequestHeaders` bridges client widgets to server API — standard pattern for all UMES extensions
- **CRUD factory hooks**: `CrudHooks` + mutation guards already exist; UMES interceptors compose with them, not replace
- **Bootstrap order**: New registries follow the same pattern as existing widget registration

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial draft — complete spec with all phases |
| 2026-02-24 | Split into phased sub-specs (SPEC-041a through SPEC-041k) for LLM context management |
