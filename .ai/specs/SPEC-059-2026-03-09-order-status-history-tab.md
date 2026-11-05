# SPEC-053 — Order Status History Tab

| Field | Value |
|-------|-------|
| **Status** | Superseded |
| **Created** | 2026-03-02 |
| **Related** | Document history widget, `GET /api/sales/document-history`, sales document detail tabs |

**Resolution (2026-03-09):** Dedicated **Status history** tab was removed. Status changes are available via the existing **History** tab using the "Status changes" filter. The API `types` query filter and creation-as-status-entry behaviour in `historyHelpers` remain and support that filter.

## TLDR

**Key Points (superseded):**
- ~~Add a dedicated **Status history** tab~~ → Use **History** tab with "Status changes" filter.
- Document status transitions (from → to, actor, date) are shown in History when filtered by status.
- API: `GET /api/sales/document-history` supports optional `types` query (e.g. `types=status`) for server-side filtering.

**Scope (current):**
- API: `types` query filter in `GET /api/sales/document-history` (implemented).
- History tab: client-side filter "Status changes" shows only status entries.
- No dedicated Status history tab; no new widget.

**Concerns:**
- None significant; read-only, existing data sources

---

## Overview

Order and quote status changes are currently recorded in two places: (1) the audit/action log via `logStatusChange`, and (2) auto-generated notes (comments) via `appendOrderStatusChangeNote`. The existing **History** tab shows a unified timeline (status + actions + comments) with a client-side filter. Users who only care about status must open History and select the "Status" filter. A dedicated **Status history** tab provides a one-click view of status transitions without filtering, similar in spirit to having a dedicated tab for a specific concern (e.g. like a dedicated "Activity" or "Comments" tab).

> **Market Reference**: Odoo and ERPNext expose order/quote status timelines; many CRMs show a dedicated "Status history" or "Stage history" on deal/order detail. This spec aligns with that pattern.

## Problem Statement

- Status changes are buried in the combined History timeline and in the Comments tab (as auto-generated notes).
- Users who need to quickly see "when did this order move to Shipped?" must open History and filter by Status, or scan comments.
- No first-class, dedicated surface for document status history.

## Proposed Solution

1. **New tab "Status history"** on sales document detail (`sales.document.detail.order:tabs` and `sales.document.detail.quote:tabs`).
2. **New injection widget** `sales.injection.document-status-history` that:
   - Renders only status-transition entries (same shape as current timeline status rows: from status → to status, actor, date).
   - Fetches from existing `GET /api/sales/document-history?kind=...&id=...&types=status`.
3. **API change**: Implement the already-declared `types` query parameter in the document-history route so that when `types=status` (or comma-separated `status,action,comment`), the response `items` are filtered server-side by `entry.kind` before returning.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Reuse document-history API with `types` filter | Avoid new endpoint; API already declares `types` in schema but does not filter — minimal backend change |
| New widget instead of reusing History widget with a "status-only" mode | Tab identity is explicit (Status history vs History); avoids overloading one widget with multiple tab identities |
| Same timeline UX (from → to, actor, date) | Consistency with existing History tab status rows; reuses status dictionary for labels/colors |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Only client-side filter in existing History tab | User ask is for a **separate tab** so status is visible without opening History and selecting filter |
| Dedicated `/api/sales/document-status-history` endpoint | Duplicates logic; `types` filter keeps one source of truth |

## User Stories / Use Cases

- **Sales user** wants to see at a glance when and by whom the order status changed (e.g. Draft → Confirmed → Shipped) so that they can answer customer questions without scanning comments or the full history.
- **Manager** wants to open the "Status history" tab on a quote/order to audit status progression without seeing comments or other actions.

## Architecture

