# SPEC-041f — DataTable Deep Extensibility

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | F (PR 6) |
| **Branch** | `feat/umes-datatable-extensions` |
| **Depends On** | Phase A (Foundation), Phase D (Response Enrichers) |
| **Status** | Draft |

## Goal

Allow modules to inject columns, row actions, bulk actions, and filters into another module's DataTable — with data sourced from response enrichers (Phase D).

---

## Scope

### 0. Table ID Convention

DataTable auto-derives its injection spot ID from `perspective?.tableId` or the `injectionSpotId` prop. The `tableId` comes from the Perspective system (e.g., `customers.people` for the customers people list). Injection-table entries MUST use the `tableId` that matches what the DataTable's perspective provides.

Spot ID format: `data-table:<tableId>:<surface>` where `<surface>` is one of `columns`, `row-actions`, `bulk-actions`, `filters`.

Example: for the customers people list with `tableId = 'customers.people'`:
- `data-table:customers.people:columns`
- `data-table:customers.people:row-actions`

**Key rule**: Check the actual DataTable's `perspective.tableId` or `injectionSpotId` prop to determine the correct `tableId`. Do NOT guess — different pages may use different conventions.

### 1. `useInjectedTableExtensions(tableId)` Hook

```typescript
// In DataTable.tsx
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

### 2. DataTable Column Injection

Injected columns read data from response enrichers. The enricher (Phase D) batch-fetches data server-side via `enrichMany` — the DataTable receives enriched rows.

**Complete data flow**:
```
1. Parent page calls: GET /api/customers/people?page=1&pageSize=25
2. Server-side CRUD factory:
   ├─ Core query: SELECT * FROM people WHERE org_id = ? LIMIT 25
   ├─ afterList hook (existing)
   └─ Enrichers (Phase D):
      └─ example.enrichMany → 1 query for 25 rows → adds _example to each row
3. Response arrives with enriched rows
4. DataTable renders:
   ├─ Core columns: Name, Email, Status, ...
   └─ Injected column "Todos": reads row._example.todoCount
