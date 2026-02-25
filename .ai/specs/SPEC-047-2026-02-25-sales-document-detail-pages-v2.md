# SPEC-047 — Sales Document Detail Pages v2 (CrudForm Rewrite)

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Piotr Karwatka |
| **Created** | 2026-02-25 |
| **Related** | SPEC-041 (UMES), SPEC-046 (Customer Detail v2), SPEC-016 (Form Headers/Footers) |

## TLDR

**Key Points:**
- Rewrite quote and order detail pages from per-field inline editors to CrudForm-based whole-document save
- Two-zone layout: CrudForm (Zone 1) for document header fields + Related Data (Zone 2) for line items, shipments, payments, addresses, notes
- Line items, adjustments, shipments, and payments remain as independent CRUD sections (dialogs) — NOT part of the form save
- Full UMES (SPEC-041) integration with standardized injection slots for DataTable extensions and field injection
- v2 pages coexist with v1 at `/backend/sales/documents-v2/[id]`

**Scope:**
- New pages: `documents-v2/[id]` (unified quote/order detail, differentiated by `?kind=` param)
- New: `SalesDocumentDetailForm.tsx` CrudForm wrapper component
- New: `sales/components/documents/documentFormConfig.ts` for schemas, fields, groups
- Modified: list page row click links, create page redirect, cross-module links
- New: 4 integration test files

**Concerns:**
- Sales documents have complex sub-entity relationships (line items, adjustments, shipments, payments) — these MUST remain as independent CRUD, not part of CrudForm submit
- Currency locking when line items exist requires conditional field disabling
- Document totals are server-computed — displayed read-only, refreshed after save

---

## Overview

The current sales document detail page (`packages/core/src/modules/sales/backend/sales/documents/[id]/page.tsx`, ~4800 lines) uses per-field inline editors for all header fields (customer, status, channel, currency, references, etc.). Each field saves independently on blur. Sub-entities (line items, adjustments, shipments, payments) are managed via dialogs that save to their own API endpoints.

The v2 page converts the **document header fields** to CrudForm while preserving the dialog-based management for sub-entities. This gives:
- Batch save for header fields (customer, status, channel, currency, references, dates, comments)
- CrudForm validation, custom fields, version history, UMES injection
- Sub-entities remain independently managed (they have different lifecycles)

> **Key Distinction**: Unlike customer detail pages where ALL entity fields go into CrudForm, sales documents have a clear split:
> - **CrudForm zone**: Document-level fields (header, settings, references)
> - **Component groups**: Line items table, adjustments table, totals display (read-only within CrudForm but saved independently via dialogs)
> - **Zone 2 tabs**: Notes, addresses, shipments, payments

---

## Problem Statement

### Current State

1. **Per-field inline saves**: Customer, status, channel, currency, dates, references — each field saves independently via dedicated handlers (`handleUpdateCustomer`, `handleUpdateStatus`, `handleUpdateCurrency`, etc.).

2. **No UMES extension surface on document header**: Third-party modules cannot inject fields into the document header (e.g., a warehouse module adding "warehouse assignment" to orders).

3. **Monolithic page file**: The current detail page is ~4800 lines in a single file, mixing header fields, sub-entity dialogs, tab management, and utility functions.

4. **Inconsistent save UX**: Header fields auto-save on blur (no "Save" button), while sub-entities use explicit dialog forms. Users have no single "save" action for header changes.

### Goal

- CrudForm for document header fields → single "Save" action
- Sub-entity sections (items, adjustments, shipments, payments) remain dialog-based
- UMES injection slots on both the CrudForm and the page wrapper
- Modular file structure (form config, CrudForm wrapper, page)
- 100% field coverage — no regression from v1

---

## Proposed Solution

