# Sales Orders & Quotes Change History (Ticket #210)

Goal: Provide a clear, tenant-safe history of changes for sales orders and quotes, focused on status changes and key lifecycle events, with a timeline UI inside the sales document detail view.

This spec describes the user stories, API and data architecture, and UI ideas to implement a consistent change history for both orders and quotes.

## 1) Problem Statement

Sales users need to answer: "What changed, when, and who did it?" Today we have partial audit data (ActionLog entries) and a status-change note for orders only. Quotes and non-command status updates (send/accept) are not captured consistently, so there is no reliable history timeline.

## 2) Goals

- Provide a timeline of changes for sales orders and quotes.
- At minimum, include status transitions and key lifecycle actions (create, update, send, accept, convert, cancel, delete).
- Surface actor and timestamp consistently.
- Keep history tenant- and organization-scoped.
- Use existing audit logging infrastructure where possible (ActionLog + snapshots) to avoid new tables.
- Enable UI rendering in the sales document detail page.

## 3) Non-Goals (for MVP)

- Full diff of every nested field/line item.
- Public/customer-facing history UI.
- Cross-document aggregation or global audit dashboards (already covered by audit_logs module).
- Retroactive backfill for existing orders/quotes beyond current audit logs.
- Invoice and credit memo history (can be added in a follow-up).

## 4) User Stories / Use Cases

1) As a sales admin, I can see a chronological timeline of status changes for an order or quote.
2) As a support agent, I can tell which user or API key performed a change.
3) As a sales manager, I can see when a quote was sent/accepted/converted and by whom.
4) As a user with limited permissions, I only see history for documents in my tenant/org scope.
5) As a user, I can filter the timeline to show only status changes vs. other actions.

## 5) Data Sources & Model

### 5.1 Primary Source: ActionLog (audit_logs module)

Use ActionLog entries where:
- `resourceKind` is `sales.order` or `sales.quote` (use dot notation consistently).
- `resourceId` matches the document id.
- `actionLabel` indicates the action (create/update/delete/convert/etc.).

ActionLog entries already include `snapshotBefore` / `snapshotAfter` for document updates and create/delete, which can be used to detect status transitions.

**Note on `resourceKind` format:** Standardize on dot notation (`sales.order`, `sales.quote`) to match existing patterns like `sales.payment`, `sales.shipment`. Verify existing commands use this format consistently.

### 5.2 Fill Missing Status Changes

Some status changes are currently made outside command handlers:
- `sales/api/quotes/send/route.ts` — changes status from `draft` → `sent`
- `sales/api/quotes/accept/route.ts` — changes status from `sent` → `confirmed`
- Status updates in payments/shipments commands may update orders but log only `sales.payment` / `sales.shipment` resourceKind.

To ensure history completeness:
- Add explicit ActionLog entries for these status changes (resourceKind `sales.quote` or `sales.order`).
- Reuse a helper to log status changes with before/after values and actor context.
- Add a status change note for quotes to mirror orders (see `appendOrderStatusChangeNote` pattern).

### 5.3 History Entry View Model

Define a normalized timeline model (returned by sales API):

```typescript
type HistoryEntry = {
  id: string
  occurredAt: string // ISO-8601
  kind: 'status' | 'action' | 'comment'
  action: string // localized label key or fallback text
  actor: { id: string | null; label: string }
  source: 'action_log' | 'note'
  metadata?: {
    statusFrom?: string | null
    statusTo?: string | null
    documentKind?: 'order' | 'quote'
    commandId?: string
  }
}
```

## 6) API Design

### 6.1 New Sales API Endpoint

`GET /api/sales/document-history?kind=order|quote&id=<uuid>&limit=50&before=<iso>&after=<iso>&types=status,action,comment`

Response:
```typescript
{
  items: HistoryEntry[]
  nextCursor?: string // Opaque cursor encoding createdAt + id for pagination
}
```

**Implementation notes:**
- Implement inside `packages/core/src/modules/sales/api/document-history/route.ts` (new module route).
- Validate query params with zod, use scoped helpers for tenant/org.
- This is a **read-only endpoint** — no `indexer` configuration needed.
- Fetch ActionLog entries by resourceKind/resourceId and scope.
- Optionally merge SalesNote entries (contextType order/quote) as comments in the timeline.

