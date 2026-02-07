# SPEC-020: Related Entity Version History

**Date:** 2026-02-07
**Status:** Draft
**Module:** `audit_logs` (backend + frontend), `shared` (command bus)
**Related:** [SPEC-017 (Version History Panel)](SPEC-017-2026-02-03-version-history-panel.md)

---

## Overview

Extend the Version History panel to show changes made to **related (child) entities** alongside changes to the parent entity. Currently, when a user views the history of a sales order, they only see changes to the order record itself. Changes to addresses, line items, payments, shipments, notes, and other child entities are logged separately under their own `resourceKind` and are invisible in the parent's history panel.

This spec introduces a **`parentResourceKind` + `parentResourceId`** mechanism in the command audit log system, and extends the API and UI to aggregate related entity changes into a unified timeline.

---

## Problem Statement

### Current Behavior

Each command logs its audit trail with its own `resourceKind` and `resourceId`:

| Action | resourceKind | resourceId | Visible in order history? |
|--------|-------------|------------|--------------------------|
| Create order | `sales.order` | `order-uuid` | Yes |
| Update order status | `sales.order` | `order-uuid` | Yes |
| Add address to order | *(no audit log)* | - | No (not even logged) |
| Edit address on order | *(no audit log)* | - | No (not even logged) |
| Add line item | *(embedded in document command)* | - | Depends on implementation |
| Add payment | `sales.payment` | `payment-uuid` | No |
| Add shipment | `sales.shipment` | `shipment-uuid` | No |
| Add note | `sales.note` | `note-uuid` | No |

The same pattern affects:
- **Customers**: addresses, activities, comments, deals, todos edited from person/company detail page
- **Staff**: addresses, activities, comments, job histories, leave requests, tag assignments edited from team member detail page
- **Resources**: activities, comments, tag assignments edited from resource detail page
- **Catalog**: variants and prices edited from product detail page (though variants have their own detail page)

### User Expectation

When a user opens the Version History panel on a sales order detail page, they expect to see **all** changes related to that order, including:
- Order field changes (status, customer, dates, etc.)
- Address additions, edits, deletions
- Payment additions, edits, deletions
- Shipment additions, edits, deletions
- Note additions, edits, deletions
- Line item additions, edits, deletions (if logged)

The same applies to customer detail pages (person/company), staff team member pages, and resource pages.

---

## Proposed Solution

### Approach: Add `parentResourceKind` + `parentResourceId` to ActionLog

Add two new nullable columns to the `action_logs` table that optionally reference the **parent entity** a child change belongs to. When a command modifies a child entity (e.g., editing an address on an order), the command's `buildLog()` sets these fields to point at the parent.

The Version History API is then extended to support querying by either:
- `resourceKind + resourceId` (current behavior, exact match)
- `parentResourceKind + parentResourceId` (new: fetch child entity changes)
- Both combined via `includeRelated=true` (recommended: fetches parent + all children)

### Why This Approach

| Approach | Pros | Cons |
|----------|------|------|
| **A. Parent fields on ActionLog** (chosen) | Simple schema change, backward compatible, opt-in per command, efficient indexed query | Requires updating all child commands to set parent fields |
| B. Separate relationship table | More flexible (N:N), no schema migration on action_logs | Extra join, more complexity, over-engineered for 1:1 parent relationship |
| C. Derive parent from snapshot data | Zero schema changes | Fragile (snapshot structure varies), slow (needs JSON queries), no index support |
| D. UI-side multi-query merge | Zero backend changes | Multiple API calls, client-side merge complexity, pagination issues, poor UX |

**Approach A** is chosen for its simplicity, queryability, and backward compatibility.

---

## Architecture

### Data Model Changes

#### ActionLog Entity Extension

```
action_logs
├── ... (existing columns)
├── parent_resource_kind  TEXT  NULLABLE   -- NEW
├── parent_resource_id    TEXT  NULLABLE   -- NEW
└── ...
```