### High-Level Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Page Wrapper                                              │
│  InjectionSpot: detail:sales.{order|quote}:header          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Zone 1: CrudForm                                     │   │
│  │   title: "Order #12345" / "Quote #Q-001"             │   │
│  │   backHref: /backend/sales/orders (or /quotes)       │   │
│  │   versionHistory: { resourceKind, resourceId }       │   │
│  │   injectionSpotId: sales.order (or sales.quote)      │   │
│  │   entityIds: [E.sales.sales_order] (or sales_quote)  │   │
│  │   extraActions: [Convert to Order] [Send to Customer] │   │
│  │                                                       │   │
│  │   contentHeader: <DocumentSummaryCard />              │   │
│  │     - Document number (editable)                      │   │
│  │     - Status badge                                    │   │
│  │     - Entity type label                               │   │
│  │                                                       │   │
│  │   Groups:                                             │   │
│  │   ┌─ col 1 ──────────────┐  ┌─ col 2 ────────────┐  │   │
│  │   │ "customer"            │  │ "references"        │  │   │
│  │   │ customerEntityId      │  │ externalReference   │  │   │
│  │   │ contactEmail          │  │ customerReference   │  │   │
│  │   │ placedAt              │  │ comments            │  │   │
│  │   ├───────────────────────┤  ├─────────────────────┤  │   │
│  │   │ "settings"            │  │ "totals"            │  │   │
│  │   │ channelId             │  │ (component: read-   │  │   │
│  │   │ currencyCode          │  │  only DocumentTotals│  │   │
│  │   │ status                │  │  display)           │  │   │
│  │   │ shippingMethodId      │  ├─────────────────────┤  │   │
│  │   │ paymentMethodId       │  │ "customFields"      │  │   │
│  │   │ expectedDeliveryAt*   │  │ (kind: customFields)│  │   │
│  │   └───────────────────────┘  ├─────────────────────┤  │   │
│  │                               │ "tags"              │  │   │
│  │                               │ (component group)   │  │   │
│  │                               └─────────────────────┘  │   │
│  │   ┌──────────────────────────────────────────────────┐ │   │
│  │   │ "items" (component group, bare, full-width)      │ │   │
│  │   │ Line items DataTable + add/edit/delete dialogs   │ │   │
│  │   └──────────────────────────────────────────────────┘ │   │
│  │   ┌──────────────────────────────────────────────────┐ │   │
│  │   │ "adjustments" (component group, full-width)      │ │   │
│  │   │ Adjustments table + dialog                       │ │   │
│  │   └──────────────────────────────────────────────────┘ │   │
│  │                                                       │   │
│  │   Footer: [Delete] [Cancel] [Save]                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Zone 2: Related Data Tabs (DetailTabsLayout)         │   │
│  │   [Notes] [Addresses] [Shipments*] [Payments*]       │   │
│  │   (* orders only)                                     │   │
│  │   [+ injected tabs]                                   │   │
│  │                                                       │   │
│  │   InjectionSpot: detail:sales.{order|quote}:tabs      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  InjectionSpot: detail:sales.{order|quote}:footer           │
└───────────────────────────────────────────────────────────┘
```

### Page URL Structure

| Page | URL | Query Param |
|------|-----|-------------|
| Quote v2 detail | `/backend/sales/documents-v2/[id]` | `?kind=quote` |
| Order v2 detail | `/backend/sales/documents-v2/[id]` | `?kind=order` |

Single page file handles both quote and order, differentiated by `kind` parameter (same pattern as v1).

### Data Flow

```
1. Page loads → GET /api/sales/{orders|quotes}/{id}
2. API returns document with all fields, line items, adjustments, etc.
3. Page maps document header fields → CrudForm initialValues
4. User edits header fields in CrudForm
5. User clicks Save → onSubmit(values)
6. onSubmit calls PUT /api/sales/{orders|quotes} with header fields only
7. On success: flash message, reload data (totals recalculated server-side)
8. Line items: managed via ItemsSection dialogs → POST/PUT/DELETE /api/sales/{order|quote}-lines
9. Adjustments: managed via AdjustmentsSection dialogs → own API
10. Shipments/Payments: managed via Zone 2 tabs → own APIs
```

---

## Quote/Order v2 — Complete Field Specification

### CrudForm Configuration

```typescript
<CrudForm<SalesDocumentFormValues>
  title={`${kindLabel} #${documentNumber}`}
  backHref={kind === 'order' ? '/backend/sales/orders' : '/backend/sales/quotes'}
  versionHistory={{
    resourceKind: kind === 'order' ? 'sales.order' : 'sales.quote',
    resourceId: documentId,
    canUndoRedo: true,
  }}
  injectionSpotId={kind === 'order' ? 'sales.order' : 'sales.quote'}
  entityIds={[kind === 'order' ? E.sales.sales_order : E.sales.sales_quote]}
  schema={salesDocumentSchema}
  fields={salesDocumentFields}
  groups={salesDocumentGroups}
  initialValues={mappedInitialValues}
  contentHeader={<DocumentSummaryCard record={data} kind={kind} />}
  extraActions={extraActions}
  onSubmit={handleSubmit}
  onDelete={handleDelete}