### 6.2 OpenAPI Schema Definition

The route **must** export an `openApi` object per project conventions:

```typescript
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const documentHistoryQuerySchema = z.object({
  kind: z.enum(['order', 'quote']).describe('Document type'),
  id: z.string().uuid().describe('Document ID'),
  limit: z.coerce.number().min(1).max(100).default(50).optional(),
  before: z.string().datetime().optional().describe('Return entries before this ISO-8601 timestamp'),
  after: z.string().datetime().optional().describe('Return entries after this ISO-8601 timestamp'),
  types: z.string().optional().describe('Comma-separated list: status,action,comment'),
})

const historyActorSchema = z.object({
  id: z.string().uuid().nullable(),
  label: z.string(),
})

const historyEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  kind: z.enum(['status', 'action', 'comment']),
  action: z.string(),
  actor: historyActorSchema,
  source: z.enum(['action_log', 'note']),
  metadata: z.object({
    statusFrom: z.string().nullable().optional(),
    statusTo: z.string().nullable().optional(),
    documentKind: z.enum(['order', 'quote']).optional(),
    commandId: z.string().optional(),
  }).optional(),
})

const documentHistoryResponseSchema = z.object({
  items: z.array(historyEntrySchema),
  nextCursor: z.string().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Get document change history',
  methods: {
    GET: {
      summary: 'List history entries for an order or quote',
      query: documentHistoryQuerySchema,
      responses: [
        { status: 200, description: 'History entries', schema: documentHistoryResponseSchema },
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Document not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
```

### 6.3 ActionLog Enhancements (if needed)

Extend `ActionLogService.list()` or add a dedicated method to filter by:
- `resourceKind`
- `resourceId`

Ensure decryption is applied via `ActionLogService.decryptEntries()` before building history entries. The existing service already calls this internally for `list()` results.

### 6.4 Pagination Strategy

Use cursor-based pagination with an opaque cursor encoding `createdAt + id`:
- Encode: `btoa(JSON.stringify({ createdAt: entry.createdAt, id: entry.id }))`
- Decode and use in query: `WHERE (created_at, id) < ($cursor_created_at, $cursor_id)`

This ensures stable pagination even when new entries are added.

## 7) Backend Architecture

### 7.1 History Builder Helper

Create a sales module helper (pure function, not a DI service) to:
- Query action logs for the document.
- Derive status change entries by comparing `snapshotBefore`/`snapshotAfter`.
- Map `actionLabel` to localized string.
- Build the `HistoryEntry[]` list.

**Suggested placement:**
`packages/core/src/modules/sales/lib/history.ts`

```typescript
import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { SalesNote } from '../data/entities'

export type HistoryBuilderInput = {
  actionLogs: ActionLog[]
  notes?: SalesNote[]
  translate: (key: string, fallback: string, params?: Record<string, unknown>) => string
}

export function buildHistoryEntries(input: HistoryBuilderInput): HistoryEntry[] {
  // Implementation: merge action logs + notes, detect status changes, sort by occurredAt desc
}

export function detectStatusChange(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): { statusFrom: string | null; statusTo: string | null } | null {
  // Compare before.status vs after.status
}
```

### 7.2 Status Change Logger Helper

Add helper to log status changes when updates happen outside document commands:
- Use `ActionLogService.log()`
- Provide `resourceKind`, `resourceId`, `actionLabel`, `snapshotBefore`, `snapshotAfter`, and `context` with `statusFrom`/`statusTo`.

**Suggested placement:**
`packages/core/src/modules/sales/lib/statusHistory.ts`

```typescript
import type { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'

export type StatusChangeLogInput = {
  actionLogService: ActionLogService
  resourceKind: 'sales.order' | 'sales.quote'
  resourceId: string
  actionLabel: string
  statusFrom: string | null
  statusTo: string
  actorUserId: string | null
  tenantId: string
  organizationId: string
}

export async function logStatusChange(input: StatusChangeLogInput): Promise<void> {
  await input.actionLogService.log({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    commandId: `status-change-${Date.now()}`,
    actionLabel: input.actionLabel,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    snapshotBefore: { status: input.statusFrom },
    snapshotAfter: { status: input.statusTo },
    context: {
      statusFrom: input.statusFrom,
      statusTo: input.statusTo,
    },
  })
}
```