```

**Zero N+1 queries. Zero client-side fetching per row.**

**Key rule**: Injected columns MUST set `sortable: false` unless the column's `accessorKey` maps to a field that exists in the target entity's query index. Sorting on enriched-only data (`_example.*`) is not supported — it would require the query engine to know about cross-module fields.

### 3. DataTable Row Action Injection

```typescript
rowActions: [
  {
    id: 'view-todos',
    label: 'example.action.viewTodos',
    icon: 'CheckSquare',
    onSelect: (row, context) => {
      context.navigate(`/backend/example/todos?assignedTo=${row.id}`)
    },
    placement: { position: InjectionPosition.After, relativeTo: 'edit' },
  },
]
```

### 4. DataTable Bulk Action Injection

```typescript
bulkActions: [
  {
    id: 'bulk-assign-todos',
    label: 'example.action.bulkAssignTodos',
    icon: 'CheckSquare',
    onExecute: async (selectedRows, context) => {
      return context.openDialog('example.bulk-assign', {
        customerIds: selectedRows.map(r => r.id),
      })
    },
  },
]
```

**Bulk action error contract**: `onExecute` returns `Promise<{ ok: boolean; message?: string; affectedCount?: number }>`. On partial failure, return `{ ok: false, message: '3 of 5 failed', affectedCount: 2 }`. DataTable surfaces the message via flash.

**ID deduplication**: If two modules inject row actions or bulk actions with the same `id`, the one from the higher-priority widget wins. A dev-mode console warning is logged.

### 5. DataTable Filter Injection (Three-Tier Architecture)

#### The Problem

A loyalty module wants to add a "Tier" filter to the customers list. But the customers API (`GET /api/customers/people`) has no idea what `loyaltyTier` is — it's not a column on the `people` table, it's not in the query index, and the customers CRUD factory's Zod schema will reject unknown query parameters.

#### Tier 1 — API Interceptor Filter (Server-Side Query Rewriting)

For cross-module filtering that needs server-side query modification:

```typescript
// loyalty/api/interceptors.ts
export const interceptors: ApiInterceptor[] = [
  {
    id: 'loyalty.filter-by-tier',
    targetRoute: 'customers/people',
    methods: ['GET'],
    features: ['loyalty.view'],
    async before(request, ctx) {
      const tierFilter = request.query.loyaltyTier
      if (!tierFilter) return { ok: true }

      const memberships = await ctx.em.find(LoyaltyMembership, {
        tier: tierFilter,
        organizationId: ctx.organizationId,
      }, { fields: ['customerId'] })

      const customerIds = memberships.map(m => m.customerId)

      if (customerIds.length === 0) {
        return { ok: true, query: { ...request.query, id: { $in: [] } } }
      }

      return {
        ok: true,
        query: {
          ...request.query,
          id: { $in: customerIds },
          loyaltyTier: undefined,  // Remove non-native param
        },
      }
    },
  },
]
```

#### Tier 2 — Client-Side Filter (Enriched Data Filtering)

For filtering on enriched data already present in the response (small datasets, pageSize ≤ 100):

```typescript
// loyalty/widgets/injection/customer-filters/widget.ts
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
        { value: 'bronze', label: 'loyalty.tier.bronze' },
        { value: 'silver', label: 'loyalty.tier.silver' },
        { value: 'gold', label: 'loyalty.tier.gold' },
      ],
      strategy: 'server',
      queryParam: 'loyaltyTier',
    },
  ],
} satisfies InjectionFilterWidget
```

#### Complete Filter Flow (Server Strategy)

```
1. Loyalty module registers:
   - Filter widget (UI dropdown in DataTable toolbar)
   - API interceptor (translates loyaltyTier → customer ID list)

2. User selects "Gold" in Loyalty Tier filter
   → URL becomes: ?status=active&loyaltyTier=gold

3. Parent page fetches: GET /api/customers/people?status=active&loyaltyTier=gold

4. Server-side:
   a. API Interceptor runs BEFORE Zod validation
      → Queries loyalty_memberships WHERE tier = 'gold' → gets [id1, id5, id12]
      → Rewrites query: { status: 'active', id: { $in: ['id1', 'id5', 'id12'] } }
      → Removes loyaltyTier param
   b. Zod validates the rewritten query (valid — id and status are known params)
   c. Query engine filters: SELECT * FROM people WHERE status = 'active' AND id IN (...)
   d. Enrichers add _loyalty data to results