**New index:**
```sql
CREATE INDEX action_logs_parent_resource_idx
ON action_logs (tenant_id, parent_resource_kind, parent_resource_id, created_at)
WHERE parent_resource_kind IS NOT NULL;
```

### Command Bus Flow (Extended)

```
Command.buildLog() returns:
  {
    resourceKind: 'sales.payment',      // What was changed (child)
    resourceId: 'payment-uuid',          // Child entity ID
    parentResourceKind: 'sales.order',   // NEW: Parent entity type
    parentResourceId: 'order-uuid',      // NEW: Parent entity ID
    ...
  }

→ ActionLogService.log() persists all fields including parent_*
```

### API Query Flow (Extended)

```
GET /api/audit_logs/audit-logs/actions
  ?resourceKind=sales.order
  &resourceId={order-uuid}
  &includeRelated=true              ← NEW parameter

→ ActionLogService.list() builds WHERE:
  (resource_kind = 'sales.order' AND resource_id = '{order-uuid}')
  OR
  (parent_resource_kind = 'sales.order' AND parent_resource_id = '{order-uuid}')

→ Returns unified timeline sorted by created_at DESC
```

### UI Rendering (Extended)

```
VersionHistoryPanel
  └─ Entry: "Updated order" (resourceKind: sales.order)
  └─ Entry: "Added billing address" (resourceKind: sales.documentAddress)  ← NEW: child
  └─ Entry: "Created payment" (resourceKind: sales.payment)               ← NEW: child
  └─ Entry: "Added note" (resourceKind: sales.note)                       ← NEW: child
  └─ Entry: "Created order" (resourceKind: sales.order)
```

Child entries are visually distinguished with an indented style and a small label showing the related entity type.

---

## Implementation Details

### Phase 1: Data Model & Infrastructure

#### 1.1 ActionLog Entity

**File:** `packages/core/src/modules/audit_logs/data/entities.ts`

```typescript
@Property({ name: 'parent_resource_kind', type: 'text', nullable: true })
parentResourceKind: string | null = null

@Property({ name: 'parent_resource_id', type: 'text', nullable: true })
parentResourceId: string | null = null
```

Add partial index:
```typescript
@Index({
  name: 'action_logs_parent_resource_idx',
  properties: ['tenantId', 'parentResourceKind', 'parentResourceId', 'createdAt'],
  where: 'parent_resource_kind IS NOT NULL',
})
```

Run `npm run db:generate` to auto-create migration.

#### 1.2 CommandLogMetadata Type

**File:** `packages/shared/src/lib/commands/types.ts`

Add to `CommandLogMetadata`:
```typescript
parentResourceKind?: string | null
parentResourceId?: string | null
```

#### 1.3 ActionLogService

**File:** `packages/core/src/modules/audit_logs/services/actionLogService.ts`

Update `log()` to persist new fields.

Update `list()` to support the `includeRelated` parameter:
```typescript
if (parsed.includeRelated && parsed.resourceKind && parsed.resourceId) {
  where.$or = [
    { resourceKind: parsed.resourceKind, resourceId: parsed.resourceId },
    { parentResourceKind: parsed.resourceKind, parentResourceId: parsed.resourceId },
  ]
} else {
  if (parsed.resourceKind) where.resourceKind = parsed.resourceKind
  if (parsed.resourceId) where.resourceId = parsed.resourceId
}
```

#### 1.4 Validators

**File:** `packages/core/src/modules/audit_logs/data/validators.ts`

Add to create schema:
```typescript
parentResourceKind: z.string().optional().nullable(),
parentResourceId: z.string().optional().nullable(),
```

Add to list schema:
```typescript
includeRelated: z.boolean().optional(),
```

#### 1.5 API Route

**File:** `packages/core/src/modules/audit_logs/api/audit-logs/actions/route.ts`

Add `includeRelated` query parameter (defaults to `false` for backward compatibility).

Parse and pass to service:
```typescript
const includeRelated = parseBooleanToken(url.searchParams.get('includeRelated') ?? 'false')
```