/>
```

### Schema (Zod)

```typescript
export const createSalesDocumentSchema = (kind: 'order' | 'quote') =>
  z.object({
    id: z.string().uuid(),
    documentNumber: z.string().trim().min(1),
    customerEntityId: z.string().uuid().optional().or(z.literal('')).transform(emptyToUndefined),
    contactEmail: z.string().email().optional().or(z.literal('')).transform(emptyToUndefined),
    placedAt: z.string().optional().or(z.literal('')).transform(emptyToUndefined),
    channelId: z.string().uuid().optional().or(z.literal('')).transform(emptyToUndefined),
    currencyCode: z.string().trim().min(1).optional(),
    status: z.string().optional(),
    statusEntryId: z.string().uuid().optional().or(z.literal('')).transform(emptyToUndefined),
    shippingMethodId: z.string().uuid().optional().or(z.literal('')).transform(emptyToUndefined),
    paymentMethodId: z.string().uuid().optional().or(z.literal('')).transform(emptyToUndefined),
    externalReference: z.string().optional().or(z.literal('')).transform(emptyToUndefined),
    customerReference: z.string().optional().or(z.literal('')).transform(emptyToUndefined),
    comments: z.string().optional().or(z.literal('')).transform(emptyToUndefined),
    // Order-only fields (validated conditionally)
    ...(kind === 'order' ? {
      expectedDeliveryAt: z.string().optional().or(z.literal('')).transform(emptyToUndefined),
    } : {}),
  }).passthrough()
