# SPEC-041i — Detail Page Bindings

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | I (PR 9) |
| **Branch** | `feat/umes-detail-bindings` |
| **Depends On** | Phase D (Enrichers), Phase G (CrudForm Fields — for `InjectedField` component) |
| **Status** | Draft |

## Goal

Bring full UMES extensibility to hand-built detail pages (customer person/company, sales document) that are NOT based on CrudForm — via the `useExtensibleDetail` hook.

---

## The Problem

CrudForm-based pages get UMES features for free. But the most important pages — customer detail and sales document detail — are **hand-built** with manual data loading, `useGuardedMutation`, and conditional rendering. They support tab injection and mutation hooks but NOT field injection, column injection for embedded tables, or component replacement.

---

## Scope

### 1. `useExtensibleDetail` Hook

```typescript
// packages/ui/src/backend/injection/useExtensibleDetail.ts

interface UseExtensibleDetailOptions<TData> {
  entityId: string                    // e.g., 'customers.person'
  data: TData | null
  setData: React.Dispatch<React.SetStateAction<TData | null>>
  injectionContext: Record<string, unknown>
  guardedMutation: ReturnType<typeof useGuardedMutation>
}

interface ExtensibleDetailResult<TData> {
  injectedTabs: InjectedTab[]
  getFieldsForSection(sectionId: string): InjectedField[]
  getColumnsForTable(tableId: string): InjectedColumn[]
  getRowActionsForTable(tableId: string): InjectedRowAction[]
  getComponent<TProps>(componentId: string): React.ComponentType<TProps>
  getEnrichedData<T>(namespace: string): T | undefined
  runSectionSave(
    sectionId: string,
    operation: () => Promise<unknown>,
    sectionData?: Record<string, unknown>,
  ): Promise<void>
}
```

### 2. `runSectionSave` Pattern

Detail pages have multiple save operations (each section saves independently). `runSectionSave` wraps any section's save with the full UMES lifecycle:

```typescript
async function runSectionSave(sectionId, operation, sectionData) {
  // 1. Collect injected field values for this section
  const injectedValues = collectInjectedFieldValues(sectionId)
  // 2. Run widget onBeforeSave (can block)
  const guardResult = await triggerEvent('onBeforeSave', {
    ...sectionData, ...injectedValues,
  }, injectionContext)
  if (!guardResult.ok) {
    throw createCrudFormError(guardResult.message, guardResult.fieldErrors)
  }
  // 3. Execute core save (with scoped headers from widgets)
  await withScopedApiRequestHeaders(guardResult.requestHeaders ?? {}, operation)
  // 4. Run widget onSave (each widget saves its own data)
  await triggerEvent('onSave', {
    ...sectionData, ...injectedValues,
  }, injectionContext)
  // 5. Run widget onAfterSave (cleanup, refresh)
  await triggerEvent('onAfterSave', {
    ...sectionData, ...injectedValues,
  }, injectionContext)
}
```

### 3. Customer Detail — Before/After

**Before** (current code):
```typescript
export default function PersonDetailPage() {
  const [data, setData] = React.useState<PersonOverview | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation({ ... })
  React.useEffect(() => { /* fetch */ }, [id])
  const injectionContext = React.useMemo(() => ({ ... }), [...])
  const { widgets: injectedTabWidgets } = useInjectionWidgets('customers.person.detail:tabs', ...)

  return (
    <Page>
      <DetailFieldsSection>
        {/* Hard-coded fields: firstName, lastName, email */}
      </DetailFieldsSection>
      <InjectionSpot spotId="customers.person.detail:details" ... />
      <DetailTabsLayout tabs={[...builtInTabs, ...injectedTabs]} />
    </Page>
  )
}
```

**After** (with UMES bindings):
```typescript
export default function PersonDetailPage() {
  const [data, setData] = React.useState<PersonOverview | null>(null)
  const guardedMutation = useGuardedMutation({ ... })
  React.useEffect(() => { /* fetch — unchanged */ }, [id])
  const injectionContext = React.useMemo(() => ({ /* unchanged */ }), [...])

  // NEW: single hook binds all UMES features
  const ext = useExtensibleDetail({
    entityId: 'customers.person',
    data, setData, injectionContext, guardedMutation,
  })

  return (
    <Page>
      <DetailFieldsSection>
        {/* Hard-coded fields — unchanged */}
        {/* NEW: Injected fields render after core fields */}
        {ext.getFieldsForSection('details').map(field => (
          <InjectedField key={field.id} field={field} data={data} onSave={ext.runSectionSave} />
        ))}
      </DetailFieldsSection>
      <InjectionSpot spotId="customers.person.detail:details" ... />
      <DetailTabsLayout tabs={[...builtInTabs, ...ext.injectedTabs]}>
        {activeTab === 'deals' && (
          <DealsSection
            columns={[...coreColumns, ...ext.getColumnsForTable('customers.person.deals')]}
            rowActions={[...coreActions, ...ext.getRowActionsForTable('customers.person.deals')]}
          />
        )}
      </DetailTabsLayout>
    </Page>
  )
}
```