5. DataTable renders filtered, enriched rows
```

#### Tier 3 — Post-Query Merge Filter (When Core API Can't Be Rewritten)

For cases where the target API has complex query logic that can't accept injected ID filters (e.g., pagination conflicts):

```typescript
// credit_scoring/api/interceptors.ts
export const interceptors: ApiInterceptor[] = [
  {
    id: 'credit_scoring.filter-orders-by-risk',
    targetRoute: 'sales/documents',
    methods: ['GET'],
    features: ['credit_scoring.view'],

    async before(request, ctx) {
      const creditRisk = request.query.creditRisk
      if (!creditRisk) return { ok: true }
      return {
        ok: true,
        query: { ...request.query, creditRisk: undefined },
        metadata: { creditRiskFilter: creditRisk },
      }
    },

    async after(request, response, ctx) {
      const creditRiskFilter = ctx.metadata?.creditRiskFilter
      if (!creditRiskFilter) return {}

      const records = response.body.data ?? response.body.items ?? []
      if (!records.length) return {}

      const customerIds = [...new Set(records.map((r: any) => r.customerId).filter(Boolean))]
      const scores = await ctx.em.find(CreditScore, {
        customerId: { $in: customerIds },
        organizationId: ctx.organizationId,
      })
      const scoreMap = new Map(scores.map(s => [s.customerId, s]))

      const filtered = records.filter((record: any) => {
        const score = scoreMap.get(record.customerId)
        return score?.riskLevel === creditRiskFilter
      })

      return {
        replace: {
          ...response.body,
          data: filtered,
          total: filtered.length,
          _meta: {
            ...(response.body._meta ?? {}),
            postFiltered: true,
            originalTotal: response.body.total,
          },
        },
      }
    },
  },
]
```

#### Trade-offs

| Aspect | Tier 1 (ID Rewrite) | Tier 3 (Post-Query Merge) |
|--------|---------------------|--------------------------|
| **Pagination** | Accurate — core paginates on filtered IDs | Inaccurate — page may have fewer items than `pageSize` |
| **Performance** | Two queries: one for IDs + one for core data | One core query + one for filter data, but post-filtering |
| **Total count** | Correct | Corrected but may differ from expected page count |
| **Use when** | Target API supports `id: { $in: [...] }` | Target API has complex query logic that can't be rewritten |

**Recommendation**: Prefer Tier 1 (ID rewrite) whenever possible. Use Tier 3 only when the API's query engine cannot accept injected ID filters.

**Tier 3 pagination UX**: When `_meta.postFiltered: true` is present in the response, DataTable SHOULD show a visual indicator (e.g., "Results filtered client-side, counts may be approximate"). The total count display should show `~N` instead of `N` to communicate the approximation.

#### Tier 2a — Client-Side Filter (Post-Render Enriched Data Filtering)

When `strategy` is `'client'`, the filter widget provides a `filterFn` instead of a `queryParam`. DataTable applies this function after rendering enriched rows — filtering happens on the already-fetched page. Pagination is unaffected. Suitable only for small refinements on enriched data within a single page.

```typescript
filters: [
  {
    id: 'loyaltyTier',
    label: 'loyalty.filter.tier',
    type: 'select',
    options: [
      { value: 'bronze', label: 'loyalty.tier.bronze' },
      { value: 'silver', label: 'loyalty.tier.silver' },
      { value: 'gold', label: 'loyalty.tier.gold' },
    ],
    strategy: 'client',
    filterFn: (row, value) => {
      return row._loyalty?.tier === value
    },
  },
]
```

### 6. DataTable Integration

DataTable merges injected extensions with its own columns, actions, and filters — respecting `InjectionPlacement` for ordering.

---

## Example Module Additions

### `example/widgets/injection/customer-todo-count-column/widget.ts`

Injects a "Todos" column into the customers people DataTable:

```typescript
// packages/core/src/modules/example/widgets/injection/customer-todo-count-column/widget.ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'

export default {
  metadata: {
    id: 'example.injection.customer-todo-count-column',
    title: 'Todo Count',
    features: ['example.view'],
  },
  columns: [
    {
      id: 'todoCount',
      header: 'example.column.todoCount',
      accessorKey: '_example.todoCount',
      cell: ({ getValue }) => {
        const count = getValue() as number
        return count > 0 ? `${count}` : '—'
      },
      size: 80,
      sortable: false,
      placement: { position: InjectionPosition.After, relativeTo: 'email' },
    },
  ],
} satisfies InjectionColumnWidget
```

### `example/widgets/injection/customer-todo-actions/widget.ts`

Injects a "View Todos" row action:

```typescript
// packages/core/src/modules/example/widgets/injection/customer-todo-actions/widget.ts
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'