```

### Fields — Group "customer" (column 1)

| Field ID | Type | Required | Layout | Component | Notes |
|----------|------|----------|--------|-----------|-------|
| `customerEntityId` | custom | no | full | `CustomerLookupField` | Searchable customer select, auto-fetches email, stores snapshot |
| `contactEmail` | text | no | half | Standard email input | Auto-populated from customer, editable |
| `placedAt` | datepicker | no | half | DatePicker | Document date |

**CustomerLookupField**: Custom component that:
- Searches customers via `/api/customers/people?search=...` and `/api/customers/companies?search=...`
- On selection: sets `customerEntityId`, auto-fills `contactEmail` from primary email
- Stores customer snapshot as hidden form value for the API

### Fields — Group "settings" (column 1)

| Field ID | Type | Required | Layout | Component | Notes |
|----------|------|----------|--------|-----------|-------|
| `channelId` | custom | no | half | `ChannelSelectField` | Loads channels from API |
| `currencyCode` | custom | no | half | `CurrencySelectField` | Locked (disabled) when line items exist |
| `status` | custom | no | half | `StatusDictionaryField` | Sales status dictionary entries |
| `shippingMethodId` | custom | no | half | `ShippingMethodSelectField` | Loads shipping methods, stores snapshot |
| `paymentMethodId` | custom | no | half | `PaymentMethodSelectField` | Loads payment methods, stores snapshot |
| `expectedDeliveryAt` | datepicker | no | half | DatePicker | **Orders only** — hidden for quotes |

**Currency lock logic**: When the document has line items (`lineItemCount > 0`), the `currencyCode` field is rendered as disabled with a lock icon and tooltip explaining why it cannot be changed.

### Fields — Group "references" (column 2)

| Field ID | Type | Required | Layout | Component |
|----------|------|----------|--------|-----------|
| `externalReference` | text | no | full | Standard text input |
| `customerReference` | text | no | full | Standard text input |
| `comments` | textarea | no | full | Textarea |

### Group "items" (full-width, component group, bare)

This group renders the **line items DataTable** as a CrudForm component group. The items are NOT part of the CrudForm submit — they are managed independently via dialogs.

```typescript
{
  id: 'items',
  title: t('sales.documents.detail.items.title'),
  bare: true,
  component: ({ values }) => (
    <ItemsSection
      documentId={values.id as string}
      kind={kind}
      currencyCode={values.currencyCode as string}
      onItemsChanged={handleRefreshData}
    />
  ),
}
```

**ItemsSection** reuses the existing component with:
- DataTable with line items
- Add line item dialog (catalog product or custom line)
- Edit line item dialog
- Delete line item with confirmation
- Each operation calls `/api/sales/{order|quote}-lines` directly

**UMES DataTable slots**:
- `data-table:sales.${kind}.items:columns` — inject columns
- `data-table:sales.${kind}.items:row-actions` — inject row actions
- `data-table:sales.${kind}.items:bulk-actions` — inject bulk actions
- `data-table:sales.${kind}.items:filters` — inject filters

### Group "adjustments" (full-width, component group)

```typescript
{
  id: 'adjustments',
  title: t('sales.documents.detail.adjustments.title'),
  component: ({ values }) => (
    <AdjustmentsSection
      documentId={values.id as string}
      kind={kind}
      currencyCode={values.currencyCode as string}
      onAdjustmentsChanged={handleRefreshData}
    />
  ),
}
```

Reuses existing `AdjustmentsSection` with add/edit/delete dialogs.

### Group "totals" (column 2, component group)

```typescript
{
  id: 'totals',
  title: t('sales.documents.detail.totals.title'),
  column: 2,
  component: () => (
    <DocumentTotals record={data} kind={kind} />
  ),
}
```

**Read-only display** — totals are server-computed. After CrudForm save, the page reloads data to show updated totals.

### Group "customFields" (column 2, kind: 'customFields')

- Entity ID: `[E.sales.sales_order]` for orders, `[E.sales.sales_quote]` for quotes
- Auto-loaded from custom field definitions
- Saved via `collectCustomFieldValues()` in onSubmit

### Group "tags" (column 2, component group)

Tags managed independently via tag API.

### contentHeader: DocumentSummaryCard

Read-only summary showing:
- Document number with edit icon (maps to `documentNumber` field in form)
- Status badge with color/icon from dictionary
- Entity type label ("Sales Order" / "Sales Quote")
- For orders: fulfillment status, payment status badges

### Extra Actions

| Action | Condition | Behavior |
|--------|-----------|----------|
| Convert to Order | Quote only | Calls conversion API, redirects to new order v2 page |
| Send to Customer | Quote + contactEmail exists | Opens send dialog |

---

## Related Data Tabs (Zone 2)

### Tabs for Both Quote and Order

| Tab ID | Component | Notes |
|--------|-----------|-------|
| `notes` | `NotesSection` (sales variant) | Uses `/api/sales/notes` with contextType/contextId |
| `addresses` | `SalesAddressesSection` | Billing + shipping addresses with snapshot storage |

### Tabs for Orders Only

| Tab ID | Component | Notes |
|--------|-----------|-------|
| `shipments` | `ShipmentsSection` | Add/view/edit shipments with tracking |
| `payments` | `PaymentsSection` | Record payments, view paid/outstanding |

### Injected Tabs

Via `useInjectionWidgets('detail:sales.order:tabs')` or `detail:sales.quote:tabs`.

---

## Mapping API Response → Initial Values

```typescript
function mapSalesDocumentToFormValues(
  record: SalesDocument,
  kind: 'order' | 'quote',
): Partial<SalesDocumentFormValues> {
  return {
    id: record.id,
    documentNumber: kind === 'order' ? record.orderNumber : record.quoteNumber,
    customerEntityId: record.customerEntityId ?? '',
    contactEmail: record.contactEmail ?? '',
    placedAt: record.placedAt ?? record.createdAt ?? '',
    channelId: record.channelId ?? '',
    currencyCode: record.currencyCode ?? '',
    status: record.status ?? '',
    statusEntryId: record.statusEntryId ?? '',
    shippingMethodId: record.shippingMethodId ?? '',
    paymentMethodId: record.paymentMethodId ?? '',
    externalReference: record.externalReference ?? '',
    customerReference: record.customerReference ?? '',
    comments: record.comments ?? '',
    // Order-only
    ...(kind === 'order' ? {
      expectedDeliveryAt: record.expectedDeliveryAt ?? '',
    } : {}),
    // Hidden snapshot fields (populated on customer/method change)
    _customerSnapshot: record.customerSnapshot,
    _shippingMethodSnapshot: record.shippingMethodSnapshot,
    _paymentMethodSnapshot: record.paymentMethodSnapshot,
    // Custom fields
    ...(record.customFields ?? {}),
  }
}
```

### Payload Builder

```typescript
function buildSalesDocumentPayload(
  values: SalesDocumentFormValues,
  kind: 'order' | 'quote',
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: values.id,
  }

  // Map documentNumber to the correct API field
  if (kind === 'order') payload.orderNumber = values.documentNumber
  else payload.quoteNumber = values.documentNumber

  // Assign optional fields
  const optionals = [
    'customerEntityId', 'contactEmail', 'placedAt',
    'channelId', 'currencyCode', 'status', 'statusEntryId',
    'shippingMethodId', 'paymentMethodId',
    'externalReference', 'customerReference', 'comments',
  ]
  for (const key of optionals) {
    const val = values[key]
    if (typeof val === 'string' && val.trim().length) {
      payload[key] = val.trim()
    }
  }

  // Order-only fields
  if (kind === 'order' && values.expectedDeliveryAt) {
    payload.expectedDeliveryAt = values.expectedDeliveryAt
  }

  // Snapshots (hidden fields, passed through)
  if (values._customerSnapshot) payload.customerSnapshot = values._customerSnapshot
  if (values._shippingMethodSnapshot) payload.shippingMethodSnapshot = values._shippingMethodSnapshot
  if (values._paymentMethodSnapshot) payload.paymentMethodSnapshot = values._paymentMethodSnapshot

  // Custom fields
  const customFields = collectCustomFieldValues(values, {
    transform: normalizeCustomFieldSubmitValue,
  })
  if (Object.keys(customFields).length) {
    payload.customFields = customFields
  }

  return payload
}
```

---

## UMES Integration

### Injection Spot IDs

| Spot | Location | Purpose |
|------|----------|---------|
| `crud-form:sales.order:*` | CrudForm (auto) | Field injection, before/after fields, header/footer/sidebar |
| `crud-form:sales.quote:*` | CrudForm (auto) | Same |
| `detail:sales.order:header` | Page wrapper | Above CrudForm |
| `detail:sales.order:tabs` | Zone 2 tabs | Tab injection |
| `detail:sales.order:footer` | Page wrapper | Below all content |
| `detail:sales.order:status-badges` | Summary card | Status badges |
| `detail:sales.quote:header` | Page wrapper | Above CrudForm |
| `detail:sales.quote:tabs` | Zone 2 tabs | Tab injection |
| `detail:sales.quote:footer` | Page wrapper | Below all content |
| `detail:sales.quote:status-badges` | Summary card | Status badges |
| `data-table:sales.order.items:*` | Items DataTable | Column/action/filter injection |
| `data-table:sales.quote.items:*` | Items DataTable | Same |

### Phase G — Field Injection Example

A warehouse module injects "Warehouse Assignment" into the order settings group:

```
1. LOAD:   ResponseEnricher adds _warehouse.assignedId to GET /api/sales/orders/:id
2. RENDER: InjectionFieldWidget { id: '_warehouse.assignedId', group: 'settings', type: 'select' }
3. SAVE:   Widget onSave calls PUT /api/warehouse/assignments/:orderId
```

### Phase F — DataTable Extensions

The line items DataTable supports column injection via UMES Phase F. Example: a "Warehouse Stock" column injected by a warehouse module showing available stock per line item.

---

## Files to Create

| File (relative to `packages/core/src/modules/sales/`) | Purpose |
|-------------------------------------------------------|---------|
| `backend/sales/documents-v2/[id]/page.tsx` | Unified quote/order v2 detail page |
| `backend/sales/documents-v2/[id]/page.meta.ts` | `{ navHidden: true, requireAuth: true, requireFeatures: ['sales.view'] }` |
| `components/documents/SalesDocumentDetailForm.tsx` | CrudForm wrapper with form logic |
| `components/documents/documentFormConfig.ts` | Schema, fields, groups, payload builder, mapper |
| `components/documents/DocumentSummaryCard.tsx` | contentHeader component |

## Files to Modify

| File | Change |
|------|--------|
| `backend/sales/orders/page.tsx` | Row click → `/backend/sales/documents-v2/${id}?kind=order` |
| `backend/sales/quotes/page.tsx` | Row click → `/backend/sales/documents-v2/${id}?kind=quote` |
| `components/documents/SalesDocumentsTable.tsx` | Row href → v2 path |
| `backend/sales/documents/create/page.tsx` | After create redirect → v2 path |

## Files NOT Modified (Backward Compatible)

| File | Reason |
|------|--------|
| All API routes (`api/orders/`, `api/quotes/`, etc.) | API unchanged |
| `backend/sales/documents/[id]/page.tsx` | v1 page remains accessible |
| Line item dialog/section components | Reused as-is in component groups |
| Adjustment dialog/section components | Reused as-is |
| Shipment/Payment dialog/section components | Reused as-is in Zone 2 tabs |

---

## Integration Tests

### TC-SALES-V2-001: Quote v2 — CRUD Header Fields

```
Setup: createSalesQuoteFixture via API
Navigate: /backend/sales/documents-v2/{id}?kind=quote