### 4. Sales Document Detail — Extension Points

```typescript
const ext = useExtensibleDetail({ entityId: 'sales.document', ... })

// Component replacement: ShipmentDialog
const ShipmentDialog = ext.getComponent<ShipmentDialogProps>('sales.document.shipment-dialog')

// Field injection: document header
const headerFields = ext.getFieldsForSection('document-header')

// Column injection: items table
const itemColumns = ext.getColumnsForTable('sales.document.items')

// Tab injection
const allTabs = [...builtInTabs, ...ext.injectedTabs]

// Section save with widget hooks
await ext.runSectionSave('items', async () => {
  await apiCallOrThrow('/api/sales/documents', { method: 'PUT', body: ... })
})
```

### 5. Detail Page Modification Scope

| Page | Changes |
|------|---------|
| **Customer Person** (`people/[id]/page.tsx`) | Add `useExtensibleDetail` (~15 LOC), `<InjectedField>` in details, injected columns to DealsSection |
| **Customer Company** (`companies/[id]/page.tsx`) | Same pattern as person |
| **Sales Document** (`documents/[id]/page.tsx`) | Add `useExtensibleDetail`, wrap `ShipmentDialog` with `ext.getComponent()`, fields in header, columns in items |

### 6. Migration Path — Non-Breaking

The hook is **opt-in per page**. Migration:
1. Add `const ext = useExtensibleDetail({ ... })` (using existing state and mutation)
2. Render `ext.getFieldsForSection(...)` where field injection desired
3. Pass `ext.getColumnsForTable(...)` to embedded DataTables
4. Wrap replaceable components with `ext.getComponent(...)`

No existing InjectionSpot, injection-table, or widget changes needed.

### 7. Sales Document Detail — Extension Points

```typescript
const ext = useExtensibleDetail({ entityId: 'sales.document', ... })

// 1. COMPONENT REPLACEMENT: Shipment dialog
const ShipmentDialog = ext.getComponent<ShipmentDialogProps>(
  'sales.document.shipment-dialog'
)

// 2. FIELD INJECTION: Document header
const headerFields = ext.getFieldsForSection('document-header')

// 3. COLUMN INJECTION: Items table
const itemColumns = ext.getColumnsForTable('sales.document.items')

// 4. ROW ACTIONS: Items table
const itemRowActions = ext.getRowActionsForTable('sales.document.items')

// 5. TAB INJECTION
const allTabs = [...builtInTabs, ...ext.injectedTabs]

// 6. SECTION SAVE with widget hooks
await ext.runSectionSave('items', async () => {
  await apiCallOrThrow('/api/sales/documents', { method: 'PUT', body: ... })
})
```

### 8. Data Flow: Detail Page With Enrichment + Field Injection + Save

Complete end-to-end example — a loyalty module extending the customer detail page:

```
                                ┌─────────────────────────────────────────┐
                                │     Customer Detail Page (person)       │
                                └───────────────────┬─────────────────────┘
                                                    │
         ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
         │                                          │                                          │
    1. LOAD                                    2. RENDER                                  3. SAVE
         │                                          │                                          │
  GET /api/customers/                    ┌──────────┴──────────┐                     User edits tier
  people/123                             │                     │                     and clicks save
         │                          Core fields           Injected fields                  │
  ┌──────┴──────────┐               firstName             _loyalty.tier ← InjectedField   │
  │ Core query      │               lastName              (from enricher)                  │
  │ returns person  │               email                                             ┌────┴─────────┐
  └──────┬──────────┘               status                                            │ runSection   │
         │                                                                            │ Save()       │
  ┌──────┴──────────┐                                                                 └────┬─────────┘
  │ Enrichers run:  │                                                                      │
  │ loyalty adds    │                                                          ┌───────────┼───────────┐
  │ _loyalty.tier   │                                                          │           │           │
  │ _loyalty.points │                                                     onBeforeSave  Core PUT    onSave
  └──────┬──────────┘                                                     (validate)    (person)    (loyalty)
         │                                                                     │           │           │
  Response arrives:                                                            │    PUT /api/      PUT /api/
  {                                                                            │    customers/     loyalty/
    person: { id, firstName, ... },                                            │    people         memberships/
    _loyalty: { tier: 'gold', points: 1250 },                                 │    {id,name,...}  123/tier
  }                                                                            │           │      {tier:'silver'}
                                                                               │           │           │
                                                                               └───────────┴───────────┘
                                                                                     onAfterSave
                                                                                   (refresh data)
```