#### 1.6 Command Bus Integration

**File:** `packages/shared/src/lib/commands/command-bus.ts`

In `persistLog()`, forward `parentResourceKind` and `parentResourceId` from the log metadata to `ActionLogService.log()`.

### Phase 2: UI Changes

#### 2.1 VersionHistoryConfig Type

**File:** `packages/ui/src/backend/version-history/types.ts`

```typescript
export type VersionHistoryConfig = {
  resourceKind: string
  resourceId: string
  resourceIdFallback?: string
  organizationId?: string
  includeRelated?: boolean  // NEW: default true
}
```

#### 2.2 VersionHistoryEntry Type

**File:** `packages/ui/src/backend/version-history/types.ts`

Add:
```typescript
export type VersionHistoryEntry = {
  // ... existing fields
  parentResourceKind?: string | null   // NEW
  parentResourceId?: string | null     // NEW
}
```

#### 2.3 useVersionHistory Hook

**File:** `packages/ui/src/backend/version-history/useVersionHistory.ts`

Pass `includeRelated` to the API:
```typescript
if (config.includeRelated !== false) {
  params.set('includeRelated', 'true')
}
```

Default is `true` — the version history panel shows related entities by default.

#### 2.4 VersionHistoryPanel UI

**File:** `packages/ui/src/backend/version-history/VersionHistoryPanel.tsx`

For entries where `parentResourceKind` is non-null (meaning they are child entity changes), render them with:
- A subtle left border or indent to visually distinguish them from parent changes
- A small badge/label showing the child entity type (e.g., "Address", "Payment", "Note")
- The `actionLabel` already describes the action (e.g., "Created billing address")

Example rendering logic:
```tsx
const isRelatedEntry = entry.parentResourceKind != null

// In the entry row:
<div className={cn(
  'px-4 py-3 cursor-pointer hover:bg-muted/50 border-b',
  isRelatedEntry && 'pl-8 border-l-2 border-l-muted-foreground/20'
)}>
  {isRelatedEntry && (
    <span className="text-xs text-muted-foreground font-medium">
      {humanizeResourceKind(entry.resourceKind)}
    </span>
  )}
  <div className="text-sm">{entry.actionLabel}</div>
  ...
</div>
```

A helper `humanizeResourceKind(kind: string)` maps `resourceKind` values to human-friendly labels:
```typescript
function humanizeResourceKind(kind: string | null): string {
  if (!kind) return ''
  const map: Record<string, string> = {
    'sales.documentAddress': 'Address',
    'sales.payment': 'Payment',
    'sales.shipment': 'Shipment',
    'sales.note': 'Note',
    'sales.orderLine': 'Line Item',
    'sales.quoteLine': 'Line Item',
    'customers.address': 'Address',
    'customers.activity': 'Activity',
    'customers.comment': 'Comment',
    'customers.todoLink': 'Todo',
    'staff.team_member_address': 'Address',
    'staff.team_member_activity': 'Activity',
    'staff.team_member_comment': 'Comment',
    'staff.team_member_job_history': 'Job History',
    'staff.leave_request': 'Leave Request',
    'resources.resource_activity': 'Activity',
    'resources.resource_comment': 'Comment',
    'catalog.variant': 'Variant',
    'catalog.price': 'Price',
  }
  // Fallback: humanize the part after the dot
  return map[kind] ?? kind.split('.').pop()?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? kind
}
```

#### 2.5 Optional Toggle

Add an optional filter toggle to the panel header to show/hide related entity changes. This lets users focus on just the parent entity changes when needed:

```tsx
<div className="flex items-center gap-2 px-4 py-2 border-b">
  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
    <input
      type="checkbox"
      checked={showRelated}
      onChange={(e) => setShowRelated(e.target.checked)}
      className="h-3.5 w-3.5"
    />
    {t('audit_logs.version_history.show_related')}
  </label>
</div>
```

### Phase 3: Command Updates

