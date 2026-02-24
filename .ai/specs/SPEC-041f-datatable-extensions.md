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

### 5. DataTable Filter Injection (Two-Tier Architecture)

**Tier 1 — Server-side** (via API interceptor from Phase E): For filters that need to reduce the dataset before pagination (e.g., filter 10,000 customers by loyalty tier).

**Tier 2 — Client-side**: For filtering on enriched data already present in the response (small datasets, pageSize ≤ 100).

```typescript
filters: [
  {
    id: 'todoCount',
    label: 'example.filter.hasTodos',
    type: 'select',
    options: [
      { value: 'yes', label: 'example.filter.hasTodos.yes' },
      { value: 'no', label: 'example.filter.hasTodos.no' },
    ],
    strategy: 'server',
    queryParam: 'hasTodos',
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