### 9. Implementation Scope Per Detail Page

| Page | Current State | Required Changes |
|------|--------------|-----------------|
| **Customer Person** (`people/[id]/page.tsx`) | Has: tabs, detail spots, guarded mutation. Missing: field injection, column injection | Add `useExtensibleDetail` (~15 LOC), `<InjectedField>` in details, injected columns to DealsSection |
| **Customer Company** (`companies/[id]/page.tsx`) | Same pattern as person | Same changes as person |
| **Sales Document** (`documents/[id]/page.tsx`) | Has: tabs, detail spots, guarded mutation. Missing: field injection, column injection, dialog replacement | Add `useExtensibleDetail`, wrap `ShipmentDialog` with `ext.getComponent()`, fields in header, columns in items |
| **Future detail pages** | N/A | Use `useExtensibleDetail` from the start |

---

## Example Module Additions

### `example/widgets/injection/customer-detail-fields/widget.ts`

Read-only "Todo Summary" in customer detail page:

```typescript
// packages/core/src/modules/example/widgets/injection/customer-detail-fields/widget.ts
import type { InjectionFieldWidget } from '@open-mercato/shared/modules/widgets/injection'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

export default {
  metadata: {
    id: 'example.injection.customer-detail-fields',
    title: 'Todo Summary',
    features: ['example.view'],
  },
  fields: [
    {
      id: '_example.todoCount',
      label: 'example.field.todoCount',
      type: 'number',
      group: 'details',
      placement: { position: InjectionPosition.Last },
      readOnly: true,
    },
    {
      id: '_example.latestTodo.title',
      label: 'example.field.latestTodo',
      type: 'text',
      group: 'details',
      placement: { position: InjectionPosition.Last },
      readOnly: true,
    },
  ],
} satisfies InjectionFieldWidget
```

### `example/widgets/injection-table.ts` update

```typescript
'detail:customers.person:fields:details': {
  widgetId: 'example.injection.customer-detail-fields',
  priority: 50,
},
```

---

## Integration Tests

### TC-UMES-DP01: Injected field renders in customer detail page "Details" section

**Type**: UI (Playwright)

**Preconditions**: Customer exists with 3 assigned todos

**Steps**:
1. Create a customer with 3 todos via API
2. Navigate to `/backend/customers/people/:id`
3. Look for "Todo Count" and "Latest Todo" fields in the Details section

**Expected**: Read-only "Todo Count" shows "3" and "Latest Todo" shows the most recent todo's title

**Testing notes**:
- Fields are read-only — verify they cannot be edited
- Data comes from enricher (Phase D)

### TC-UMES-DP02: `runSectionSave` triggers widget `onSave` handlers alongside core save

**Type**: UI+API (Playwright)

**Steps**:
1. Create a customer
2. Set up writable injected field (priority from Phase G)
3. Navigate to customer detail
4. Edit the priority field
5. Save the details section

**Expected**: Core customer data saved via customer API AND priority saved via example API

**Testing notes**:
- Monitor network: verify both API calls
- Verify data persisted by re-loading the page

### TC-UMES-DP03: Enriched data accessible via `ext.getEnrichedData('_example')`

**Type**: UI (Playwright)

**Steps**:
1. Create a customer with todos
2. Navigate to customer detail
3. Verify enriched data renders (todoCount, latestTodo)

**Expected**: Enriched `_example` namespace data correctly displayed

### TC-UMES-DP04: Injected tab renders in customer detail tabs

**Type**: UI (Playwright)

**Steps**:
1. Navigate to customer detail page
2. Look for injected tabs

**Expected**: Injected tab appears in tab bar and renders content when selected

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/ui/src/backend/injection/useExtensibleDetail.ts` |
| **NEW** | `packages/core/src/modules/example/widgets/injection/customer-detail-fields/widget.ts` |
| **MODIFY** | `packages/core/src/modules/customers/backend/customers/people/[id]/page.tsx` |
| **MODIFY** | `packages/core/src/modules/customers/backend/customers/companies/[id]/page.tsx` |
| **MODIFY** | `packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx` |
| **MODIFY** | `packages/core/src/modules/example/widgets/injection-table.ts` |

**Estimated scope**: Medium — detail page modifications are well-scoped

---

## Backward Compatibility

- `useExtensibleDetail` is opt-in — pages not using it are unchanged
- Existing `InjectionSpot` usage in detail pages continues to work
- Existing `useGuardedMutation` behavior unchanged
- All existing injection-table entries continue working