Verify initial values:
  - Document number matches
  - Customer shows correct name
  - Currency, channel, status display correctly

Edit fields:
  - Change contactEmail
  - Change externalReference
  - Add comments
  - Change shipping method

Click Save:
  - Verify success flash
  - Reload page
  - Verify all changes persisted

Delete:
  - Click delete
  - Confirm dialog
  - Verify redirect to quotes list

Cleanup: deleteSalesEntityIfExists
```

### TC-SALES-V2-002: Order v2 — Header Fields + Line Items

```
Setup: createSalesOrderFixture via API, add line item via API
Navigate: /backend/sales/documents-v2/{id}?kind=order

Verify header fields render with initial values
Verify line items table shows existing item

Edit header fields:
  - Change expectedDeliveryAt
  - Change customerReference

Verify currency field is locked (line items exist)

Add a custom line item via dialog:
  - Click "Add item"
  - Fill name, quantity, unit price
  - Save dialog
  - Verify item appears in table
  - Verify totals updated

Click Save (header):
  - Verify success flash
  - Verify header changes persisted
  - Verify line items unaffected

Delete line item:
  - Click delete on line item row
  - Confirm
  - Verify item removed
  - Verify totals updated

Cleanup: deleteSalesEntityIfExists
```

### TC-SALES-V2-003: Order v2 — Shipments & Payments Tabs

```
Setup: createSalesOrderFixture + line item via API
Navigate: /backend/sales/documents-v2/{id}?kind=order