This is the largest phase — updating all child entity commands to set `parentResourceKind` and `parentResourceId` in their `buildLog()` handlers.

#### 3.1 Sales Module Commands

| Command File | resourceKind | parentResourceKind | parentResourceId Source |
|-------------|-------------|-------------------|----------------------|
| `documentAddresses.ts` | `sales.documentAddress` (NEW - currently no buildLog) | `sales.order` or `sales.quote` | `address.document.id` (the owning document) |
| `notes.ts` | `sales.note` | `sales.order` / `sales.quote` / `sales.invoice` / `sales.credit_memo` | `note.contextId` (polymorphic parent) |
| `payments.ts` | `sales.payment` | `sales.order` | `payment.order.id` |
| `shipments.ts` | `sales.shipment` | `sales.order` | `shipment.order.id` |

**Critical**: `documentAddresses.ts` currently has **no `buildLog()` at all**. This must be added.

##### documentAddresses.ts — Add Full Audit Logging

The `createDocumentAddress`, `updateDocumentAddress`, and `deleteDocumentAddress` commands need:
1. `prepare()` / `captureAfter()` hooks for snapshots
2. `buildLog()` returning metadata with both resource and parent resource fields

```typescript
buildLog: async ({ result, snapshots, input }) => {
  const after = snapshots.after as DocumentAddressSnapshot | undefined
  const before = snapshots.before as DocumentAddressSnapshot | undefined
  if (!after && !before) return null

  const { translate } = await resolveTranslations()
  const documentKind = input.documentKind // 'order' | 'quote'
  const parentResourceKind = documentKind === 'order' ? 'sales.order' : 'sales.quote'

  return {
    actionLabel: translate('sales.audit.documentAddress.created', 'Created document address'),
    resourceKind: 'sales.documentAddress',
    resourceId: result.addressId,
    parentResourceKind,
    parentResourceId: input.documentId,
    snapshotBefore: before ?? null,
    snapshotAfter: after ?? null,
  }
}
```

##### notes.ts — Add Parent Reference

```typescript
// In buildLog for create/update/delete:
parentResourceKind: determineNoteParentKind(note.contextType),
parentResourceId: note.contextId,
```

Helper:
```typescript
function determineNoteParentKind(contextType: string): string {
  const map: Record<string, string> = {
    order: 'sales.order',
    quote: 'sales.quote',
    invoice: 'sales.invoice',
    credit_memo: 'sales.credit_memo',
  }
  return map[contextType] ?? `sales.${contextType}`
}
```

##### payments.ts — Add Parent Reference

```typescript
parentResourceKind: 'sales.order',
parentResourceId: payment.order?.id ?? input.orderId,
```

##### shipments.ts — Add Parent Reference

```typescript
parentResourceKind: 'sales.order',
parentResourceId: shipment.order?.id ?? input.orderId,
```

#### 3.2 Customers Module Commands

| Command File | resourceKind | parentResourceKind | parentResourceId Source |
|-------------|-------------|-------------------|----------------------|
| `addresses.ts` | `customers.address` | `customers.person` or `customers.company` | `address.entityId` + entity kind lookup |
| `activities.ts` | `customers.activity` | `customers.person` or `customers.company` | `activity.entityId` + entity kind lookup |
| `comments.ts` | `customers.comment` | `customers.person` or `customers.company` | `comment.entityId` + entity kind lookup |
| `todos.ts` | `customers.todoLink` | `customers.person` or `customers.company` | `todoLink.entityId` + entity kind lookup |

For customers, the parent entity kind depends on whether the customer is a person or company. The `entityId` field on the child entity references the customer, and the `entityKind` (or lookup) determines the type.

```typescript
// Common pattern for customer child commands:
parentResourceKind: input.entityKind === 'company' ? 'customers.company' : 'customers.person',
parentResourceId: input.entityId,
```

#### 3.3 Staff Module Commands