export default {
  metadata: {
    id: 'example.injection.customer-todo-actions',
    features: ['example.view'],
  },
  rowActions: [
    {
      id: 'view-customer-todos',
      label: 'example.action.viewTodos',
      icon: 'CheckSquare',
      onSelect: (row, context) => {
        window.location.href = `/backend/example/todos?assignedTo=${row.id}`
      },
      placement: { position: InjectionPosition.After, relativeTo: 'edit' },
    },
  ],
} satisfies InjectionRowActionWidget
```

### `example/widgets/injection-table.ts` update

```typescript
// Add to existing injection-table.ts
'data-table:customers.people:columns': {
  widgetId: 'example.injection.customer-todo-count-column',
  priority: 50,
},
'data-table:customers.people:row-actions': {
  widgetId: 'example.injection.customer-todo-actions',
  priority: 50,
},
```

---

## Integration Tests

### TC-UMES-D01: Injected "Todos" column appears in customers DataTable at correct position

**Type**: UI (Playwright)

**Steps**:
1. Log in as admin
2. Navigate to `/backend/customers/people`
3. Wait for the DataTable to render
4. Inspect table headers

**Expected**: A "Todos" column header appears after the "Email" column

**Testing notes**:
- Locate table headers: `page.locator('thead th')`
- Find "Email" column index, verify "Todos" is at index+1
- The column header text comes from i18n key `example.column.todoCount`

### TC-UMES-D02: Injected column cell renders enriched data (`_example.todoCount`)

**Type**: UI (Playwright)

**Preconditions**: At least one customer exists with assigned todos

**Steps**:
1. Create a customer via API
2. Create 3 todos assigned to that customer
3. Navigate to `/backend/customers/people`
4. Find the customer row
5. Check the "Todos" column cell value

**Expected**: Cell shows "3" (the todo count from the enricher)

**Testing notes**:
- Create fixtures in beforeEach, clean up in afterEach
- Find the row by customer name, then check the Todos cell
- For customer with 0 todos, cell should show "—"

### TC-UMES-D03: Injected "View Todos" row action appears in row action dropdown

**Type**: UI (Playwright)

**Steps**:
1. Navigate to `/backend/customers/people`
2. Click the row actions button (three dots) on any customer row
3. Inspect the dropdown menu

**Expected**: "View Todos" action appears in the dropdown after "Edit"

**Testing notes**:
- `page.locator('[data-testid="row-actions-trigger"]').first().click()`
- `page.locator('[role="menuitem"]').filter({ hasText: 'View Todos' })`

### TC-UMES-D04: Injected row action click navigates to correct URL

**Type**: UI (Playwright)

**Steps**:
1. Navigate to customers list
2. Click row actions on a specific customer
3. Click "View Todos"

**Expected**: Browser navigates to `/backend/example/todos?assignedTo=<customerId>`

**Testing notes**:
- `await page.waitForURL('**/backend/example/todos**')`
- Verify the `assignedTo` query parameter matches the customer ID

### TC-UMES-D05: Injected column respects ACL features

**Type**: UI (Playwright)

**Steps**:
1. Log in as user WITHOUT `example.view` feature
2. Navigate to `/backend/customers/people`
3. Inspect table headers

**Expected**: "Todos" column is NOT visible when user lacks `example.view`

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/core/src/modules/example/widgets/injection/customer-todo-count-column/widget.ts` |
| **NEW** | `packages/core/src/modules/example/widgets/injection/customer-todo-actions/widget.ts` |
| **MODIFY** | `packages/ui/src/backend/DataTable.tsx` (merge injected columns, actions) |
| **MODIFY** | `packages/ui/src/backend/RowActions.tsx` (merge injected row actions) |
| **MODIFY** | `packages/ui/src/backend/FilterBar.tsx` or `FilterOverlay.tsx` (merge injected filters) |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection-table.ts` |

**Estimated scope**: Large — DataTable is a complex component

---

## Backward Compatibility

- Existing DataTable props unchanged — injected extensions are merged at render time
- Existing columns, row actions, filters preserved in their original order
- Injected items only appear when widgets are registered and user has required features
- No changes to DataTable's external API (props interface)

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase F — DataTable Extensibility | In Progress | 2026-02-26 | Injected columns, row actions, and server filters are wired into DataTable with auto table replacement handles. |