Shipments tab:
  - Click Shipments tab
  - Add shipment via dialog
  - Fill shipment number, method, items
  - Save
  - Verify shipment appears in table

Payments tab:
  - Click Payments tab
  - Add payment via dialog
  - Fill amount, reference
  - Save
  - Verify payment appears in table
  - Verify outstanding amount updated

Verify header CrudForm is NOT affected by tab operations

Cleanup: deleteSalesEntityIfExists
```

### TC-SALES-V2-004: Quote v2 — Convert to Order

```
Setup: createSalesQuoteFixture + line items via API
Navigate: /backend/sales/documents-v2/{id}?kind=quote

Click "Convert to Order" button (extraActions)
  - Verify confirmation dialog
  - Confirm

Verify redirect to new order v2 page
Verify order has:
  - Same customer
  - Same currency
  - Same line items

Cleanup: delete created order and original quote
```

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|------------|
| Users lose per-field auto-save for header fields | Medium | Clear Save button, unsaved changes warning |
| Line items table render inside CrudForm group may have scroll/layout issues | Medium | Use `bare: true` group, test responsive layout |
| Currency lock not reflected after inline line item add | Medium | ItemsSection `onItemsChanged` callback triggers CrudForm field disabled state update |
| Totals display stale after line item changes | Medium | `onItemsChanged` reloads data; totals component receives fresh data |
| Quote-to-order conversion with unsaved CrudForm changes | High | Disable "Convert" button when form is dirty; prompt to save first |
| Snapshot fields (customer, shipping method) not synchronized | Medium | On field change, fetch snapshot immediately and store in hidden form values |

---

## Final Compliance Report

- [ ] All header fields from v1 page present in v2 CrudForm
- [ ] Line items section renders and operates independently within CrudForm group
- [ ] Adjustments section renders and operates independently
- [ ] Shipments/Payments tabs (orders only) render in Zone 2
- [ ] Currency lock works when line items exist
- [ ] Totals refresh after line item/adjustment changes
- [ ] Quote-to-order conversion works from v2 page
- [ ] UMES injection spots follow SPEC-041 naming convention
- [ ] DataTable extension slots declared for line items table
- [ ] Integration tests cover header CRUD, line items, shipments, payments, conversion
- [ ] API endpoints unchanged (backward compatible)
- [ ] No new database migrations required

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-25 | Initial draft |