| Command File | resourceKind | parentResourceKind | parentResourceId Source |
|-------------|-------------|-------------------|----------------------|
| `addresses.ts` | `staff.team_member_address` | `staff.teamMember` | `address.memberId` |
| `activities.ts` | `staff.team_member_activity` | `staff.teamMember` | `activity.memberId` |
| `comments.ts` | `staff.team_member_comment` | `staff.teamMember` | `comment.memberId` |
| `job-histories.ts` | `staff.team_member_job_history` | `staff.teamMember` | `jobHistory.memberId` |
| `leave-requests.ts` | `staff.leave_request` | `staff.teamMember` | `leaveRequest.memberId` |
| `tag-assignments.ts` | `staff.teamMemberTagAssignment` | `staff.teamMember` | `assignment.memberId` |

```typescript
// Common pattern for staff child commands:
parentResourceKind: 'staff.teamMember',
parentResourceId: input.memberId,
```

#### 3.4 Resources Module Commands

| Command File | resourceKind | parentResourceKind | parentResourceId Source |
|-------------|-------------|-------------------|----------------------|
| `activities.ts` | `resources.resource_activity` | `resources.resource` | `activity.resourceId` |
| `comments.ts` | `resources.resource_comment` | `resources.resource` | `comment.resourceId` |
| `tag-assignments.ts` | `resources.resourceTagAssignment` | `resources.resource` | `assignment.resourceId` |

```typescript
// Common pattern for resource child commands:
parentResourceKind: 'resources.resource',
parentResourceId: input.resourceId,
```

#### 3.5 Catalog Module Commands

| Command File | resourceKind | parentResourceKind | parentResourceId Source |
|-------------|-------------|-------------------|----------------------|
| `variants.ts` | `catalog.variant` | `catalog.product` | `variant.product.id` |
| `prices.ts` | `catalog.price` | `catalog.product` or `catalog.variant` | `price.product?.id` or `price.variant?.id` |

Note: Catalog variants have their own detail page with their own version history, so the parent reference is optional here. Prices can belong to either products or variants.

```typescript
// variants.ts:
parentResourceKind: 'catalog.product',
parentResourceId: variant.product?.id ?? input.productId,

// prices.ts (when attached to a variant):
parentResourceKind: 'catalog.variant',
parentResourceId: price.variant?.id ?? input.variantId,
```

#### 3.6 Planner Module Commands

| Command File | resourceKind | parentResourceKind | parentResourceId Source |
|-------------|-------------|-------------------|----------------------|
| `availability.ts` | `planner.availability` | Depends on context | `ruleSet.entityId` |
| `availability-weekly.ts` | `planner.availability` | Depends on context | `ruleSet.entityId` |
| `availability-date-specific.ts` | `planner.availability` | Depends on context | `ruleSet.entityId` |

Planner availability is polymorphic — it can belong to a staff member or a resource. The parent kind depends on the owning entity.

#### 3.7 Currencies Module Commands

| Command File | resourceKind | parentResourceKind | parentResourceId Source |
|-------------|-------------|-------------------|----------------------|
| `exchange-rates.ts` | `currencies.exchange_rate` | `currencies.currency` | `exchangeRate.currency.id` |

```typescript
parentResourceKind: 'currencies.currency',
parentResourceId: exchangeRate.currency?.id ?? input.currencyId,
```

#### 3.8 Dictionaries Module Commands

| Command File | resourceKind | parentResourceKind | parentResourceId Source |
|-------------|-------------|-------------------|----------------------|
| `entries.ts` | `dictionaries.entry` | `dictionaries.dictionary` | `entry.dictionary.id` |

---

## Complete Affected Entity Map

### Entities Where History Panel Is Shown (Parents)

