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

## 4) User Stories / Use Cases

1) As a sales admin, I can see a chronological timeline of status changes for an order or quote.
2) As a support agent, I can tell which user or API key performed a change.
3) As a sales manager, I can see when a quote was sent/accepted/converted and by whom.
4) As a user with limited permissions, I only see history for documents in my tenant/org scope.
5) As a user, I can filter the timeline to show only status changes vs. other actions.

## 5) Data Sources & Model

### 5.1 Primary Source: ActionLog (audit_logs module)

Use ActionLog entries where:
- resourceKind is `sales.order` or `sales.quote`.
- resourceId matches the document id.
- actionLabel indicates the action (create/update/delete/convert/etc.).

ActionLog entries already include snapshotBefore / snapshotAfter for document updates and create/delete, which can be used to detect status transitions.

### 5.2 Fill Missing Status Changes

Some status changes are currently made outside command handlers:
- `sales/api/quotes/send/route.ts`
- `sales/api/quotes/accept/route.ts`
- status updates in payments/shipments commands may update orders but log only `sales.payment` / `sales.shipment` resourceKind.

To ensure history completeness:
- Add explicit ActionLog entries for these status changes (resourceKind `sales.quote` or `sales.order`).
- Reuse a helper to log status changes with before/after values and actor context.
- Optionally add a status change note for quotes to mirror orders.

### 5.3 History Entry View Model

Define a normalized timeline model (returned by sales API):

```
HistoryEntry = {
  id: string,
  occurredAt: string,
  kind: 'status' | 'action' | 'comment',
  action: string, // localized label key or fallback text
  actor: { id: string | null, label: string },
  source: 'action_log' | 'note',
  metadata?: {
    statusFrom?: string | null,
    statusTo?: string | null,
    documentKind?: 'order' | 'quote',
    commandId?: string,
  },
}
```

## 6) API Design

### 6.1 New Sales API Endpoint

`GET /api/sales/document-history?kind=order|quote&id=<uuid>&limit=50&before=<iso>&after=<iso>&types=status,action,comment`

Response:
```
{
  items: HistoryEntry[],
  nextCursor?: string
}
```

Notes:
- Implement inside `packages/core/src/modules/sales/api/document-history/route.ts` (new module route).
- Validate query params with zod, use scoped helpers for tenant/org.
- Must export `openApi` with request/response schemas.
- Fetch ActionLog entries by resourceKind/resourceId and scope.
- Optionally merge SalesNote entries (contextType order/quote) as comments in the timeline.

### 6.2 ActionLog Enhancements (if needed)

Extend ActionLogService list() or add a dedicated method to filter by:
- resourceKind
- resourceId

Ensure decryption is applied via ActionLogService before building history entries.

## 7) Backend Architecture

### 7.1 History Builder Service

Create a sales module helper to:
- Query action logs for the document.
- Derive status change entries by comparing snapshotBefore/after.
- Map actionLabel to localized string.
- Build the `HistoryEntry[]` list.

Suggested placement:
`packages/core/src/modules/sales/lib/history.ts`

### 7.2 Status Change Logger Helper

Add helper to log status changes when updates happen outside document commands:
- Use ActionLogService.log()
- Provide `resourceKind`, `resourceId`, `actionLabel`, `snapshotBefore`, `snapshotAfter`, and `context` with `statusFrom`/`statusTo`.

Suggested placement:
`packages/core/src/modules/sales/lib/statusHistory.ts`

### 7.3 Commands/Routes to Update

- `sales/api/quotes/send/route.ts`: log status change (draft -> sent).
- `sales/api/quotes/accept/route.ts`: log status change (sent -> confirmed).
- `sales/commands/payments.ts` and `sales/commands/shipments.ts`: if these update order status, log a status history entry for `sales.order` as well.
- Keep existing `appendOrderStatusChangeNote` behavior or replace with unified history logging (decision required).

## 8) UI Ideas / Mockups

### 8.1 Document Detail Tab

Add a new tab: "History" (next to Comments, Items, etc.).

Timeline layout:

```
[History]  [Filters: All | Status | Actions | Comments]

* 10:42 AM  (Status)
  Status changed: Draft -> Confirmed
  by alex@acme.com

* 10:10 AM  (Action)
  Convert quote to order
  by API key: Zapier

* 09:58 AM  (Comment)
  "Customer asked to delay delivery"
  by you
```

### 8.2 Detail Drawer / Dialog

Allow clicking an entry to open a side drawer showing:
- actionLabel
- actor
- timestamp
- optional before/after payload for status
- link to full ActionLog details (reuse `ActionLogDetailsDialog` UI).

### 8.3 Visual Styling

- Status changes: colored pill and arrow indicator (e.g., Draft -> Sent).
- Actions: icon matching action type (create/update/convert).
- Comments: reuse NotesSection styling.

## 9) Access Control

- Require `sales.orders.view` or `sales.quotes.view` to read history for the respective document.
- Optional: if history includes ActionLog details, consider `audit_logs.view_*` permissions.

## 10) Localization

Add translation keys for:
- History tab label
- Filter labels
- Status change text
- Empty states
- Action labels where not already in `sales.audit.*`

Update all locale files (keep in sync).

## 11) Testing

- Unit tests for history builder: status change detection from snapshots.
- API test: returns only scoped history entries.
- Ensure encryption helpers are applied (ActionLogService decryptEntries).

## 12) Rollout / Migration

- No DB migrations if reusing ActionLog + SalesNote.
- If a new entity is introduced later, generate migrations via `npm run db:generate` only.

## 13) Open Questions (Please Confirm)

1) Do we want history to include only status changes or all updates (addresses, totals, line items, payments)?
2) Should comments be part of the history timeline, or remain in the Comments tab only?
3) Should history be visible to all sales users or require audit_logs permissions?
4) Is a new `sales_document_activity` entity acceptable if ActionLog is insufficient?
5) Do we need to backfill historical entries for existing documents?
6) Should quote send/accept and order status updates generate SalesNotes as well as ActionLogs?
7) Do we need to expose history on public quote pages?

