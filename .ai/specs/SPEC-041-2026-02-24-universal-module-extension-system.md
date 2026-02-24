# SPEC-041 — Universal Module Extension System (UMES)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-24 |
| **Issue** | [#675](https://github.com/open-mercato/open-mercato/issues/675) |
| **Related** | [PR #635 — Record Locking](https://github.com/open-mercato/open-mercato/pull/635), SPEC-035 (Mutation Guard), SPEC-036 (Request Lifecycle Events) |

## TLDR

Evolve the widget injection system into a **Universal Module Extension System (UMES)** — a coherent, DOM-inspired framework that lets modules extend any UI surface, intercept any mutation, transform any API response, and replace any component — all without touching core code. Unify the currently fragmented extension mechanisms (widget injection, event subscribers, entity extensions, mutation guards) under a single mental model with consistent APIs.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Design Principles](#2-design-principles)
3. [Architecture Overview](#3-architecture-overview)
4. [Phase 1 — UI Extension Slots](#4-phase-1--ui-extension-slots)
5. [Phase 2 — Component Replacement](#5-phase-2--component-replacement)
6. [Phase 3 — API Response Enrichment (Data Federation)](#6-phase-3--api-response-enrichment-data-federation)
7. [Phase 4 — API Middleware & Action Interceptors](#7-phase-4--api-middleware--action-interceptors)
8. [Phase 5 — DataTable & CrudForm Deep Extensibility](#8-phase-5--datatable--crudform-deep-extensibility)
9. [Phase 6 — Recursive Widget Extensibility](#9-phase-6--recursive-widget-extensibility)
10. [Coherence with Existing Systems](#10-coherence-with-existing-systems)
11. [Extension Manifest & Discovery](#11-extension-manifest--discovery)
12. [Developer Experience](#12-developer-experience)
13. [Data Models](#13-data-models)
14. [API Contracts](#14-api-contracts)
15. [Risks & Impact Review](#15-risks--impact-review)
16. [Integration Test Coverage](#16-integration-test-coverage)
17. [Final Compliance Report](#17-final-compliance-report)
18. [Appendix A — Insights from Code Analysis](#18-appendix-a--insights-from-code-analysis)
19. [Appendix B — Competitive Analysis Summary](#19-appendix-b--competitive-analysis-summary)
20. [Changelog](#20-changelog)

---

## 1. Problem Statement

### Current State

Open Mercato has **five separate extension mechanisms** that evolved independently:

| Mechanism | What it extends | Where defined |
|-----------|----------------|---------------|
| Widget Injection | UI surfaces (CrudForm, DataTable headers, detail tabs) | `widgets/injection-table.ts` + `widgets/injection/*/widget.ts` |
| Event Subscribers | Backend side-effects (create/update/delete reactions) | `subscribers/*.ts` |
| Entity Extensions | Data model (add fields/relations to other module's entities) | `data/extensions.ts` |
| Mutation Guards | Write operations (block/modify saves) | `@open-mercato/shared/lib/crud/mutation-guard.ts` |
| Custom Fields | User-defined entity attributes | `ce.ts` |

### Problems

1. **No component replacement** — A module cannot replace another module's dialog, form section, or table cell renderer. The `newSales` module cannot swap out the shipment dialog in old `orders` without forking.
2. **No API response enrichment** — Loading a customer requires touching the customers module code to add related data (e.g., credit score, loyalty points). There's no GraphQL-federation-like "extend the response from outside."
3. **No API action interception** — Modules cannot inject middleware into another module's API routes (e.g., validate a sales order against business rules before creation).
4. **Limited DataTable extensibility** — No way for external modules to add columns, row actions, or bulk actions to another module's data table.
5. **No CrudForm field injection** — Widgets can add UI sections to forms but cannot inject fields into existing groups or modify field behavior.
6. **Widgets can't extend widgets** — No recursive extensibility; the injection system is flat.
7. **Fragmented mental model** — Developers must learn five different patterns for five different kinds of extension.

### Goal

Create a unified extension framework where **any module can extend any other module's UI, data, and behavior** through a single, coherent API — comparable to how the browser DOM lets extensions interact with any page element.

---

## 2. Design Principles

Drawn from analysis of WordPress hooks, Shopify app extensions, VSCode contribution points, GraphQL Federation, and browser extension content scripts:

| # | Principle | Inspiration |
|---|-----------|-------------|
| 1 | **Actions vs Transformers** — Distinguish "do something" (side-effects) from "transform something" (data/UI modification) | WordPress actions vs filters |
| 2 | **Declarative Registration, Lazy Activation** — Declare capabilities in metadata; load code only when needed | VSCode contribution points + activation events |
| 3 | **Named, Typed Extension Points** — Every extension point has a string ID, typed contract, and documentation | Shopify extension targets |
| 4 | **Priority & Ordering** — When multiple modules target the same point, deterministic priority-based ordering | WordPress priority system |
| 5 | **Federation over Modification** — Extend data by composition (merge results) not mutation (modify source) | GraphQL Federation `@key` + `@extends` |
| 6 | **Removal & Override** — Extensions can be disabled, overridden, or replaced by configuration or other extensions | WordPress `remove_action`, VSCode extension disabling |
| 7 | **Recursive Extensibility** — Extensions can define their own extension points | WordPress custom hooks, VSCode contributed views |
| 8 | **Coherence over Duplication** — New patterns must integrate with existing subscribers, events, entity extensions — not duplicate them | Open Mercato architecture principle |
| 9 | **Progressive Disclosure** — Simple cases stay simple; advanced cases are possible | Existing widget injection simplicity |
| 10 | **Type Safety** — All extension contracts are fully typed via TypeScript generics and Zod schemas | Open Mercato convention |

---

## 3. Architecture Overview

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

All extension points use a **unified string ID format**:

```
<layer>:<module>.<entity>:<surface>:<position>
```

Examples:
- `ui:catalog.product:crud-form:fields` — inject fields into product form
- `ui:catalog.product:data-table:columns` — inject columns into product table
- `ui:sales.order:detail:shipment-dialog` — replace shipment dialog
- `data:customers.person:response:enrich` — enrich customer API response
- `api:sales.order:create:before` — intercept before order creation
- `api:sales.order:create:after` — intercept after order creation

**Backward compatibility**: Existing spot IDs (`crud-form:catalog.product`, `backend:record:current`, etc.) remain fully supported. The new taxonomy is additive.

---

## 4. Phase 1 — UI Extension Slots

**Goal**: Formalize and expand the injection spot system.

### 4.1 Standardized Slot Categories

Every backend page automatically gets slots at predictable positions:

```typescript
// Auto-generated for every CrudForm entity
'crud-form:<entityId>:before-fields'      // Before all field groups
'crud-form:<entityId>:after-fields'       // After all field groups
'crud-form:<entityId>:header'             // Form header area
'crud-form:<entityId>:footer'             // Form footer/actions area
'crud-form:<entityId>:sidebar'            // Right sidebar (column 2)
'crud-form:<entityId>:group:<groupId>'    // Inside a specific group
'crud-form:<entityId>:field:<fieldId>:before'  // Before a specific field
'crud-form:<entityId>:field:<fieldId>:after'   // After a specific field

// Auto-generated for every DataTable
'data-table:<tableId>:header'             // Above the table
'data-table:<tableId>:footer'             // Below the table
'data-table:<tableId>:toolbar'            // Toolbar area (filters, search)
'data-table:<tableId>:empty-state'        // Custom empty state

// Auto-generated for every detail page
'detail:<entityId>:header'                // Detail page header
'detail:<entityId>:tabs'                  // Tab injection
'detail:<entityId>:sidebar'               // Detail sidebar
'detail:<entityId>:footer'                // Detail footer

// Global slots (already exist, formalized)
'backend:record:current'                  // Current record context
'backend:layout:top'                      // Page header
'backend:layout:footer'                   // Page footer
'backend:sidebar:top'                     // Sidebar top
'backend:sidebar:footer'                  // Sidebar footer
```

### 4.2 Wildcard & Pattern Matching (Existing — Formalized)

```typescript
'crud-form:*'                    // All CRUD forms (record-locking uses this)
'crud-form:catalog.*'            // All catalog module forms
'data-table:*'                   // All data tables
'detail:*:tabs'                  // All detail page tab sections
```

### 4.3 Event Handler Expansion

Extend the existing `WidgetInjectionEventHandlers` with DOM-inspired lifecycle:

```typescript
interface WidgetInjectionEventHandlers<TContext, TData> {
  // === Existing (unchanged) ===
  onLoad?(context: TContext): Promise<void>
  onBeforeSave?(data: TData, context: TContext): Promise<WidgetBeforeSaveResult>
  onSave?(data: TData, context: TContext): Promise<void>
  onAfterSave?(data: TData, context: TContext): Promise<void>
  onBeforeDelete?(data: TData, context: TContext): Promise<WidgetBeforeDeleteResult>
  onDelete?(data: TData, context: TContext): Promise<void>
  onAfterDelete?(data: TData, context: TContext): Promise<void>
  onDeleteError?(data: TData, context: TContext, error: unknown): Promise<void>

  // === New: DOM-Inspired Lifecycle ===
  onFieldChange?(fieldId: string, value: unknown, data: TData, context: TContext): Promise<FieldChangeResult | void>
  onBeforeNavigate?(target: string, context: TContext): Promise<NavigateGuardResult>
  onVisibilityChange?(visible: boolean, context: TContext): Promise<void>

  // === New: Data Transformation (Filter-style) ===
  transformFormData?(data: TData, context: TContext): Promise<TData>
  transformDisplayData?(data: TData, context: TContext): Promise<TData>
  transformValidation?(errors: FieldErrors, data: TData, context: TContext): Promise<FieldErrors>
}

interface FieldChangeResult {
  /** Override the field value */
  value?: unknown
  /** Set values of other fields reactively */
  sideEffects?: Record<string, unknown>
  /** Show a warning/info message for this field */
  message?: { text: string; severity: 'info' | 'warning' | 'error' }
}

interface NavigateGuardResult {
  ok: boolean
  message?: string
  /** If false, navigation is blocked (e.g., unsaved changes) */
}
```

### 4.4 Implementation

The `InjectionSpot` component and `useInjectionWidgets` hook remain the core runtime. Changes:

1. **CrudForm** emits `onFieldChange` events through the injection context when any field value changes
2. **Detail pages** emit `onVisibilityChange` when tabs switch
3. **Transformer events** (`transformFormData`, `transformDisplayData`) are applied as a pipeline — each widget receives the output of the previous widget (WordPress filter pattern)

### 4.5 Backward Compatibility: Dual-Mode Event Dispatch

The existing `triggerEvent` function in `InjectionSpot.tsx` dispatches **action events** (fire handler, accumulate `requestHeaders`, check `ok` boolean). Transformer events require a fundamentally different dispatch mode: **pipeline** (output of widget N becomes input of widget N+1).

To preserve backward compatibility, `triggerEvent` gains a second dispatch path:

```typescript
// Existing behavior — unchanged for action events
if (isActionEvent(event)) {
  // Current logic: iterate widgets, accumulate requestHeaders, check ok
  // onBeforeSave, onSave, onAfterSave, onBeforeDelete, etc.
}

// New behavior — pipeline for transformer events
if (isTransformerEvent(event)) {
  // Pipeline: data flows through widgets in priority order
  let result = initialData
  for (const widget of sortedWidgets) {
    result = await widget.eventHandlers[event](result, context)
  }
  return result
}
```

**Action events** (existing): `onLoad`, `onBeforeSave`, `onSave`, `onAfterSave`, `onBeforeDelete`, `onDelete`, `onAfterDelete`, `onDeleteError`, `onFieldChange`, `onBeforeNavigate`, `onVisibilityChange`

**Transformer events** (new): `transformFormData`, `transformDisplayData`, `transformValidation`

The `onEvent` callback prop union on `InjectionSpotProps` is updated to include new event names. The delete-to-save fallback chain (`onBeforeDelete` → `onBeforeSave` if not defined) is explicitly preserved.

---

## 5. Phase 2 — Component Replacement

**Goal**: Allow modules to replace any registered component without forking.

### 5.1 Component Registry

Introduce a **component registry** where core modules register replaceable components:

```typescript
// packages/shared/src/modules/widgets/component-registry.ts

type ComponentRegistryEntry<TProps = any> = {
  id: string                          // e.g., 'sales.order.shipment-dialog'
  component: React.ComponentType<TProps>
  metadata: {
    module: string
    description: string
    propsSchema?: z.ZodType<TProps>   // Typed contract
  }
}

// Registration (in module's index or component file)
registerComponent({
  id: 'sales.order.shipment-dialog',
  component: ShipmentDialog,
  metadata: {
    module: 'sales',
    description: 'Dialog for creating/editing shipments on orders',
    propsSchema: shipmentDialogPropsSchema,
  },
})

// Replacement (in another module's extensions)
replaceComponent({
  targetId: 'sales.order.shipment-dialog',
  component: NewShipmentDialog,
  metadata: {
    module: 'new_sales',
    priority: 100,
    description: 'Enhanced shipment dialog with carrier integration',
  },
})
```

### 5.2 Resolution Hook

```typescript
// packages/ui/src/backend/injection/useRegisteredComponent.ts

function useRegisteredComponent<TProps>(
  componentId: string
): React.ComponentType<TProps> {
  // 1. Check if any replacement is registered (highest priority wins)
  // 2. Fall back to original component
  // 3. Log warning if multiple replacements exist at same priority
}
```

### 5.3 Usage in Core Modules

Core modules wrap replaceable components:

```typescript
// Before (tightly coupled)
import { ShipmentDialog } from './components/ShipmentDialog'

// After (extensible)
const ShipmentDialog = useRegisteredComponent<ShipmentDialogProps>(
  'sales.order.shipment-dialog'
)

return <ShipmentDialog orderId={orderId} onClose={handleClose} />
```

### 5.4 Any-Component Injection via React Tree

For cases where no explicit registration point exists, provide a **tree-level injection** mechanism inspired by browser content scripts:

```typescript
// packages/ui/src/backend/injection/ComponentOverrideProvider.tsx

// Module declares overrides in extensions.ts
export const componentOverrides: ComponentOverride[] = [
  {
    // Target by component display name or data-testid
    target: { displayName: 'ShipmentDialog' },
    replacement: lazy(() => import('./NewShipmentDialog')),
    priority: 100,
    features: ['new_sales.view'],  // ACL gate
  },
  {
    // Target by a data-component-id attribute
    target: { componentId: 'sales.order.shipment-dialog' },
    wrapper: (OriginalComponent) => (props) => (
      <EnhancedWrapper>
        <OriginalComponent {...props} extraProp="value" />
      </EnhancedWrapper>
    ),
    priority: 50,
  },
]
```

The `ComponentOverrideProvider` at the app root intercepts component resolution:

```typescript
// Provider wraps the app shell
<ComponentOverrideProvider overrides={allModuleOverrides}>
  <AppShell>
    {children}
  </AppShell>
</ComponentOverrideProvider>
```

**How it works:**

1. Core components that are replacement-eligible add a `data-component-id` attribute or are wrapped in a `<Replaceable>` HOC
2. The provider builds a lookup table from all module overrides
3. `useRegisteredComponent(id)` checks the override table first
4. For `wrapper` mode, the original component is passed as an argument — the module wraps it (preserving core behavior while adding functionality)

### 5.5 Wrapper vs Replace Strategy

| Mode | Use Case | Risk |
|------|----------|------|
| **Replace** | Complete swap of a component (new UI, new behavior) | High — must maintain props contract |
| **Wrapper** | Add behavior around existing component (decorating, monitoring) | Low — original component preserved |
| **Props Override** | Modify props passed to existing component | Low — original component preserved |

```typescript
type ComponentOverride = {
  target: { componentId?: string; displayName?: string }
  priority: number
  features?: string[]
} & (
  | { replacement: React.LazyExoticComponent<any> }
  | { wrapper: (Original: React.ComponentType) => React.ComponentType }
  | { propsTransform: (props: any) => any }
)
```

---

## 6. Phase 3 — API Response Enrichment (Data Federation)

**Goal**: Allow modules to enrich other modules' API responses without touching core code — similar to GraphQL Federation's `@extends`.

### 6.1 Response Enricher Contract

```typescript
// packages/shared/src/lib/crud/response-enricher.ts

interface ResponseEnricher<TRecord = any, TEnriched = any> {
  /** Unique ID */
  id: string
  /** Which entity responses to enrich */
  targetEntity: string  // e.g., 'customers.person'
  /** ACL features required */
  features?: string[]
  /** Priority (higher = runs first) */
  priority?: number
  /**
   * Enrich a single record. Called after the core query resolves.
   * Must return the record with additional fields merged.
   * MUST NOT modify or remove existing fields.
   */
  enrichOne(
    record: TRecord,
    context: EnricherContext
  ): Promise<TRecord & TEnriched>
  /**
   * Batch enrichment for list endpoints (performance optimization).
   * Receives all records; should batch-fetch related data.
   */
  enrichMany?(
    records: TRecord[],
    context: EnricherContext
  ): Promise<(TRecord & TEnriched)[]>
}

interface EnricherContext {
  organizationId: string
  tenantId: string
  userId: string
  em: EntityManager  // Read-only access
  /** Fields explicitly requested by the client (if using field selection) */
  requestedFields?: string[]
}
```

### 6.2 Registration

```typescript
// In module's data/enrichers.ts (new auto-discovered file)
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

export const enrichers: ResponseEnricher[] = [
  {
    id: 'loyalty.customer-points',
    targetEntity: 'customers.person',
    features: ['loyalty.view'],
    priority: 50,
    async enrichOne(record, ctx) {
      const points = await ctx.em.findOne(LoyaltyPoints, {
        customerId: record.id,
        organizationId: ctx.organizationId,
      })
      return {
        ...record,
        loyaltyPoints: points?.balance ?? 0,
        loyaltyTier: points?.tier ?? 'none',
      }
    },
    async enrichMany(records, ctx) {
      const customerIds = records.map(r => r.id)
      const allPoints = await ctx.em.find(LoyaltyPoints, {
        customerId: { $in: customerIds },
        organizationId: ctx.organizationId,
      })
      const pointsMap = new Map(allPoints.map(p => [p.customerId, p]))
      return records.map(record => ({
        ...record,
        loyaltyPoints: pointsMap.get(record.id)?.balance ?? 0,
        loyaltyTier: pointsMap.get(record.id)?.tier ?? 'none',
      }))
    },
  },
]
```

### 6.3 Integration with makeCrudRoute

The CRUD factory applies enrichers **after** the existing `afterList` hook, preserving all current hook contracts:

```typescript
// In makeCrudRoute GET handler — exact ordering
async function handleGet(req, ctx) {
  // 1. Core query (existing — unchanged)
  const records = await queryEngine.find(...)

  // 2. CrudHooks.afterList (existing — unchanged, receives raw query results)
  if (hooks.afterList) await hooks.afterList(records, ctx)

  // 3. Apply enrichers (NEW — runs AFTER afterList)
  const enrichers = getEnrichersForEntity(entityId)
  const enrichedRecords = await applyEnrichers(records, enrichers, ctx)

  // 4. Return enriched response
  return enrichedRecords
}
```

**Ordering guarantee**: Enrichers run after `CrudHooks.afterList` completes. This means existing `afterList` hooks see the same raw data they see today — no behavioral change. Enriched fields are only present in the final HTTP response.

**Export handling**: The `_meta` field added by enrichers is stripped by `normalizeFullRecordForExport` before CSV/JSON export processing.

### 6.4 Client-Side Awareness

Enriched fields are transparently available in the API response. No client-side changes needed for consumption. For DataTable columns or CrudForm fields that display enriched data, modules use the standard widget injection to add columns/fields.

### 6.5 Guardrails

- Enrichers MUST NOT modify or remove existing fields (additive only)
- Enrichers MUST NOT perform writes (read-only EntityManager)
- Enrichers run after core query, not inside the transaction
- `enrichMany` MUST be implemented for list endpoints (N+1 prevention)
- Enrichers can be disabled per-tenant via module config
- Total enricher execution time is logged; slow enrichers are flagged in dev mode

---

## 7. Phase 4 — API Middleware & Action Interceptors

**Goal**: Allow modules to hook into other modules' API routes — validate, transform, or augment requests and responses.

### 7.1 API Interceptor Contract

```typescript
// packages/shared/src/lib/crud/api-interceptor.ts

interface ApiInterceptor {
  /** Unique ID */
  id: string
  /** Target route pattern (supports wildcards) */
  targetRoute: string  // e.g., 'sales/orders', 'sales/*', '*'
  /** HTTP methods to intercept */
  methods: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]
  /** Priority (higher = runs first) */
  priority?: number
  /** ACL features required */
  features?: string[]

  /**
   * Called before the route handler executes.
   * Can modify request body, add headers, or reject the request.
   */
  before?(request: InterceptorRequest, context: InterceptorContext): Promise<InterceptorBeforeResult>

  /**
   * Called after the route handler executes.
   * Can modify the response body (additive only).
   */
  after?(request: InterceptorRequest, response: InterceptorResponse, context: InterceptorContext): Promise<InterceptorAfterResult>
}

interface InterceptorBeforeResult {
  /** Continue processing (true) or reject (false) */
  ok: boolean
  /** Modified request body (if needed) */
  body?: Record<string, unknown>
  /** Additional headers to inject */
  headers?: Record<string, string>
  /** Rejection message */
  message?: string
  /** HTTP status code for rejection */
  statusCode?: number
}

interface InterceptorAfterResult {
  /** Additional fields to merge into the response */
  merge?: Record<string, unknown>
}
```

### 7.2 Registration

```typescript
// In module's api/interceptors.ts (new auto-discovered file)
export const interceptors: ApiInterceptor[] = [
  {
    id: 'business_rules.validate-order',
    targetRoute: 'sales/orders',
    methods: ['POST', 'PUT'],
    features: ['business_rules.manage'],
    priority: 100,
    async before(request, ctx) {
      const violations = await validateBusinessRules(request.body, ctx)
      if (violations.length > 0) {
        return {
          ok: false,
          message: `Business rule violations: ${violations.map(v => v.message).join(', ')}`,
          statusCode: 422,
        }
      }
      return { ok: true }
    },
  },
]
```

### 7.3 Exact Execution Order Within CRUD Factory

Interceptors integrate into the existing CRUD mutation pipeline at precise points:

```
1. Zod schema validation (existing — unchanged)
2. API Interceptor `before` hooks  ← NEW (can reject; can add headers)
3. CrudHooks.beforeCreate/Update/Delete (existing — unchanged)
4. validateCrudMutationGuard (existing — unchanged)
5. Entity mutation + ORM flush (existing — unchanged)
6. CrudHooks.afterCreate/Update/Delete (existing — unchanged)
7. runCrudMutationGuardAfterSuccess (existing — unchanged)
8. API Interceptor `after` hooks  ← NEW (can merge data into response)
9. Response Enrichers (Phase 3)
10. Return HTTP response
```

**Key constraint**: Interceptor `before` hooks run AFTER Zod validation. They receive already-validated input. If an interceptor needs to modify the request body, it returns a `body` field in the result — this modified body is **re-validated through the route's Zod schema** before being passed to `CrudHooks.before*`. This prevents interceptors from bypassing input validation.

```typescript
// Inside CRUD factory — interceptor integration (pseudocode)
const parsedInput = schema.parse(rawBody)        // Step 1: existing Zod validation
const interceptResult = await runInterceptorsBefore(parsedInput, ctx)  // Step 2
if (!interceptResult.ok) return errorResponse(interceptResult)

// If interceptor modified the body, re-validate
const finalInput = interceptResult.body
  ? schema.parse(interceptResult.body)            // Re-validate modified body
  : parsedInput

if (hooks.beforeCreate) await hooks.beforeCreate(finalInput, ctx)     // Step 3
```

### 7.4 Relationship to Existing Patterns

| Concern | Use This | NOT This |
|---------|----------|----------|
| Block/validate a mutation from **UI** | Widget `onBeforeSave` handler | API interceptor |
| Block/validate a mutation from **API** (including external callers) | API interceptor `before` | Widget handler |
| Add data to API response | Response enricher | API interceptor `after` |
| React to completed mutation (send email, index, etc.) | Event subscriber | API interceptor `after` |
| Transform request before processing | API interceptor `before` | Event subscriber |

This maintains clear separation: **widgets** own UI-level behavior, **interceptors** own API-level behavior, **subscribers** own async side-effects.

---

## 8. Phase 5 — DataTable & CrudForm Deep Extensibility

### 8.1 DataTable Column Injection

Allow modules to inject columns into other modules' data tables:

```typescript
// In module's widgets/injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  'data-table:customers.people:columns': {
    widgetId: 'loyalty.injection.customer-points-column',
    priority: 50,
  },
}

// In widget.ts
export default {
  metadata: {
    id: 'loyalty.injection.customer-points-column',
    title: 'Loyalty Points',
    features: ['loyalty.view'],
  },
  // New: column injection uses a declarative column definition
  columns: [
    {
      id: 'loyaltyPoints',
      header: 'loyalty.column.points',  // i18n key
      accessorKey: 'loyaltyPoints',     // From response enricher
      cell: ({ getValue }) => <Badge>{getValue()}</Badge>,
      size: 100,
      sortable: true,
      position: 'after:email',          // Insert after email column
    },
  ],
} satisfies InjectionColumnWidget
```

### 8.2 DataTable Row Action Injection

```typescript
// New injection type for row actions
export default {
  metadata: {
    id: 'loyalty.injection.customer-actions',
    features: ['loyalty.manage'],
  },
  rowActions: [
    {
      id: 'adjust-points',
      label: 'loyalty.action.adjust-points',
      icon: 'star',
      onSelect: (row, context) => {
        context.openDialog('loyalty.adjust-points', { customerId: row.id })
      },
      position: 'after:edit',
    },
  ],
} satisfies InjectionRowActionWidget
```

### 8.3 DataTable Bulk Action Injection

```typescript
export default {
  metadata: {
    id: 'loyalty.injection.bulk-actions',
    features: ['loyalty.manage'],
  },
  bulkActions: [
    {
      id: 'bulk-adjust-points',
      label: 'loyalty.action.bulk-adjust',
      icon: 'stars',
      onExecute: async (selectedRows, context) => {
        return context.openDialog('loyalty.bulk-adjust', {
          customerIds: selectedRows.map(r => r.id),
        })
      },
    },
  ],
} satisfies InjectionBulkActionWidget
```

### 8.4 DataTable Filter Injection

```typescript
export default {
  metadata: {
    id: 'loyalty.injection.customer-filters',
    features: ['loyalty.view'],
  },
  filters: [
    {
      id: 'loyaltyTier',
      label: 'loyalty.filter.tier',
      type: 'select',
      options: [
        { value: 'bronze', label: 'Bronze' },
        { value: 'silver', label: 'Silver' },
        { value: 'gold', label: 'Gold' },
      ],
      // Maps to query parameter sent to API
      queryParam: 'loyaltyTier',
    },
  ],
} satisfies InjectionFilterWidget
```

### 8.5 CrudForm Field Injection

Allow modules to inject fields into existing form groups:

```typescript
export default {
  metadata: {
    id: 'loyalty.injection.customer-fields',
    features: ['loyalty.manage'],
  },
  fields: [
    {
      id: 'loyaltyTier',
      label: 'loyalty.field.tier',
      type: 'select',
      options: [
        { value: 'bronze', label: 'Bronze' },
        { value: 'silver', label: 'Silver' },
        { value: 'gold', label: 'Gold' },
      ],
      // Target group and position
      group: 'details',
      position: 'after:status',
      // Value is sourced from enriched API response
      // Saved via the onSave handler (not the core entity)
      readOnly: false,
    },
  ],
  eventHandlers: {
    onSave: async (data, context) => {
      // Save loyalty tier via loyalty module's own API
      await fetch(`/api/loyalty/customers/${context.recordId}/tier`, {
        method: 'PUT',
        body: JSON.stringify({ tier: data.loyaltyTier }),
      })
    },
  },
} satisfies InjectionFieldWidget
```

### 8.6 CrudForm Group Injection (Existing — Formalized)

Already works via current injection table with `kind: 'group'` and `column` placement. Formalized with explicit type:

```typescript
satisfies InjectionGroupWidget  // Existing pattern, now typed
```

### 8.7 Headless Widget Type — No `Widget` Component Required

Existing widgets MUST export a `Widget` React component (`InjectionSpot.tsx` destructures `{ Widget }` and renders it). New declarative widget types (columns, row actions, bulk actions, filters, fields) are **headless** — they provide data/configuration but no visual component.

To maintain backward compatibility with the `InjectionSpot` rendering path, headless widgets use a separate loading path:

```typescript
// Two loading functions (not one)
loadInjectionWidgetById(id)         // Existing: expects Widget component, renders via InjectionSpot
loadInjectionDataWidgetById(id)     // NEW: loads metadata + declarative config, no Widget expected
```

**Widget type detection** uses the injection table entry. Existing spot IDs (`crud-form:*`, `backend:record:current`) use the existing loader. New spot IDs for declarative extensions (`data-table:*:columns`, `data-table:*:row-actions`, `data-table:*:bulk-actions`, `data-table:*:filters`, `crud-form:*:fields`) use the new headless loader.

If a headless widget also needs to render UI (e.g., a custom cell renderer for an injected column), it exports `Widget` optionally — the column definition's `cell` function handles rendering inline.

### 8.8 Implementation: DataTable Integration

```typescript
// In DataTable.tsx — new hook (uses headless loader)
function useInjectedTableExtensions(tableId: string) {
  const { widgets } = useInjectionDataWidgets(`data-table:${tableId}:columns`)
  const { widgets: actionWidgets } = useInjectionDataWidgets(`data-table:${tableId}:row-actions`)
  const { widgets: bulkWidgets } = useInjectionDataWidgets(`data-table:${tableId}:bulk-actions`)
  const { widgets: filterWidgets } = useInjectionDataWidgets(`data-table:${tableId}:filters`)

  return {
    injectedColumns: widgets.flatMap(w => w.module.columns ?? []),
    injectedRowActions: actionWidgets.flatMap(w => w.module.rowActions ?? []),
    injectedBulkActions: bulkWidgets.flatMap(w => w.module.bulkActions ?? []),
    injectedFilters: filterWidgets.flatMap(w => w.module.filters ?? []),
  }
}
```

DataTable merges injected extensions with its own columns, actions, and filters — respecting `position` hints for ordering.

---

## 9. Phase 6 — Recursive Widget Extensibility

**Goal**: Allow widgets themselves to be extended by other widgets.

### 9.1 Widget-Level Extension Points

Any widget can declare its own injection spots:

```typescript
// In a widget's client component
function RecordLockingWidget({ context, data }: WidgetProps) {
  return (
    <div>
      <LockStatusBanner />
      {/* Other widgets can inject into this widget */}
      <InjectionSpot
        spotId={`widget:record_locks.crud-form-locking:actions`}
        context={context}
        data={data}
      />
      <ConflictResolutionDialog />
    </div>
  )
}
```

### 9.2 Widget Behavior Extension

Modules can extend a widget's event handlers:

```typescript
// In injection-table.ts
export const injectionTable: ModuleInjectionTable = {
  // Extend record-locking's onBeforeSave with additional check
  'widget:record_locks.crud-form-locking:events': {
    widgetId: 'audit.injection.lock-audit-trail',
    priority: 50,
  },
}
```

This enables **layered composition** — audit module adds logging to record-locking's save guard without record-locking knowing about audit.

---

## 10. Coherence with Existing Systems

### 10.1 Mapping: When to Use What

| I want to... | Use | Why |
|--------------|-----|-----|
| Add UI to another module's page | **Widget Injection** (Phase 1 slots) | UI composition |
| Replace a component entirely | **Component Replacement** (Phase 2) | Component swap |
| Add data to another module's API response | **Response Enricher** (Phase 3) | Data federation |
| Validate/block an API mutation | **API Interceptor** (Phase 4) | Server-side guard |
| Validate/block a form save from UI | **Widget `onBeforeSave`** (Phase 1) | Client-side guard |
| Add columns to a data table | **Column Injection** (Phase 5) | Table extension |
| Add fields to a form | **Field Injection** (Phase 5) | Form extension |
| React to a completed operation | **Event Subscriber** (existing) | Async side-effect |
| Add data model relations | **Entity Extension** (existing) | Data model |
| Add user-configurable fields | **Custom Fields/Entities** (existing) | User-defined |

### 10.2 What Does NOT Change

| Existing System | Status |
|----------------|--------|
| Event subscribers (`subscribers/*.ts`) | **Unchanged** — remain the pattern for async side-effects |
| Entity extensions (`data/extensions.ts`) | **Unchanged** — remain the pattern for data model links |
| Custom fields/entities (`ce.ts`) | **Unchanged** — remain the pattern for user-defined attributes |
| Mutation guards (`mutation-guard.ts`) | **Integrated** — API interceptors complement (not replace) mutation guards; guards are DI-resolved server-side validation, interceptors are module-declared route hooks |
| Widget injection (current) | **Extended** — all existing APIs remain, new capabilities added |

### 10.3 Event Flow: Complete Picture

```
User clicks Save
  │
  ├─ 1. [UI] Client-side Zod validation (existing)
  │
  ├─ 2. [UI] Widget onBeforeSave handlers (client-side validation, lock checks)
  │      └─ Can block save, return fieldErrors, inject requestHeaders
  │
  ├─ 3. [API] Server-side Zod validation (existing)
  │
  ├─ 4. [API] API Interceptor before hooks (server-side validation, business rules)
  │      └─ Can reject request; if body modified → re-validated by Zod
  │
  ├─ 5. [API] CrudHooks.beforeCreate/Update (existing — receives validated input)
  │
  ├─ 6. [API] Mutation Guard check (DI-resolved, e.g., record-lock token validation)
  │      └─ Can reject mutation
  │
  ├─ 7. [Core] Entity mutation + ORM flush (existing)
  │
  ├─ 8. [API] CrudHooks.afterCreate/Update (existing)
  │
  ├─ 9. [API] Mutation Guard afterSuccess (existing)
  │
  ├─ 10. [API] API Interceptor after hooks (augment response)
  │
  ├─ 11. [API] Response Enrichers (add data from other modules)
  │
  ├─ 12. [UI] Widget onAfterSave handlers (clear state, refresh)
  │
  └─ 13. [Async] Event Subscribers (send email, reindex, update cache)
```

Each numbered step preserves the exact contract of existing hooks — new steps (4, 10, 11) are inserted at defined boundaries without changing what existing hooks receive.

---

## 11. Extension Manifest & Discovery

### 11.1 Unified Module Extension File

Each module declares all its extensions in a single manifest alongside existing files:

```
src/modules/<module>/
├── index.ts               # Existing: module metadata
├── acl.ts                 # Existing: permissions
├── events.ts              # Existing: event declarations
├── setup.ts               # Existing: tenant init
├── data/
│   ├── entities.ts        # Existing
│   ├── extensions.ts      # Existing: entity extensions
│   └── enrichers.ts       # NEW: response enrichers
├── api/
│   ├── <routes>           # Existing
│   └── interceptors.ts    # NEW: API interceptors
├── widgets/
│   ├── injection-table.ts # Existing: slot mappings
│   ├── injection/         # Existing: widget implementations
│   └── components.ts      # NEW: component replacements/overrides
└── subscribers/           # Existing: event subscribers
```

### 11.2 Auto-Discovery

The CLI generator (`yarn generate`) discovers:
- `data/enrichers.ts` → generates enricher registry
- `api/interceptors.ts` → generates interceptor registry
- `widgets/components.ts` → generates component override registry

All registries are generated into `apps/mercato/.mercato/generated/` and loaded at bootstrap — same pattern as current injection widget discovery.

### 11.3 Feature-Gated Activation

All extension types support `features?: string[]` for ACL-based activation. Extensions are only loaded when the current user has the required features. This reuses the existing RBAC system.

---

## 12. Developer Experience

### 12.1 CLI Scaffolding

```bash
# Scaffold a new widget injection
yarn generate widget --module loyalty --target crud-form:customers.person --kind group

# Scaffold a response enricher
yarn generate enricher --module loyalty --target customers.person

# Scaffold an API interceptor
yarn generate interceptor --module business_rules --target sales/orders --methods POST,PUT

# Scaffold a component replacement
yarn generate component-override --module new_sales --target sales.order.shipment-dialog
```

### 12.2 DevTools Integration

In development mode, a **UMES DevTools panel** shows:

- All active extension points on the current page
- Which modules have registered for each point
- Priority ordering and conflict detection
- Real-time event flow (onBeforeSave fired → widget X responded → blocked/allowed)
- Response enricher timing (which enrichers are slow)
- Component replacements in effect

### 12.3 Extension Conflict Detection

At build time (`yarn generate`), detect:
- Two modules replacing the same component at the same priority (error)
- Enricher adding fields that conflict with core fields (warning)
- Circular widget dependencies (error)
- Missing feature declarations for gated extensions (warning)

---

## 13. Data Models

### 13.1 No New Database Entities for Phase 1-2

Phases 1-2 (UI slots, component replacement) are purely runtime — no database changes. All configuration is in code (injection tables, component registries).

### 13.2 Phase 3 — Enricher Cache (Optional)

For performance-critical enrichers, an optional cache layer:

```typescript
// Uses existing @open-mercato/cache infrastructure
{
  id: 'loyalty.customer-points',
  cache: {
    strategy: 'read-through',
    ttl: 60,  // seconds
    tags: ['loyalty', 'customers'],
    invalidateOn: ['loyalty.points.updated', 'loyalty.tier.changed'],
  },
}
```

### 13.3 Phase 4 — Interceptor Audit Log (Optional)

Interceptor rejections can be logged for audit:

```sql
-- Uses existing action_log infrastructure; no new table needed
-- Interceptor rejections are logged as action_log entries with:
--   action_type: 'api_interceptor_reject'
--   metadata: { interceptorId, route, method, message }
```

---

## 14. API Contracts

### 14.1 No New HTTP Endpoints

UMES is a framework-level feature — no new API routes. Extensions are applied transparently within existing routes.

### 14.2 Extension Header Protocol

Widgets and interceptors can communicate via scoped headers (existing pattern from record-locking):

```
x-om-ext-<module>-<key>: <value>
```

Example:
```
x-om-ext-record-locks-token: abc123
x-om-ext-business-rules-override: skip-credit-check
```

### 14.3 Response Metadata

When enrichers are active, responses include metadata:

```json
{
  "data": { /* enriched record */ },
  "_meta": {
    "enrichedBy": ["loyalty.customer-points", "credit.score"]
  }
}
```

---

## 15. Risks & Impact Review

| # | Risk | Severity | Area | Mitigation | Residual Risk |
|---|------|----------|------|------------|---------------|
| 1 | **Performance degradation from enrichers** — N+1 queries or slow enrichers on list endpoints | High | Data Layer | Require `enrichMany` for list endpoints; add timing budget (100ms warning, 500ms error in dev); leverage cache | Medium — cache misses on first load |
| 2 | **Component replacement breaks props contract** — Replacement component doesn't match original's props interface | High | UI Layer | Enforce `propsSchema` via Zod at registration; runtime props validation in dev mode; test coverage requirement for replacements | Low — caught at dev/build time |
| 3 | **Circular dependencies between extensions** — Module A enriches B's response, B enriches A's | Medium | Architecture | Dependency graph analysis at `yarn generate`; circular references are a build error | Low |
| 4 | **Priority conflicts** — Two modules register at same priority for same extension point | Medium | All Layers | Build-time detection; require explicit priority; document that identical priorities resolve by module load order (alphabetical) | Low |
| 5 | **API interceptor blocks legitimate requests** — Misconfigured interceptor rejects valid mutations | High | API Layer | Interceptor rejections include `interceptorId` in error response; admin can disable interceptors per-tenant; all rejections are logged | Medium — requires admin intervention |
| 6 | **Backward compatibility** — Existing injection-table.ts and widget.ts files must continue working | Critical | All | All existing APIs are preserved; new features are additive; migration guide for opt-in adoption | Low |
| 7 | **Complexity overhead for simple modules** — System becomes too complex for basic CRUD modules | Medium | DX | Progressive disclosure: simple modules use only what they need; no mandatory boilerplate; CLI scaffolding for common patterns | Low |
| 8 | **Security: enrichers expose cross-tenant data** — Enricher query doesn't filter by organizationId | Critical | Security | `EnricherContext` always includes `organizationId`; enricher EntityManager is scoped to current tenant; code review checklist item | Low — architectural guard |

---

## 16. Integration Test Coverage

### Phase 1 — UI Extension Slots
| Test ID | Scenario | Path |
|---------|----------|------|
| TC-UMES-001 | Widget injected into `crud-form:*` wildcard renders on all CRUD forms | Widget injection |
| TC-UMES-002 | `onFieldChange` handler receives field updates and can set side-effects | CrudForm field change |
| TC-UMES-003 | `transformFormData` pipeline applies multiple widget transformations in priority order | CrudForm save |
| TC-UMES-004 | `onBeforeNavigate` guard blocks navigation when returning `ok: false` | Detail page navigation |

### Phase 2 — Component Replacement
| Test ID | Scenario | Path |
|---------|----------|------|
| TC-UMES-005 | `replaceComponent` swaps original component with replacement | Component registry |
| TC-UMES-006 | `wrapper` mode wraps original component preserving its behavior | Component registry |
| TC-UMES-007 | Component replacement is ACL-gated (disabled without required feature) | RBAC |
| TC-UMES-008 | Highest priority replacement wins when multiple modules replace same component | Priority resolution |

### Phase 3 — Response Enrichment
| Test ID | Scenario | Path |
|---------|----------|------|
| TC-UMES-009 | Response enricher adds fields to GET single entity response | `/api/customers/people/:id` |
| TC-UMES-010 | `enrichMany` is called for list endpoints with batched IDs | `/api/customers/people` |
| TC-UMES-011 | Enricher respects ACL features (disabled without permission) | RBAC |
| TC-UMES-012 | Enricher cannot modify existing core fields (additive only) | Data integrity |
| TC-UMES-013 | Slow enricher is logged with timing warning | Dev mode |

### Phase 4 — API Interceptors
| Test ID | Scenario | Path |
|---------|----------|------|
| TC-UMES-014 | API interceptor `before` rejects invalid mutation with 422 | `/api/sales/orders` POST |
| TC-UMES-015 | API interceptor `before` allows valid mutation to proceed | `/api/sales/orders` POST |
| TC-UMES-016 | API interceptor `after` merges additional data into response | `/api/sales/orders` POST |
| TC-UMES-017 | Interceptor respects route pattern matching with wildcards | Route matching |

### Phase 5 — DataTable & CrudForm Extensions
| Test ID | Scenario | Path |
|---------|----------|------|
| TC-UMES-018 | Injected column renders in DataTable at correct position | DataTable rendering |
| TC-UMES-019 | Injected row action appears in row actions menu | DataTable row actions |
| TC-UMES-020 | Injected filter appears in filter bar and sends correct query param | DataTable filtering |
| TC-UMES-021 | Injected form field renders at correct position within group | CrudForm field injection |
| TC-UMES-022 | Injected form field's `onSave` handler is called with correct data | CrudForm save |

### Phase 6 — Recursive Widget Extension
| Test ID | Scenario | Path |
|---------|----------|------|
| TC-UMES-023 | Widget-level injection spot renders child widgets | Widget composition |
| TC-UMES-024 | Widget behavior extension runs alongside original handler | Widget event pipeline |

---

## 17. Final Compliance Report

| Check | Status |
|-------|--------|
| No direct ORM relationships between modules | PASS — enrichers use read-only EM, no cross-module entity imports |
| All entities filtered by organization_id | PASS — enricher context always includes organizationId |
| Zod validation for all inputs | PASS — interceptor request/response schemas, component propsSchema |
| RBAC feature gating | PASS — all extension types support `features` array |
| No raw fetch | PASS — enrichers use EM, interceptors use framework internals |
| Backward compatible with existing injection system | PASS — all existing APIs preserved, new features additive |
| Auto-discovery via CLI generator | PASS — new files follow existing `yarn generate` pattern |
| i18n for user-facing strings | PASS — all labels use i18n keys |
| No hardcoded strings | PASS — labels, messages, descriptions all use locale references |

---

## 18. Appendix A — Insights from Code Analysis

This section captures critical implementation details learned from deep-diving into the actual codebase, particularly the record-locking widget (PR #635) and the core injection infrastructure.

### A.1 Current Runtime Architecture (How It Actually Works)

The widget injection system is built on three layers:

**Layer 1 — Type System** (`packages/shared/src/modules/widgets/injection.ts`):
- `WidgetInjectionEventHandlers<TContext, TData>` — generic event handler contract
- `WidgetBeforeSaveResult` — union type: `boolean | void | { ok, message, fieldErrors, requestHeaders, details }`
- `ModuleInjectionTable` — `Record<InjectionSpotId, ModuleInjectionSlot | ModuleInjectionSlot[]>`
- `InjectionWidgetPlacement` — rendering hints: `kind: 'tab' | 'group' | 'stack'`, `column: 1 | 2`

**Layer 2 — Loading & Registration** (`packages/shared/src/modules/widgets/injection-loader.ts`):
- Uses `globalThis` keys (`__openMercatoCoreInjectionWidgetEntries__`, `__openMercatoCoreInjectionTables__`) to survive HMR in development
- Widget modules loaded lazily via `entry.loader()` and cached in a `Map<string, Promise<LoadedWidgetModule>>`
- Wildcard matching via regex: `candidateSpotId.replace(/\*/g, '.*')` converted to `RegExp`
- Deduplication by `moduleId:widgetId` key — highest priority wins when same widget registered for both exact and wildcard
- Sorting: `(b.priority ?? 0) - (a.priority ?? 0)` — higher priority = runs first

**Layer 3 — UI Runtime** (`packages/ui/src/backend/injection/`):
- `InjectionSpot` component: renders widget React components, triggers `onLoad` on mount
- `useInjectionSpotEvents` hook: imperative event triggering, normalizes `WidgetBeforeSaveResult` to consistent `{ ok, message, fieldErrors, requestHeaders, details }`
- `useGuardedMutation` hook: wraps any mutation with `onBeforeSave` → `operation()` → `onAfterSave`, manages scoped headers and retry
- Delete events **fallback to save handlers**: if `onBeforeDelete` isn't defined, `onBeforeSave` is called instead (same for `onDelete`→`onSave`, `onAfterDelete`→`onAfterSave`)

### A.2 Scoped Request Headers — The Critical Bridge Pattern

The `withScopedApiRequestHeaders(headers, operation)` function in `packages/ui/src/backend/utils/apiCall.ts` is the key mechanism that bridges client-side widgets to server-side API routes. This is how record-locking works:

1. Widget's `onBeforeSave` returns `{ ok: true, requestHeaders: { 'x-om-record-lock-token': '...' } }`
2. `useGuardedMutation.runMutation()` wraps the mutation `operation()` in `withScopedApiRequestHeaders(requestHeaders, operation)`
3. The scoped header stack pushes headers before the operation and pops after
4. All `apiCall()` invocations within the operation automatically include the scoped headers
5. Server-side `crudMutationGuardService` reads these headers to validate the lock token

**Implication for UMES**: This pattern should be the standard way for any extension to pass context from client to server. The `requestHeaders` return from `onBeforeSave` is already a general-purpose extension mechanism.

### A.3 Record-Locking Widget — Lessons for Extension System Design

The record-locking widget (`packages/enterprise/src/modules/record_locks/widgets/injection/`) is the most complex widget in the codebase (1400+ lines client component) and reveals patterns that the UMES should formalize:

**Pattern 1: Primary Instance Election**
Multiple widget instances can mount for the same record (e.g., on detail page + in dialog). Record-locking uses a global `Map` (`GLOBAL_RECORD_LOCK_OWNERS_KEY`) to elect a primary instance — only the primary makes API calls. UMES should provide a built-in `usePrimaryInstance(key)` hook.

**Pattern 2: Client-Side State Store**
The `clientLockStore.ts` implements a pub/sub store (`getState`, `setState`, `subscribe`) shared between widget.ts event handlers and widget.client.tsx React component. This pattern should be standardized as `createWidgetStore<TState>()` in the injection framework.

**Pattern 3: Backend Mutation Error Channel**
Widget uses `window.dispatchEvent(new CustomEvent(BACKEND_MUTATION_ERROR_EVENT, { detail }))` to propagate save errors to the conflict dialog. The error payload is extracted via BFS search through nested error properties. UMES should formalize this error channel with typed events.

**Pattern 4: Beacon-Based Cleanup**
Lock release on page unload uses `navigator.sendBeacon()` with `keepalive` fallback — critical for resource cleanup. UMES should document this pattern and potentially provide a `useWidgetCleanup(callback)` hook.

**Pattern 5: Portal Rendering**
The lock banner renders via `createPortal()` to `#om-top-banners` — a DOM element outside the widget's position in the React tree. UMES should define standard portal targets.

### A.4 Command Bus Integration Point

The command bus (`packages/shared/src/lib/commands/command-bus.ts`) executes commands through a pipeline:
1. `prepare()` → capture before state
2. `execute()` → perform mutation
3. `captureAfter()` → capture after state
4. `buildLog()` → audit metadata
5. Persist to ActionLog
6. Cache invalidation via tags
7. ORM flush

**API interceptors** (Phase 4) should hook into the command bus pipeline rather than at the HTTP route level. This ensures interceptors work for both API calls and internal command invocations (e.g., workflow steps).

### A.5 CRUD Factory Hook Points

The CRUD factory (`packages/shared/src/lib/crud/factory.ts`) already has hooks:
```typescript
CrudHooks = {
  beforeList, afterList,
  beforeCreate, afterCreate,
  beforeUpdate, afterUpdate,
  beforeDelete, afterDelete,
}
```

Plus the mutation guard integration:
```typescript
validateCrudMutationGuard(container, { resourceKind, resourceId, operation, requestHeaders, mutationPayload })
runCrudMutationGuardAfterSuccess(container, { ... })
```

**API interceptors should compose with these existing hooks**, not replace them. The interceptor `before` hook runs before `validateCrudMutationGuard`, and the interceptor `after` hook runs after the response is built but before enrichers.

### A.6 Event System Coexistence

The event system (`packages/events/src/bus.ts`) provides:
- **Ephemeral subscribers**: immediate in-process delivery (cache invalidation, query index)
- **Persistent subscribers**: async queue delivery with retry (notifications, search indexing)
- **Pattern matching**: wildcard event patterns (`customers.*`)

**UMES interceptors should NOT duplicate event subscriber functionality.** The distinction:
- Interceptors are **synchronous** (block the request/response cycle)
- Subscribers are **asynchronous** (fire-and-forget after mutation)
- Interceptors can **modify** the request/response
- Subscribers only **react** to completed events

### A.7 Bootstrap Registration Sequence

Current bootstrap order (from `packages/core/src/bootstrap.ts`):
1. Cache service
2. Event bus + global reference (`globalThis.__openMercatoGlobalEventBus__`)
3. Subscriber registration
4. Encryption service
5. Rate limiter
6. Search module

Widget injection registration happens separately in `registerWidgetsAndOptionalPackages()`:
1. Dynamic import `@open-mercato/ui/backend/injection/widgetRegistry`
2. `registerInjectionWidgets(entries)` — UI-side registry
3. Dynamic import `@open-mercato/core/modules/widgets/lib/injection`
4. `registerCoreInjectionWidgets(entries)` — shared-side registry
5. `registerCoreInjectionTables(tables)` — injection table mappings

**New UMES registries** (enrichers, interceptors, component overrides) should follow this same pattern: generated files → bootstrap registration → `globalThis` for HMR.

### A.8 Generated File Pattern

All auto-discovered files are generated into `apps/mercato/.mercato/generated/`:
- `injection-widgets.generated.ts` — widget entry loaders
- `injection-tables.generated.ts` — all injection table mappings

Each entry has a `loader: () => import(...)` function for lazy loading. New UMES files (`enrichers.generated.ts`, `interceptors.generated.ts`, `component-overrides.generated.ts`) should follow the identical pattern.

### A.9 DataTable Current Injection Points

From actual code analysis, DataTable already supports:
- `data-table:<tableId>:header` — via `<InjectionSpot>` above the table
- `data-table:<tableId>:footer` — via `<InjectionSpot>` below the table
- But **no column, row action, filter, or bulk action injection** — these are the gaps Phase 5 fills

CrudForm already supports:
- `crud-form:<entityId>` — widget rendering in form body (groups, tabs, stacks)
- `backend:record:current` — mutation-level hooks
- `crud-form:*` — wildcard for all forms
- But **no field-level injection, no per-group injection, no field-adjacent slots** — Phase 1 and 5 address this

### A.10 CrudForm Save Flow (Actual Code Path)

From `CrudForm.tsx` lines 1100-1332, the exact save flow:

```
1. handleSubmit()
2. Flush active element blur (await sleep(10))
3. Required field validation (iterate fields, check values)
4. Custom field validation (CE definitions, required checks)
5. Schema validation (Zod parse, collect field errors)
6. If errors → setErrors(), return
7. triggerEvent('onBeforeSave', values, injectionContext)
   ├─ If !ok → raiseCrudError(message), return
   ├─ If fieldErrors → merge with form errors, return
   └─ If requestHeaders → saved for step 8
8. withScopedApiRequestHeaders(requestHeaders, async () => {
     await onSubmit(parsedValues)
   })
9. triggerEvent('onAfterSave', values, injectionContext)
10. Success flash + redirect
```

**Key insight**: `onBeforeSave` runs AFTER client-side Zod validation but BEFORE the API call. This means widget validators can assume the form data passes schema validation.

---

## 19. Appendix B — Competitive Analysis Summary

| Platform | Strengths to Adopt | Weaknesses to Avoid |
|----------|-------------------|---------------------|
| **WordPress** | Actions vs Filters distinction; priority system; recursive hooks (`do_action` inside plugins); `remove_action` API | Global mutable state; no type safety; no lazy loading |
| **Shopify** | Extension targets (typed string IDs); constrained component set; sandboxed execution; merchant-configurable | Overly restrictive (64KB limit); no cross-extension communication; tied to Shopify infrastructure |
| **VSCode** | Contribution points (declarative); activation events (lazy); Extension Host (isolated process); extensions can extend extensions | Complex activation model; process isolation overhead; large API surface |
| **GraphQL Federation** | `@key` + `@extends` for data composition; subgraph independence; automated type merging | Gateway complexity; debugging distributed queries; versioning challenges |
| **Browser Extensions** | Content scripts inject into ANY page; isolated worlds; pattern-based targeting; `chrome.runtime.sendMessage` | No component-level granularity; security risks from full DOM access; performance impact |

**Key patterns adopted by UMES:**
1. **Actions vs Transformers** (WordPress) → `onBeforeSave` (action) vs `transformFormData` (transformer)
2. **Typed Extension Targets** (Shopify) → Standardized spot ID taxonomy
3. **Lazy Activation** (VSCode) → Existing `loader()` pattern in injection-loader.ts
4. **Data Federation** (GraphQL) → Response enrichers
5. **Pattern Matching** (Browser) → Wildcard spot IDs (`crud-form:*`)
6. **Priority System** (WordPress) → Existing priority in injection tables
7. **Removal API** (WordPress) → Component override with `propsTransform: () => null` for conditional hiding

---

## 20. Changelog

| Date | Change |
|------|--------|
| 2026-02-24 | Initial draft — complete spec with 6 phases, appendices with code analysis and competitive analysis |
| 2026-02-24 | Backward compatibility review: resolved 4 medium-severity concerns — added dual-mode event dispatch (§4.5), enricher ordering guarantee (§6.3), interceptor execution order with re-validation (§7.3), headless widget loader (§8.7); updated event flow (§10.3) |