### 7.3 Quote Status Change Note Helper

Mirror the existing `appendOrderStatusChangeNote` pattern for quotes:

```typescript
async function appendQuoteStatusChangeNote({
  em,
  quote,
  previousStatus,
  auth,
}: {
  em: EntityManager
  quote: SalesQuote
  previousStatus: string | null
  auth: any
}): Promise<SalesNote | null> {
  // Similar to appendOrderStatusChangeNote but for quotes
}
```

### 7.4 Commands/Routes to Update

- `sales/api/quotes/send/route.ts`: log status change (`draft` → `sent`) via `logStatusChange()` helper.
- `sales/api/quotes/accept/route.ts`: log status change (`sent` → `confirmed`) via `logStatusChange()` helper.
- `sales/commands/payments.ts` and `sales/commands/shipments.ts`: if these update order status, log a status history entry for `sales.order` as well.
- Keep existing `appendOrderStatusChangeNote` behavior — the history API will merge both ActionLog and SalesNote sources.

### 7.5 Encryption Considerations

Per project conventions:
- ActionLog entries may contain encrypted data when tenant data encryption is enabled.
- `ActionLogService.list()` already calls `decryptEntries()` internally.
- If querying ActionLog directly via ORM, use `findWithDecryption` from `@open-mercato/shared/lib/encryption/find` with the document's `tenantId`.
- Ensure snapshots containing PII (customer names, emails) are decrypted before display.

### 7.6 Event Emission (Optional Enhancement)

Consider emitting domain events for status changes that other modules can subscribe to:

```typescript
// In sales/lib/statusHistory.ts
await eventBus?.emit('sales.order.status.changed', {
  orderId: input.resourceId,
  statusFrom: input.statusFrom,
  statusTo: input.statusTo,
  actorUserId: input.actorUserId,
  tenantId: input.tenantId,
  organizationId: input.organizationId,
})
```

This enables future integrations (notifications, webhooks) without modifying history code.

## 8) UI Implementation

### 8.1 History Tab — Widget Injection Approach

The document detail page (`sales/backend/sales/documents/[id]/page.tsx`) already uses widget injection for tabs via `injectedTabWidgets`. **Recommended:** Implement History as an injected widget for consistency.

**Widget registration:**

Create widget at `packages/core/src/modules/sales/widgets/injection/DocumentHistoryTab.tsx`:

```tsx
'use client'

import * as React from 'react'
import type { InjectionWidgetProps } from '@open-mercato/ui/backend/injection'
import { DocumentHistoryTimeline } from '../../components/documents/DocumentHistoryTimeline'

export default function DocumentHistoryTab({ context }: InjectionWidgetProps) {
  const { record, kind } = context as { record: { id: string }; kind: 'order' | 'quote' }
  return <DocumentHistoryTimeline documentId={record.id} documentKind={kind} />
}
```

Create metadata at `packages/core/src/modules/sales/widgets/injection/DocumentHistoryTab.meta.ts`:

```typescript
import type { InjectionWidgetMeta } from '@open-mercato/shared/lib/injection'

export const metadata: InjectionWidgetMeta = {
  id: 'sales:document-history-tab',
  label: 'sales.documents.history.tab',
  placement: { kind: 'tab' },
  priority: 50,
}
```

Register in `packages/core/src/modules/sales/widgets/injection-table.ts`:

```typescript
export const injectionTable: InjectionTableEntry[] = [
  {
    widgetId: 'sales:document-history-tab',
    spotId: 'crud-form:sales:sales_order',
  },
  {
    widgetId: 'sales:document-history-tab',
    spotId: 'crud-form:sales:sales_quote',
  },
]
```

### 8.2 Timeline Component

Create `packages/core/src/modules/sales/components/documents/DocumentHistoryTimeline.tsx`:

```tsx
'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
// ... component implementation
```

**Timeline layout mockup:**

```
[History]  [Filters: All | Status | Actions | Comments]

● 10:42 AM  Status
  Draft → Confirmed
  by alex@acme.com

● 10:10 AM  Action
  Convert quote to order
  by API key: Zapier

● 09:58 AM  Comment
  "Customer asked to delay delivery"
  by you
```