| Parent Entity | Detail Page | resourceKind | Child Entities Missing from History |
|--------------|------------|-------------|-------------------------------------|
| **Sales Order** | `/backend/sales/orders/[id]` | `sales.order` | documentAddress, payment, shipment, note, (line items) |
| **Sales Quote** | `/backend/sales/quotes/[id]` | `sales.quote` | documentAddress, note, (line items) |
| **Customer Person** | `/backend/customers/people/[id]` | `customers.person` | address, activity, comment, todoLink |
| **Customer Company** | `/backend/customers/companies/[id]` | `customers.company` | address, activity, comment, todoLink |
| **Customer Deal** | `/backend/customers/deals/[id]` | `customers.deal` | *(no children currently)* |
| **Staff Team Member** | `/backend/staff/team-members/[id]` | `staff.teamMember` | address, activity, comment, jobHistory, leaveRequest, tagAssignment |
| **Staff Team** | `/backend/staff/teams/[id]` | `staff.team` | *(no children currently)* |
| **Resource** | `/backend/resources/[id]` | `resources.resource` | activity, comment, tagAssignment |
| **Catalog Product** | `/backend/catalog/products/[id]` | `catalog.product` | variant, price |
| **Catalog Variant** | `/backend/catalog/variants/[id]` | `catalog.variant` | price |
| **Currency** | `/backend/currencies/[id]` | `currencies.currency` | exchangeRate |

### Child Entities That Need `parentResource*` Fields

| Child Entity | resourceKind | Parent Entity | Parent resourceKind |
|-------------|-------------|---------------|-------------------|
| Document Address | `sales.documentAddress` | Sales Order / Quote | `sales.order` / `sales.quote` |
| Sales Payment | `sales.payment` | Sales Order | `sales.order` |
| Sales Shipment | `sales.shipment` | Sales Order | `sales.order` |
| Sales Note | `sales.note` | Sales Order / Quote / Invoice / Credit Memo | `sales.order` / `sales.quote` / etc. |
| Customer Address | `customers.address` | Person / Company | `customers.person` / `customers.company` |
| Customer Activity | `customers.activity` | Person / Company | `customers.person` / `customers.company` |
| Customer Comment | `customers.comment` | Person / Company | `customers.person` / `customers.company` |
| Customer Todo Link | `customers.todoLink` | Person / Company | `customers.person` / `customers.company` |
| Staff Address | `staff.team_member_address` | Team Member | `staff.teamMember` |
| Staff Activity | `staff.team_member_activity` | Team Member | `staff.teamMember` |
| Staff Comment | `staff.team_member_comment` | Team Member | `staff.teamMember` |
| Staff Job History | `staff.team_member_job_history` | Team Member | `staff.teamMember` |
| Staff Leave Request | `staff.leave_request` | Team Member | `staff.teamMember` |
| Staff Tag Assignment | `staff.teamMemberTagAssignment` | Team Member | `staff.teamMember` |
| Resource Activity | `resources.resource_activity` | Resource | `resources.resource` |
| Resource Comment | `resources.resource_comment` | Resource | `resources.resource` |
| Resource Tag Assignment | `resources.resourceTagAssignment` | Resource | `resources.resource` |
| Catalog Variant | `catalog.variant` | Product | `catalog.product` |
| Catalog Price | `catalog.price` | Product / Variant | `catalog.product` / `catalog.variant` |
| Exchange Rate | `currencies.exchange_rate` | Currency | `currencies.currency` |

---

## VersionHistory Config Updates

All pages that show VersionHistoryAction should set `includeRelated: true` (which is the default). No changes needed to existing page code unless they want to opt out.

---

## Internationalization

### New i18n Keys

Add to all locale files in `packages/core/src/modules/audit_logs/i18n/`:

**English (`en.json`):**
```json
{
  "audit_logs.version_history.show_related": "Show related changes",
  "audit_logs.version_history.related_label": "Related: {{type}}"
}
```

**Polish (`pl.json`):**
```json
{
  "audit_logs.version_history.show_related": "Pokaż powiązane zmiany",
  "audit_logs.version_history.related_label": "Powiązane: {{type}}"
}
```

**German (`de.json`):**
```json
{
  "audit_logs.version_history.show_related": "Verwandte Änderungen anzeigen",
  "audit_logs.version_history.related_label": "Verwandt: {{type}}"
}
```