- **Data source**: Unchanged. Status transitions come from `ActionLog` (via `logStatusChange` and document update snapshots) and are normalized by `buildHistoryEntries` in `historyHelpers.ts`. No new persistence.
- **API**: `GET /api/sales/document-history` — after building `items`, if `query.types` is present, filter `items` by `entry.kind` matching the comma-split set (e.g. `types=status` → keep only `kind === 'status'`).
- **UI**: New widget registered for spot `sales.document.detail.order:tabs` and `sales.document.detail.quote:tabs` with `kind: 'tab'`, new tab id e.g. `status-history`, label from i18n.

```
Document detail page
  Tabs: [ Comments | Addresses | Items | Shipments | Payments | Adjustments | History | Status history ]
                                                                    ↑              ↑
                                            existing widget (all kinds)    new widget (status only)
```

## Data Models

No new entities. Uses existing:

- `ActionLog` (audit_logs) — `resourceKind` `sales.order` / `sales.quote`, `resourceId`, `snapshotBefore` / `snapshotAfter` with status
- `SalesNote` — status-change notes (body like "Status changed from X to Y by Z") for display in History; status-only tab will show only action-log-derived status entries (not notes, since notes are `kind: 'comment'`). So the Status history tab shows **only** entries from the action log that have `detectStatusChange(log) !== null`, i.e. true status transitions. The auto-generated "status change" notes in Comments remain in the Comments tab and in the full History tab; they are not duplicated in the Status history tab (which is action-log status only). This keeps the Status tab simple and authoritative (one source: audit log).

*Clarification*: If we want the Status tab to also show "status change" notes (that have no action-log counterpart in edge cases), we could include note-derived entries that look like status changes (e.g. parse note body). For MVP, **Status history tab = action-log status entries only**; notes stay in Comments/History.

## API Contracts

### GET /api/sales/document-history (change)

- **Existing**: `kind`, `id`, `limit`, `before`, `after`, `types` (optional, comma-separated: status, action, comment).
- **Change**: When `types` is present, filter returned `items` by `entry.kind` in the set of parsed types. Example: `types=status` → return only items where `kind === 'status'`.
- **Response**: Unchanged shape `{ items: HistoryEntry[], nextCursor?: string }`.

## Internationalization (i18n)

- New key (e.g. `sales.documents.detail.tabs.statusHistory` or reuse a group label): label for tab "Status history" (and translation for other locales).
- Empty state: e.g. `sales.documents.statusHistory.empty` — "No status changes yet."

## UI/UX

- Tab label: "Status history" (or localized equivalent).
- Content: Vertical timeline of status transitions only: for each entry show "From status → To status", actor label, relative/absolute date. Reuse the same status dictionary (order-statuses) for labels and colors as the existing History widget.
- No filter dropdown (tab is status-only).
- Loading: Spinner. Error: inline error message. Empty: short message "No status changes yet."

## Migration & Compatibility

- No database migrations.
- API: additive (optional `types` param); existing clients that do not send `types` get unchanged behavior (all kinds).
- New widget is additive; no change to existing History tab or Comments tab.

## Implementation Plan

### Phase 1: API types filter
1. In `packages/core/src/modules/sales/api/document-history/route.ts`, after `items = buildHistoryEntries(...)`, if `query.types` is present, parse it (e.g. `query.types.split(',').map(s => s.trim())`) and filter `items` to those where `entry.kind` is in the set. Handle empty/invalid types (e.g. treat as "no filter").
2. Add a short unit or integration test that GET with `types=status` returns only entries with `kind === 'status'`.

### Phase 2: Status history tab widget
1. Add widget under `packages/core/src/modules/sales/widgets/injection/document-status-history/`: `widget.ts` (metadata, id `sales.injection.document-status-history`), `widget.client.tsx` (fetch `/api/sales/document-history?kind=...&id=...&types=status`, render timeline of status entries only; reuse status map from order-statuses API and same StatusTransition + actor + date presentation as document-history widget).
2. Register in `widgets/injection-table.ts` for `sales.document.detail.order:tabs` and `sales.document.detail.quote:tabs` with `kind: 'tab'`, appropriate `groupLabel` for "Status history", priority so it appears after History (e.g. 51).
3. Add i18n keys for tab label and empty state.
4. Run `yarn generate` (or equivalent) so the new widget is discovered.