### 8.3 Detail Drawer / Dialog

Allow clicking an entry to open a side drawer showing:
- `actionLabel`
- Actor details
- Timestamp
- Optional before/after payload for status
- Link to full ActionLog details (reuse `ActionLogDetailsDialog` from `audit_logs` module).

### 8.4 Visual Styling

- **Status changes:** Colored pill and arrow indicator (e.g., `Draft` → `Sent`).
- **Actions:** Icon matching action type (create/update/convert) using Lucide icons.
- **Comments:** Reuse `NotesSection` styling from existing sales components.

## 9) Access Control

- Require `sales.orders.view` or `sales.quotes.view` to read history for the respective document.
- The history API inherits document-level scoping — users only see history for documents they can access.
- Optional: if history includes detailed ActionLog payloads, consider requiring `audit_logs.view_actions` permission for the expanded view.

## 10) Localization

Add translation keys to all locale files (`en.json`, `de.json`, `es.json`, `pl.json`):

```json
{
  "sales.documents.history.tab": "History",
  "sales.documents.history.filter.all": "All",
  "sales.documents.history.filter.status": "Status",
  "sales.documents.history.filter.actions": "Actions",
  "sales.documents.history.filter.comments": "Comments",
  "sales.documents.history.empty": "No history entries yet.",
  "sales.documents.history.status_changed": "Status changed from {from} to {to}",
  "sales.documents.history.by_actor": "by {actor}",
  "sales.documents.history.by_api_key": "by API key: {name}",
  "sales.documents.history.by_system": "by system",
  "sales.quotes.status_change.note": "Status changed from {from} to {to} by {actor}.",
  "sales.audit.quotes.send": "Send quote",
  "sales.audit.quotes.accept": "Accept quote"
}
```

**Note:** `sales.orders.status_change.note` already exists. Add the quote equivalent.

## 11) Testing

- **Unit tests for history builder:** Status change detection from snapshots, merging action logs with notes, sorting.
- **API integration test:** Returns only scoped history entries, respects tenant/org isolation.
- **Encryption test:** Ensure `ActionLogService.decryptEntries()` is applied and PII is properly decrypted.
- **Widget injection test:** Verify History tab appears for both orders and quotes.

Test file location: `packages/core/src/modules/sales/api/__tests__/document-history.test.ts`

## 12) Rollout / Migration

- **No DB migrations** if reusing ActionLog + SalesNote.
- Run `npm run modules:prepare` after adding the widget to regenerate injection tables.
- If a new entity is introduced later, generate migrations via `npm run db:generate` only.

## 13) Open Questions (Please Confirm)

1. Do we want history to include only status changes or all updates (addresses, totals, line items, payments)?
2. Should comments be part of the history timeline, or remain in the Comments tab only?
3. Should history be visible to all sales users or require `audit_logs.*` permissions for detailed views?
4. Is a new `sales_document_activity` entity acceptable if ActionLog is insufficient?
5. Do we need to backfill historical entries for existing documents?
6. Should quote send/accept and order status updates generate SalesNotes as well as ActionLogs?
7. Do we need to expose history on public quote pages?
8. Should history cover invoices and credit memos as well, given SalesNote already supports them?
9. Should status changes emit domain events for subscribers (e.g., for notifications, webhooks)?
10. Should the History tab be a built-in tab or an injected widget? *(Spec recommends injected widget for consistency)*

## 14) Implementation Checklist

- [ ] Create `sales/lib/history.ts` — history builder helper
- [ ] Create `sales/lib/statusHistory.ts` — status change logger helper
- [ ] Create `sales/api/document-history/route.ts` with OpenAPI export
- [ ] Update `sales/api/quotes/send/route.ts` to log status change
- [ ] Update `sales/api/quotes/accept/route.ts` to log status change
- [ ] Add `appendQuoteStatusChangeNote` helper (if decided)
- [ ] Create `DocumentHistoryTimeline.tsx` component
- [ ] Create `DocumentHistoryTab.tsx` injection widget + meta
- [ ] Register widget in `injection-table.ts`
- [ ] Add localization keys to all 4 locale files
- [ ] Write unit tests for history builder
- [ ] Write API integration tests
- [ ] Run `npm run modules:prepare`