**Spanish (`es.json`):**
```json
{
  "audit_logs.version_history.show_related": "Mostrar cambios relacionados",
  "audit_logs.version_history.related_label": "Relacionado: {{type}}"
}
```

### Sales Document Address Audit Labels

Add to `packages/core/src/modules/sales/i18n/` files:

```json
{
  "sales.audit.documentAddress.created": "Created document address",
  "sales.audit.documentAddress.updated": "Updated document address",
  "sales.audit.documentAddress.deleted": "Deleted document address"
}
```

(And translations for pl, de, es.)

---

## Migration Path

### Backward Compatibility

- The new `parent_resource_kind` and `parent_resource_id` columns are **nullable** — existing audit log entries are unaffected.
- The `includeRelated` API parameter defaults to `false` — existing API consumers see no behavior change.
- The UI default of `includeRelated: true` only applies to the Version History panel, not the global Audit Logs page.
- Existing entries without parent fields simply appear as they do today.

### Backfilling (Optional, Future)

A one-time migration script could backfill `parent_resource_kind` and `parent_resource_id` for existing child entity entries by inspecting their `snapshotBefore`/`snapshotAfter` payloads for parent references (e.g., `orderId`, `entityId`, `memberId`). This is optional and can be deferred.

---

## Implementation Plan

### Phase 1: Infrastructure (Low Risk)
1. Add `parentResourceKind` + `parentResourceId` to `ActionLog` entity
2. Run `npm run db:generate` to create migration
3. Add fields to `CommandLogMetadata` type
4. Update `ActionLogService.log()` to persist new fields
5. Update `ActionLogService.list()` to support `includeRelated`
6. Update API route and validators
7. Update command bus `persistLog()` to forward parent fields

### Phase 2: UI (Low Risk)
1. Update `VersionHistoryConfig` and `VersionHistoryEntry` types
2. Update `useVersionHistory` hook to pass `includeRelated`
3. Update `VersionHistoryPanel` to render child entries with visual distinction
4. Add `humanizeResourceKind` helper
5. Add toggle checkbox for show/hide related changes
6. Add i18n keys

### Phase 3: Command Updates (Medium Risk, Largest Scope)
Update commands module by module. Each module can be done independently:
1. **Sales** — documentAddresses (add full buildLog), notes, payments, shipments
2. **Customers** — addresses, activities, comments, todos
3. **Staff** — addresses, activities, comments, job-histories, leave-requests, tag-assignments
4. **Resources** — activities, comments, tag-assignments
5. **Catalog** — variants, prices
6. **Currencies** — exchange-rates
7. **Planner** — availability commands (if applicable)

### Phase 4: Verification
1. Add unit tests for `ActionLogService.list()` with `includeRelated`
2. Verify version history panel shows related changes on order detail page
3. Verify related changes on customer, staff, resource detail pages
4. Verify toggle filtering works correctly
5. Verify backward compatibility (global audit logs page unchanged)
6. Verify undo/redo still works for child entity entries

---

## File Manifest

### Modified Files

