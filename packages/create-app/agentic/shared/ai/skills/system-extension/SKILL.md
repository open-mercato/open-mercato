---
name: system-extension
description: Extend core modules using the Universal Module Extension System (UMES). Use when adding columns/fields/filters to existing tables/forms, enriching API responses, intercepting API routes, blocking/validating mutations, replacing UI components, injecting menu items, or reacting to domain events. Triggers on "extend", "add column to", "add field to", "inject into", "intercept", "enrich", "hook into", "customize", "override component", "add menu item", "react to event", "block mutation", "validate before save".
---

# System Extension — UMES Wizard

Extend any core module without modifying its source code. This skill guides you through the Universal Module Extension System (UMES) — selecting the right mechanism, generating all required files, and wiring everything correctly.

For full type contracts, see `references/extension-contracts.md`.

## Table of Contents

1. [Decision Tree](#1-decision-tree)
2. [Response Enrichers](#2-response-enrichers)
3. [Widget Injection — Fields](#3-widget-injection--fields)
4. [Widget Injection — Columns](#4-widget-injection--columns)
5. [Widget Injection — Filters](#5-widget-injection--filters)
6. [Widget Injection — Row Actions & Bulk Actions](#6-widget-injection--row-actions--bulk-actions)
7. [Widget Injection — Menu Items](#7-widget-injection--menu-items)
8. [API Interceptors](#8-api-interceptors)
9. [Mutation Guards](#9-mutation-guards)
10. [Component Replacement](#10-component-replacement)
11. [Event Subscribers](#11-event-subscribers)
12. [The Triad Pattern](#12-the-triad-pattern)
13. [Wiring & Verification](#13-wiring--verification)

---

## 1. Decision Tree

Ask what the developer wants to achieve. Match to the correct mechanism(s).

| Goal | Mechanism(s) Required | Section |
|------|----------------------|---------|
| **Add data to another module's API response** | Response Enricher | §2 |
| **Add a field to another module's form** | Response Enricher + Field Widget + injection-table (Triad) | §12 |
| **Add a column to another module's table** | Response Enricher + Column Widget + injection-table (Triad) | §12 |
| **Add a filter to another module's table** | Filter Widget + injection-table + API Interceptor (for server filters) | §5 + §8 |
| **Add row/bulk actions to another module's table** | Row Action / Bulk Action Widget + injection-table | §6 |
| **Add a menu item to sidebar/topbar** | Menu Item Widget + injection-table | §7 |
| **Validate/block a request before it reaches an API route** | API Interceptor (before hook) | §8 |
| **Transform/enrich an API response after it returns** | API Interceptor (after hook) or Response Enricher | §8 or §2 |
| **Block/validate mutations before entity persistence** | Mutation Guard | §9 |
| **Replace or wrap a UI component** | Component Replacement | §10 |
| **React to domain events (after entity create/update/delete)** | Event Subscriber | §11 |
| **Add a tab/section to a detail page** | Widget Injection (tab kind) + injection-table | §6 |

**When multiple mechanisms are needed** (e.g., "add a column"), follow the **Triad Pattern** (§12) which wires enricher → widget → injection-table as a coordinated set.

---

## 2. Response Enrichers

**Purpose**: Add computed fields to another module's API response. Fields are namespaced under `_<yourModule>` to avoid collisions.

**File**: `src/modules/<your-module>/data/enrichers.ts`

### Template

```typescript
import type { ResponseEnricher, EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'

const enricher: ResponseEnricher = {
  id: '<your-module>.<enricher-name>',
  targetEntity: '<target-module>.<entity>',  // e.g., 'customers.person'
  priority: 50,
  timeout: 2000,
  fallback: { _<your-module>: {} },

  async enrichOne(record, context: EnricherContext) {
    const em = context.em as EntityManager
    // Fetch your data for this single record
    const data = await em.findOne(YourEntity, {
      foreignId: record.id,
      organizationId: context.organizationId,
    })
    return {
      ...record,
      _<your-module>: {
        fieldName: data?.value ?? null,
      },
    }
  },

  // REQUIRED for list endpoints — prevents N+1 queries
  async enrichMany(records, context: EnricherContext) {
    const em = context.em as EntityManager
    const ids = records.map(r => r.id)
    // Single batch query for ALL records
    const items = await em.find(YourEntity, {
      foreignId: { $in: ids },
      organizationId: context.organizationId,
    })
    const byForeignId = new Map(items.map(i => [i.foreignId, i]))
    return records.map(r => ({
      ...r,
      _<your-module>: {
        fieldName: byForeignId.get(r.id)?.value ?? null,
      },
    }))
  },
}

export const enrichers = [enricher]
```

### Rules

- **MUST** implement `enrichMany` — without it, list endpoints cause N+1 queries
- **MUST** namespace all added fields under `_<your-module>` prefix
- **MUST NOT** modify existing fields — enrichers are additive-only
- **MUST** use batch queries (`$in`) in `enrichMany`, never per-record lookups
- Set `critical: false` (default) so enricher failures don't break the target API
- Set `timeout` to prevent slow external calls from blocking responses
- Set `fallback` to provide safe defaults when enricher times out

### Context Available

```typescript
interface EnricherContext {
  organizationId: string    // Current tenant org
  tenantId: string          // Current tenant
  userId: string            // Authenticated user
  em: EntityManager         // Read-only database access
  container: AwilixContainer // DI container
  requestedFields?: string[] // Sparse fieldset request
  userFeatures?: string[]   // User's ACL features
}
```

---

## 3. Widget Injection — Fields

**Purpose**: Add an editable field to another module's CrudForm.

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

### Template

```typescript
import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

const widget: InjectionFieldWidget = {
  metadata: { id: '<your-module>.injection.<field-name>', priority: 50 },
  fields: [
    {
      id: '_<your-module>.<fieldName>',  // Matches enricher namespace
      label: '<your-module>.fields.<fieldName>',  // i18n key
      type: 'select',  // text | textarea | number | select | checkbox | date | custom
      group: 'details',  // Target group in CrudForm
      options: [
        { value: 'option1', label: '<your-module>.options.option1' },
        { value: 'option2', label: '<your-module>.options.option2' },
      ],
    },
  ],
  eventHandlers: {
    onSave: async (data, context) => {
      const resourceId = (context as Record<string, unknown>).resourceId as string
      const value = (data as Record<string, unknown>)['_<your-module>.<fieldName>']

      // Upsert pattern — idempotent save
      const existing = await readApiResultOrThrow<{ items: Array<{ id: string }> }>(
        `/api/<your-module>/resource?foreignId=${resourceId}`,
      )
      if (existing?.items?.[0]?.id) {
        await readApiResultOrThrow(`/api/<your-module>/resource`, {
          method: 'PUT',
          body: JSON.stringify({ id: existing.items[0].id, foreignId: resourceId, value }),
        })
      } else {
        await readApiResultOrThrow(`/api/<your-module>/resource`, {
          method: 'POST',
          body: JSON.stringify({ foreignId: resourceId, value }),
        })
      }
    },
  },
}

export default widget
```

### Rules

- Field `id` MUST match the enricher namespace path (e.g., `_example.priority`)
- `onSave` endpoints MUST be idempotent (use upsert pattern)
- Widget `onSave` fires BEFORE the core form save — design for partial failure
- Always use i18n keys for `label` and option labels — never hardcode strings
- The field reads its initial value from the enriched API response automatically

---

## 4. Widget Injection — Columns

**Purpose**: Add a column to another module's DataTable.

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

### Template

```typescript
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets'

const widget: InjectionColumnWidget = {
  metadata: { id: '<your-module>.injection.<column-name>', priority: 40 },
  columns: [
    {
      id: '<your-module>_<fieldName>',
      header: '<your-module>.columns.<fieldName>',  // i18n key
      accessorKey: '_<your-module>.<fieldName>',     // Path to enriched data
      sortable: false,  // MUST be false for enriched-only fields
      cell: ({ getValue }) => {
        const value = getValue()
        return typeof value === 'string' ? value : '—'
      },
    },
  ],
}

export default widget
```

### Rules

- `accessorKey` MUST point to enriched field path (e.g., `_example.priority`)
- `sortable` MUST be `false` for enriched-only fields (not in database index)
- Requires a matching Response Enricher that provides the data (Triad Pattern §12)

---

## 5. Widget Injection — Filters

**Purpose**: Add a filter control to another module's DataTable filter bar.

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

### Template

```typescript
import type { InjectionFilterWidget } from '@open-mercato/shared/modules/widgets'

const widget: InjectionFilterWidget = {
  metadata: { id: '<your-module>.injection.<filter-name>', priority: 35 },
  filters: [
    {
      id: '<your-module><FilterName>',
      label: '<your-module>.filters.<filterName>',  // i18n key
      type: 'select',  // select | text | date | dateRange | boolean
      strategy: 'server',  // 'server' = sent as query param, 'client' = filtered locally
      queryParam: '<your-module><FilterName>',
      options: [
        { value: 'value1', label: '<your-module>.options.value1' },
        { value: 'value2', label: '<your-module>.options.value2' },
      ],
    },
  ],
}

export default widget
```

### Server-Side Filtering

When `strategy: 'server'`, the filter value is sent as a query parameter. You need an **API Interceptor** to process it:

```typescript
// api/interceptors.ts
const filterInterceptor: ApiInterceptor = {
  id: '<your-module>.filter-by-<filterName>',
  targetRoute: '<target-module>/<entities>',  // e.g., 'customers/people'
  methods: ['GET'],
  priority: 50,
  async before(request, context) {
    const filterValue = request.query?.['<your-module><FilterName>']
    if (!filterValue) return { ok: true }

    // Query your data to find matching target IDs
    const em = context.em as EntityManager
    const matches = await em.find(YourEntity, {
      fieldName: filterValue,
      organizationId: context.organizationId,
    })
    const matchingIds = matches.map(m => m.foreignId)

    if (matchingIds.length === 0) {
      return { ok: true, query: { ...request.query, ids: 'NONE' } }
    }

    // Narrow results by rewriting the ids query parameter
    const existingIds = request.query?.ids as string | undefined
    const narrowedIds = existingIds
      ? matchingIds.filter(id => existingIds.split(',').includes(id))
      : matchingIds
    return { ok: true, query: { ...request.query, ids: narrowedIds.join(',') } }
  },
}
```

### Rules

- Server filters require a matching API Interceptor to handle the `queryParam`
- Prefer `ids` query narrowing over post-filtering response arrays
- Return `ids: 'NONE'` to return empty results when no matches found

---

## 6. Widget Injection — Row Actions & Bulk Actions

**Purpose**: Add context menu actions or bulk operations to another module's DataTable.

### Row Action Template

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

```typescript
import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

const widget: InjectionRowActionWidget = {
  metadata: { id: '<your-module>.injection.<action-name>', priority: 30 },
  rowActions: [
    {
      id: '<your-module>.<entity>.<action>',
      label: '<your-module>.actions.<actionName>',  // i18n key
      icon: 'CheckSquare',  // Lucide icon name
      features: ['<your-module>.<action>'],  // ACL gating
      placement: { position: InjectionPosition.After, relativeTo: 'edit' },
      onSelect: (row, context) => {
        const id = (row as Record<string, unknown>).id as string
        const navigate = (context as { navigate?: (path: string) => void }).navigate
        navigate?.(`/backend/<your-module>/resource/${id}`)
      },
    },
  ],
}

export default widget
```

### Bulk Action Template

```typescript
import type { InjectionBulkActionWidget } from '@open-mercato/shared/modules/widgets'

const widget: InjectionBulkActionWidget = {
  metadata: { id: '<your-module>.injection.bulk-<action-name>', priority: 30 },
  bulkActions: [
    {
      id: '<your-module>.bulk.<action>',
      label: '<your-module>.actions.bulk<ActionName>',
      features: ['<your-module>.<action>'],
      onExecute: async (selectedRows, context) => {
        const ids = selectedRows.map(r => (r as Record<string, unknown>).id)
        await readApiResultOrThrow(`/api/<your-module>/bulk-action`, {
          method: 'POST',
          body: JSON.stringify({ targetIds: ids }),
        })
        ;(context as { refresh?: () => void }).refresh?.()
      },
    },
  ],
}

export default widget
```

### Tab Widget Template (Detail Pages)

```typescript
import type { InjectionWidget } from '@open-mercato/shared/modules/widgets'

const widget: InjectionWidget = {
  metadata: { id: '<your-module>.injection.<tab-name>', priority: 40 },
  component: () => import('./widget.client'),
}

export default widget
```

Then create the client component at `widget.client.tsx`:

```tsx
'use client'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function MyTabContent({ context }: { context: Record<string, unknown> }) {
  const t = useT()
  const resourceId = context.resourceId as string
  // Fetch and display your data
  return <div>...</div>
}
```

### Rules

- Use `InjectionPosition` for relative placement — never hardcode positions
- Always set `features` for ACL-gated actions
- Row action `id` must be stable for integration testing
- Bulk action `onExecute` should call `refresh()` after mutation

---

## 7. Widget Injection — Menu Items

**Purpose**: Add items to sidebar, topbar, or profile dropdown.

**File**: `src/modules/<your-module>/widgets/injection/<widget-name>/widget.ts`

### Template

```typescript
import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

const widget: InjectionMenuItemWidget = {
  metadata: { id: '<your-module>.injection.menus' },
  menuItems: [
    {
      id: '<your-module>-<page>-link',
      labelKey: '<your-module>.menu.<pageName>',  // i18n key
      label: 'Fallback Label',  // Fallback if i18n missing
      icon: 'LayoutDashboard',  // Lucide icon name
      href: '/backend/<your-module>',
      features: ['<your-module>.view'],  // ACL gating
      groupId: '<your-module>.nav.group',
      groupLabelKey: '<your-module>.nav.group',
      placement: { position: InjectionPosition.Last },
    },
  ],
}

export default widget
```

### Available Spot IDs

| Spot ID | Location |
|---------|----------|
| `menu:sidebar:main` | Main sidebar navigation |
| `menu:sidebar:settings` | Settings sidebar |
| `menu:sidebar:profile` | Profile sidebar |
| `menu:topbar:profile-dropdown` | User profile dropdown |
| `menu:topbar:actions` | Top bar action area |

### Rules

- Use `labelKey` (i18n) instead of `label` whenever possible
- Always set `features` for permission-gated items
- Use `groupId` + `groupLabelKey` to group related menu items
- Menu `id` must be stable for integration tests

---

## 8. API Interceptors

**Purpose**: Hook into API routes to validate, transform, or enrich requests/responses without modifying the route.

**File**: `src/modules/<your-module>/api/interceptors.ts`

### Template

```typescript
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'

const interceptors: ApiInterceptor[] = [
  {
    id: '<your-module>.validate-<action>',
    targetRoute: '<target-module>/<entities>',  // e.g., 'customers/people'
    methods: ['POST', 'PUT'],
    priority: 50,  // Lower = earlier execution
    timeoutMs: 5000,

    async before(request, context) {
      // Validate request
      const value = request.body?.someField
      if (!value) {
        return { ok: false, statusCode: 422, message: 'someField is required' }
      }
      // Optionally rewrite body or query
      return { ok: true, body: { ...request.body, normalizedField: String(value).trim() } }
    },

    async after(request, response, context) {
      // Optionally enrich response
      return {
        merge: {
          _<your-module>: { processedAt: Date.now() },
        },
      }
    },
  },
]

export { interceptors }
```

### Rules

- `before` hook: return `{ ok: false, message }` to reject — never throw errors
- `after` hook: use `merge` to add fields, `replace` to swap entire response body
- Prefer exact `targetRoute` over wildcards (`*`) — wildcards match too broadly
- For filtering: rewrite `query.ids` (comma-separated UUIDs) — never post-filter response arrays
- Set `features` for permission-gated interceptors
- Interceptors run BEFORE sync event subscribers and mutation guards in the pipeline

---

## 9. Mutation Guards

**Purpose**: Block or validate mutations at the entity level before database persistence. Runs after interceptors and before ORM flush.

**File**: `src/modules/<your-module>/data/guards.ts`

### Template

```typescript
import type { MutationGuard, MutationGuardInput, MutationGuardResult } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const guard: MutationGuard = {
  id: '<your-module>.<guard-name>',
  targetEntity: '<target-module>.<entity>',  // or '*' for all entities
  operations: ['create', 'update'],  // create | update | delete
  priority: 50,  // Lower = earlier execution

  async validate(input: MutationGuardInput): Promise<MutationGuardResult> {
    // input.resourceId is null for create operations
    // input.mutationPayload contains the data being saved

    if (someConditionFails) {
      return {
        ok: false,
        status: 422,
        message: 'Validation failed: reason',
      }
    }

    // Optionally transform payload
    return {
      ok: true,
      modifiedPayload: { ...input.mutationPayload, normalizedField: 'value' },
      shouldRunAfterSuccess: true,
      metadata: { originalValue: input.mutationPayload?.field },
    }
  },

  async afterSuccess(input) {
    // Runs after successful mutation — for cleanup, cache invalidation, logging
    // input.metadata contains what you passed from validate()
  },
}

export const guards = [guard]
```

### Rules

- `resourceId` is `null` for create operations — handle this case
- Return a new object for `modifiedPayload` — never mutate `input.mutationPayload` in place
- Guards with `targetEntity: '*'` run on EVERY entity mutation — use sparingly
- `afterSuccess` only runs when `shouldRunAfterSuccess: true` in the validate result
- Guard errors should return structured `{ ok: false, message }` — never throw

---

## 10. Component Replacement

**Purpose**: Replace, wrap, or transform props of registered UI components without forking source code.

**File**: `src/modules/<your-module>/widgets/components.ts`

### Template

```typescript
import React from 'react'
import type { ComponentOverride } from '@open-mercato/shared/modules/widgets/component-registry'
import { ComponentReplacementHandles } from '@open-mercato/shared/modules/widgets/component-registry'

export const componentOverrides: ComponentOverride[] = [
  // Mode 1: Wrapper — decorate existing component (safest)
  {
    target: { componentId: ComponentReplacementHandles.section('ui.detail', 'NotesSection') },
    priority: 50,
    metadata: { module: '<your-module>' },
    wrapper: (Original) => {
      const Wrapped = (props: any) =>
        React.createElement(
          'div',
          { className: 'border border-blue-200 rounded-md p-2' },
          React.createElement(Original, props),
        )
      Wrapped.displayName = '<YourModule>NotesWrapper'
      return Wrapped
    },
  },

  // Mode 2: Props transform — modify incoming props
  {
    target: { componentId: ComponentReplacementHandles.dataTable('customers.people') },
    priority: 40,
    metadata: { module: '<your-module>' },
    propsTransform: (props: any) => ({
      ...props,
      defaultPageSize: 25,
    }),
  },

  // Mode 3: Replace — full component swap (highest risk)
  {
    target: { componentId: ComponentReplacementHandles.section('sales.order', 'ShipmentDialog') },
    priority: 50,
    metadata: { module: '<your-module>' },
    replacement: React.lazy(() => import('./CustomShipmentDialog')),
    propsSchema: ShipmentDialogPropsSchema,  // Zod schema for validation
  },
]
```

### Handle IDs

| Handle | Format | Example |
|--------|--------|---------|
| `page` | `page:<path>` | `page:backend/customers/people` |
| `dataTable` | `data-table:<tableId>` | `data-table:customers.people` |
| `crudForm` | `crud-form:<entityId>` | `crud-form:customers.person` |
| `section` | `section:<scope>.<sectionId>` | `section:ui.detail.NotesSection` |

### Rules

- Prefer `wrapper` mode — it preserves the original component and is least likely to break
- `replacement` mode REQUIRES a `propsSchema` (Zod) for dev-mode contract validation
- Always set `displayName` on wrapper components for React DevTools debugging
- Wrapper composition: lower priority = innermost, higher priority = outermost

---

## 11. Event Subscribers

**Purpose**: React to domain events emitted by other modules (e.g., after entity creation).

**File**: `src/modules/<your-module>/subscribers/<subscriber-name>.ts`

### Template

```typescript
export const metadata = {
  event: 'customers.person.created',  // module.entity.action (past tense)
  persistent: true,  // true = survives server restart (uses queue)
  id: '<your-module>:on-customer-created',
}

export default async function handler(payload: Record<string, unknown>, ctx: unknown) {
  const { resourceId, organizationId, tenantId } = payload as {
    resourceId: string
    organizationId: string
    tenantId: string
  }

  // Perform side effects
  // Examples: create related records, send notifications, sync external systems
}
```

### Sync Subscribers (Before-Event)

For subscribers that need to run **before** a mutation completes and can block it:

```typescript
export const metadata = {
  event: 'customers.person.creating',  // .creating = before event (present tense)
  persistent: false,
  id: '<your-module>:validate-customer-create',
  sync: true,      // Run synchronously in request pipeline
  priority: 50,    // Lower = earlier
}

export default async function handler(payload: Record<string, unknown>) {
  const data = payload as { mutationPayload?: Record<string, unknown> }

  if (someConditionFails(data.mutationPayload)) {
    return { ok: false, status: 422, message: 'Cannot create: reason' }
  }

  // Optionally modify the mutation data
  return { ok: true, modifiedPayload: { ...data.mutationPayload, enrichedField: 'value' } }
}
```

### Event Naming Convention

| Event | Timing | Can Block? |
|-------|--------|-----------|
| `module.entity.creating` | Before create | Yes (sync only) |
| `module.entity.created` | After create | No |
| `module.entity.updating` | Before update | Yes (sync only) |
| `module.entity.updated` | After update | No |
| `module.entity.deleting` | Before delete | Yes (sync only) |
| `module.entity.deleted` | After delete | No |

### Rules

- After-events (`.created`, `.updated`, `.deleted`) cannot block — they are fire-and-forget
- Before-events (`.creating`, `.updating`, `.deleting`) require `sync: true` to block mutations
- Subscribers MUST be idempotent — events may be delivered more than once
- Use `persistent: true` for critical side effects that must survive restarts

---

## 12. The Triad Pattern

When extending another module's UI with data from your module, you need three coordinated pieces:

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  1. ENRICHER    │────▶│  2. WIDGET       │────▶│  3. INJECTION     │
│  (data/         │     │  (widgets/       │     │     TABLE         │
│   enrichers.ts) │     │   injection/     │     │  (widgets/        │
│                 │     │   <name>/        │     │   injection-      │
│  Adds _<module> │     │   widget.ts)     │     │   table.ts)       │
│  fields to API  │     │                  │     │                   │
│  response       │     │  Renders the     │     │  Maps widget to   │
│                 │     │  enriched data   │     │  target spot ID   │
└─────────────────┘     └──────────────────┘     └───────────────────┘
```

### Example: Add "Priority" field to Customers form

**Step 1 — Enricher** (`data/enrichers.ts`):
```typescript
const enricher: ResponseEnricher = {
  id: 'priorities.customer-priority',
  targetEntity: 'customers.person',
  priority: 50,
  async enrichOne(record, context) {
    const priority = await em.findOne(CustomerPriority, { customerId: record.id })
    return { ...record, _priorities: { level: priority?.level ?? 'normal' } }
  },
  async enrichMany(records, context) {
    const items = await em.find(CustomerPriority, { customerId: { $in: records.map(r => r.id) } })
    const byId = new Map(items.map(i => [i.customerId, i.level]))
    return records.map(r => ({ ...r, _priorities: { level: byId.get(r.id) ?? 'normal' } }))
  },
}
export const enrichers = [enricher]
```

**Step 2 — Field Widget** (`widgets/injection/customer-priority-field/widget.ts`):
```typescript
const widget: InjectionFieldWidget = {
  metadata: { id: 'priorities.injection.customer-priority-field', priority: 50 },
  fields: [{
    id: '_priorities.level',
    label: 'priorities.fields.level',
    type: 'select',
    group: 'details',
    options: [
      { value: 'low', label: 'priorities.options.low' },
      { value: 'normal', label: 'priorities.options.normal' },
      { value: 'high', label: 'priorities.options.high' },
    ],
  }],
  eventHandlers: {
    onSave: async (data, context) => {
      const customerId = (context as any).resourceId
      const level = (data as any)['_priorities.level']
      await readApiResultOrThrow('/api/priorities/customer-priorities', {
        method: 'POST',
        body: JSON.stringify({ customerId, level }),
      })
    },
  },
}
export default widget
```

**Step 3 — Injection Table** (`widgets/injection-table.ts`):
```typescript
export const widgetInjections = {
  'crud-form:customers.person:fields': {
    widgetId: 'priorities.injection.customer-priority-field',
    priority: 50,
  },
}
```

**Step 4 — Run `yarn generate`** to wire everything up.

### Triad for Columns

Same pattern but with Column Widget instead of Field Widget:

| Spot ID Pattern | Widget Type |
|----------------|-------------|
| `crud-form:<entityId>:fields` | `InjectionFieldWidget` |
| `data-table:<tableId>:columns` | `InjectionColumnWidget` |
| `data-table:<tableId>:row-actions` | `InjectionRowActionWidget` |
| `data-table:<tableId>:bulk-actions` | `InjectionBulkActionWidget` |
| `data-table:<tableId>:filters` | `InjectionFilterWidget` |

---

## 13. Wiring & Verification

### File Checklist

After implementing an extension, verify all files exist:

| File | Required When |
|------|--------------|
| `data/enrichers.ts` | Adding data to another module's API response |
| `widgets/injection/<name>/widget.ts` | Adding UI elements (fields, columns, actions, menus) |
| `widgets/injection-table.ts` | Mapping widgets to target spots |
| `widgets/components.ts` | Replacing/wrapping UI components |
| `api/interceptors.ts` | Intercepting API routes |
| `data/guards.ts` | Blocking/validating mutations |
| `subscribers/<name>.ts` | Reacting to domain events |

### Post-Implementation Steps

1. **Run `yarn generate`** — registers new enrichers, widgets, interceptors, guards
2. **Run `yarn dev`** — verify extension appears in target module UI
3. **Check browser console** — look for warnings about invalid spot IDs or missing enrichers
4. **Test the full flow** — create/edit/delete in the target module, verify your extension works

### Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Missing `enrichMany` | Slow list pages, N+1 queries | Implement batch enrichment with `$in` query |
| Wrong spot ID | Widget doesn't appear | Check exact spot ID format in target module |
| Missing `yarn generate` | Extension not discovered | Run `yarn generate` after adding files |
| Hardcoded strings | i18n warnings | Use `labelKey` / i18n keys everywhere |
| Missing `features` | Extension visible to all users | Add ACL `features` array |
| `onSave` not idempotent | Duplicate records on retry | Use upsert pattern (check-then-create-or-update) |
| `sortable: true` on enriched column | Sort doesn't work | Set `sortable: false` for enriched-only fields |
| Throw in interceptor | 500 error | Return `{ ok: false, message }` instead |
| Missing injection-table entry | Widget exists but not rendered | Add mapping in `injection-table.ts` |

---

## Rules

- **MUST** run `yarn generate` after adding any extension file
- **MUST** use i18n keys for all user-facing strings
- **MUST** implement `enrichMany` when creating Response Enrichers
- **MUST** namespace enriched fields under `_<your-module>` prefix
- **MUST** make `onSave` endpoints idempotent
- **MUST** use `{ ok: false, message }` pattern instead of throwing errors in interceptors/guards
- **MUST** set `sortable: false` on columns backed by enriched data only
- **MUST NOT** modify existing fields in enrichers — additive only
- **MUST NOT** directly import entities from other modules — use EntityManager queries
- **MUST NOT** use wildcard interceptor routes unless absolutely necessary
- Prefer Response Enrichers over API Interceptor `after` hooks for adding data to responses
- Prefer Mutation Guards over sync before-event subscribers for blocking mutations
- When extending UI and data together, always follow the Triad Pattern (enricher → widget → injection-table)