### Phase 3: Integration coverage
1. Integration test: open order (or quote) detail, ensure "Status history" tab is present; open tab, change order status via API or UI, reload or refetch, assert status transition appears in Status history tab. (Per AGENTS.md: integration tests self-contained with fixtures; clean up in teardown.)

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/modules/sales/api/document-history/route.ts` | Modify | Apply `types` filter to `items` before response |
| `packages/core/src/modules/sales/widgets/injection/document-status-history/widget.ts` | Create | Widget metadata, id |
| `packages/core/src/modules/sales/widgets/injection/document-status-history/widget.client.tsx` | Create | Tab content: fetch with types=status, timeline UI |
| `packages/core/src/modules/sales/widgets/injection-table.ts` | Modify | Register new widget for order and quote tabs |
| `packages/core/src/modules/sales/i18n/...` (or app locale files) | Modify | Tab label and empty state strings |
| `packages/core/src/modules/sales/api/__tests__/document-history.test.ts` (or new) | Modify/Create | Test types=status filtering |

## Risks & Impact Review

### Data Integrity / Cascading / Tenant / Migration / Operational
- **Read-only feature**: No writes; no new entities; no migrations. Risk is low.
- **API change**: Optional query param; backward-compatible. Clients that omit `types` see no change.
- **Blast radius**: Limited to sales document detail page (one new tab). If the new widget fails, only that tab fails; rest of page and History tab unaffected.

### Risk Register

#### Server-side types filter mis-parsing
- **Scenario**: Invalid or empty `types` value leads to returning no items or wrong subset.
- **Severity**: Low
- **Affected area**: GET document-history when `types` is used
- **Mitigation**: Parse `types` strictly (e.g. allow only `status`, `action`, `comment`); unknown values ignored or treat as no filter. Default when `types` is empty string: no filter.
- **Residual risk**: Minor UX if a typo in types yields empty list; acceptable.

## Final Compliance Report — 2026-03-02

### AGENTS.md Files Reviewed
- Root `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/sales/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM between modules | Compliant | No new entities; uses existing audit_logs + sales |
| root AGENTS.md | Filter by organization_id | Compliant | document-history already scoped |
| packages/core/AGENTS.md | API routes MUST export openApi | Compliant | document-history already has openApi |
| packages/core/AGENTS.md | Widget injection in injection-table | Compliant | New widget registered in injection-table.ts |
| sales AGENTS.md | Use sales module for orders/quotes | Compliant | Feature is within sales module |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No new models; API returns existing HistoryEntry shape |
| API contracts match UI/UX | Pass | types=status → status-only list; widget consumes it |
| Risks cover all write operations | Pass | No write operations |
| Commands defined for all mutations | N/A | No mutations |

### Non-Compliant Items
None.

### Verdict
**Fully compliant** — ready for implementation.

## Implementation Status (2026-03-09)

- **API:** `GET /api/sales/document-history` supports `types` query; `parseDocumentHistoryTypes()` filters `items` by `entry.kind`. Unit tests in `document-history.test.ts`. Creation logs count as status entries (`historyHelpers.detectStatusChange`).
- **UI:** No dedicated tab. Use **History** tab with "Status changes" filter. Widget `document-status-history` and tab registration removed; statusHistory i18n keys removed; TC-SALES-024 removed.

## Changelog

### 2026-03-09
- **Cleanup:** Removed dedicated Status history tab; use History tab + "Status changes" filter. Deleted `document-status-history` widget, TC-SALES-024, statusHistory i18n, synthetic fallback in document-history route. Kept API `types` filter and creation-as-status in historyHelpers for History filter.
- Implementation: API types filter, creation-as-status-entry in historyHelpers.

### 2026-03-02
- Initial specification: dedicated Status history tab, API types filter, new injection widget.