| File | Changes |
|------|---------|
| `packages/core/src/modules/audit_logs/data/entities.ts` | Add `parentResourceKind`, `parentResourceId` columns + index |
| `packages/core/src/modules/audit_logs/data/validators.ts` | Add parent fields to create schema, `includeRelated` to list schema |
| `packages/core/src/modules/audit_logs/services/actionLogService.ts` | Persist parent fields, support `includeRelated` in `list()` |
| `packages/core/src/modules/audit_logs/api/audit-logs/actions/route.ts` | Parse and pass `includeRelated` parameter |
| `packages/shared/src/lib/commands/types.ts` | Add `parentResourceKind`, `parentResourceId` to `CommandLogMetadata` |
| `packages/shared/src/lib/commands/command-bus.ts` | Forward parent fields in `persistLog()` |
| `packages/ui/src/backend/version-history/types.ts` | Add `includeRelated` to config, parent fields to entry |
| `packages/ui/src/backend/version-history/useVersionHistory.ts` | Pass `includeRelated` param |
| `packages/ui/src/backend/version-history/VersionHistoryPanel.tsx` | Render child entries, add toggle |
| `packages/core/src/modules/sales/commands/documentAddresses.ts` | Add full `buildLog()` with audit logging + parent fields |
| `packages/core/src/modules/sales/commands/notes.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/sales/commands/payments.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/sales/commands/shipments.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/customers/commands/addresses.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/customers/commands/activities.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/customers/commands/comments.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/customers/commands/todos.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/staff/commands/addresses.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/staff/commands/activities.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/staff/commands/comments.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/staff/commands/job-histories.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/staff/commands/leave-requests.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/staff/commands/tag-assignments.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/resources/commands/activities.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/resources/commands/comments.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/resources/commands/tag-assignments.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/catalog/commands/variants.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/catalog/commands/prices.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/currencies/commands/exchange-rates.ts` | Add `parentResourceKind/Id` to `buildLog()` |
| `packages/core/src/modules/audit_logs/i18n/en.json` | Add related history i18n keys |
| `packages/core/src/modules/audit_logs/i18n/pl.json` | Add related history i18n keys |
| `packages/core/src/modules/audit_logs/i18n/de.json` | Add related history i18n keys |
| `packages/core/src/modules/audit_logs/i18n/es.json` | Add related history i18n keys |
| `packages/core/src/modules/sales/i18n/en.json` | Add document address audit labels |
| `packages/core/src/modules/sales/i18n/pl.json` | Add document address audit labels |
| `packages/core/src/modules/sales/i18n/de.json` | Add document address audit labels |
| `packages/core/src/modules/sales/i18n/es.json` | Add document address audit labels |

### Auto-Generated Files

| File | Trigger |
|------|---------|
| `packages/core/src/modules/audit_logs/migrations/Migration<timestamp>.ts` | `npm run db:generate` |

---

## Design Decisions

### 1. Parent reference on ActionLog (not a join table)

A parent-child audit relationship is always 1:1 (a child change belongs to exactly one parent). A join table would add unnecessary complexity. The nullable columns on ActionLog are simpler, queryable, and indexable.

### 2. `includeRelated` defaults to `false` in API, `true` in UI

The API defaults to `false` for backward compatibility (the global Audit Logs page should not suddenly show related entries). The UI hook defaults to `true` because the entire point of this feature is showing related changes.

### 3. Visual distinction for related entries

Related entries are rendered with a left border indent and a type badge rather than in a separate section. This keeps the chronological timeline intact and makes it easy to see when child changes happened relative to parent changes.

### 4. Document addresses need full audit logging

The `documentAddresses.ts` commands are the only commands that completely lack `buildLog()` handlers. This is a bug/gap that this spec fixes as part of the broader work.

### 5. Toggle for related changes

The optional toggle in the panel header lets power users focus on just the parent entity changes when the timeline is too noisy. This is a simple client-side filter (no additional API call).

### 6. No changes to undo/redo

Undo/redo continues to work per individual audit log entry. A child entry (e.g., address change) can be undone independently from the parent. The `undoToken` and `executionState` fields remain per-entry. Grouping undo/redo across related entries is a future consideration.

---

## Future Considerations

1. **Grouped undo/redo**: Allow undoing all changes in a "transaction" (e.g., undo an entire order creation including all addresses and line items)
2. **Backfill script**: Populate `parentResourceKind/Id` for historical entries by inspecting snapshot data
3. **Deep nesting**: Support grandparent references (e.g., payment allocation → payment → order). Current design only supports one level of parent.
4. **Custom entity support**: When custom entities have child records, support the same parent reference pattern
5. **Real-time updates**: WebSocket notifications when related entities change
6. **Timeline grouping**: Visually group changes that happened within a short time window (e.g., within 1 minute)

---

## Changelog

### 2026-02-07
- Initial specification
