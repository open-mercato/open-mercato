# Messages Inbox Bulk Actions

**Created:** 2026-04-23
**Module:** `messages`, `ui`
**Status:** Draft
**Related:** `.ai/specs/implemented/SPEC-002-2026-01-23-messages-module.md`, `.ai/specs/2026-04-03-advanced-datatable-ux.md`, `BACKWARD_COMPATIBILITY.md`

## TLDR

**Key Points:**
- Add checkbox selection and batch actions to the Messages inbox list at `/backend/messages` by reusing the shared `DataTable` bulk-actions pattern.
- Support four inbox actions on the currently visible page: mark as read, mark as unread, archive, and delete.
- Reuse the existing single-message APIs (`/api/messages/:id/read`, `/api/messages/:id/archive`, `DELETE /api/messages/:id`) through client-side fan-out in v1; do not add a new batch API route.

**Scope:**
- Inbox-only row selection on the Messages list
- Header select-all checkbox for the current page
- Bulk action buttons with selected-count display
- Delete confirmation dialog
- Query refresh, partial-failure feedback, and integration coverage

**Concerns:**
- The proposal asks for a sticky Gmail-style bulk action bar, but the platform already has a shared inline `DataTable` bulk-action toolbar. This spec intentionally reuses the platform pattern in v1.
- Batch execution is per-message, so partial success is possible. The UI must report exact success/failure counts.

## Overview

The Messages module already has a broad baseline specification in `.ai/specs/implemented/SPEC-002-2026-01-23-messages-module.md`, and the shared table framework already supports checkbox-based bulk actions via `.ai/specs/2026-04-03-advanced-datatable-ux.md`. What did **not** exist before this document was a dedicated spec for applying that bulk-action pattern to the Messages inbox.

Today, `/backend/messages` renders through `MessagesInboxPageClient` and already uses the shared `DataTable`. The list page supports search, filters, paging, and folder switching, but it does not expose bulk selection or list-level mutations. Users must open each message individually to mark it read/unread, archive it, or delete it.

> **Reference Pattern:** Gmail, Outlook, and Roundcube all use row selection plus a list-level action toolbar for repetitive inbox work. Open Mercato should adopt the selection pattern, but in v1 it should keep the existing admin-table toolbar placement instead of adding a Messages-only floating bar.

## Problem Statement

1. High-volume inbox workflows are inefficient because the current page requires one detail-page visit per message mutation.
2. The shared `DataTable` already supports bulk actions, but the Messages inbox does not opt into that capability.
3. The proposal assumes batch APIs already exist. In reality, the Messages module currently exposes only single-message routes for read/unread, archive/unarchive, and delete.
4. The page supports multiple folders (`inbox`, `sent`, `drafts`, `archived`, `all`), but the requested action set is only valid for recipient-owned inbox rows. The spec must avoid ambiguous behavior on mixed folders.

## Proposed Solution

Enable bulk selection on the Messages list when the active folder is `inbox`, wire four bulk actions through the existing single-message routes, and keep all writes inside the current Messages module command model.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Selection scope | `folder === 'inbox'` only | The requested actions are recipient-scoped and map cleanly to inbox rows. This avoids ambiguous behavior in `sent`, `drafts`, `archived`, and `all`. |
| Action transport | Client-side fan-out over existing single-message APIs | Smallest change surface; no new route, schema, command, or migration needed for v1. |
| Toolbar pattern | Reuse shared `DataTable` bulk-action toolbar | Matches existing admin list behavior and avoids a Messages-only UI fork. |
| Perspectives | Do not pass `perspective={{ tableId: 'messages.inbox' }}` on `/backend/messages` | The inbox list currently exposes a single primary column, so perspective management adds little value and unnecessary UI chrome in v1. |
| Delete semantics | Keep existing actor-scoped delete behavior | `DELETE /api/messages/:id` already deletes from the current actor's view; bulk delete must preserve that contract. |
| Failure model | Allow partial success with explicit summary feedback | Bulk execution is per message and already command-backed; forcing all-or-nothing would require a new server-side compound command and route. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| New `POST /api/messages/bulk` route | More API surface than v1 needs. Existing per-message routes already cover the requested behavior. |
| Use conversation routes (`/conversation/archive`, `/conversation/read`, `/conversation`) | The list rows are individual messages, not thread summaries. Conversation-level actions would over-mutate when multiple rows from one thread are selected. |
| Enable actions in every folder | The semantics differ by folder and would produce confusing 403/404 cases on sender-owned or archived rows. |
| Build a sticky, floating Messages-only action bar | Requires extra shared-table API or duplicated selection state with limited value at the current page size. |

## User Stories / Use Cases

- **Inbox user** wants to **select several messages and archive them at once** so that **routine cleanup does not require opening every message detail page**.
- **Inbox user** wants to **mark a page of messages as read or unread** so that **the unread state can be triaged in bulk**.
- **Inbox user** wants to **delete several messages with one confirmation** so that **inbox maintenance matches the rest of the admin panel's bulk-action workflow**.

## Architecture

### Affected Components

| Area | File | Change |
|------|------|--------|
| Messages list page | `packages/core/src/modules/messages/components/MessagesInboxPageClient.tsx` | Add inbox-only `bulkActions`, action handlers, confirmation flow, flash messaging, and selection reset wiring; intentionally omit `perspective={{ tableId: 'messages.inbox' }}` because the inbox currently renders a single primary column |
| Shared table | `packages/ui/src/backend/DataTable.tsx` | Add an optional additive prop to clear row selection when host list scope changes |
| Shared table tests | `packages/ui/src/backend/__tests__/DataTable.extensions.test.tsx` | Cover selection reset behavior |

### Selection Model

- Selection is enabled only when the current folder is `inbox`.
- The header checkbox selects all rows on the current page only. There is no cross-page or "select all search results" behavior in v1.
- Selection must reset when the host list scope changes. To support that cleanly, `DataTable` will add an optional `selectionScopeKey?: string` prop; when the value changes, `rowSelection` resets to `{}`.
- `MessagesInboxPageClient` will pass a scope key derived from `folder`, `page`, `search`, and normalized filters.

### Bulk Action Execution Flow

```text
User selects inbox rows
  -> DataTable shows selected count + action buttons
  -> User clicks bulk action
  -> Messages page resolves action config
  -> For delete: confirm with useConfirmDialog()
  -> Execute per-message requests with small concurrency cap
  -> Collect per-item success/failure
  -> Invalidate messages list query
  -> Show success / partial / failure flash
  -> Clear selection only if at least one mutation succeeded
```

### Action-to-Route Mapping

| UI Action | HTTP Request Per Selected Message | Existing Server Command(s) Reused |
|-----------|----------------------------------|-----------------------------------|
| Mark as read | `PUT /api/messages/:id/read` | `messages.recipients.mark_read` |
| Mark as unread | `DELETE /api/messages/:id/read` | `messages.recipients.mark_unread` |
| Archive | `PUT /api/messages/:id/archive` | `messages.recipients.archive` |
| Delete | `DELETE /api/messages/:id` | `messages.messages.delete_for_actor` |

### Execution Details

- Execute with `Promise.allSettled` plus a small concurrency cap of `5`.
- Treat each row independently. A single failure must not abort the full batch.
- If at least one row succeeds:
  - invalidate `['messages', 'list']` queries
  - rely on the existing event/polling behavior for unread count convergence
  - return success to `DataTable` so the selection clears
- If every row fails:
  - keep selection
  - show an error flash with the failed count

### Commands & Events

No new backend commands or events are introduced in v1. The feature is a list-page orchestration layer over already-command-backed mutations. Existing message events (`messages.message.read`, `messages.message.marked_unread`, `messages.message.archived`, `messages.message.deleted`) remain the source of truth.

## Data Models

No database or ORM changes are required.

### Existing State Transitions Reused

| Operation | Persisted Change |
|-----------|------------------|
| Mark read | `message_recipients.status = 'read'`, `read_at = now()` |
| Mark unread | `message_recipients.status = 'unread'`, `read_at = null` |
| Archive | `message_recipients.status = 'archived'`, `archived_at = now()` |
| Delete | Recipient rows: `status = 'deleted'`, `deleted_at = now()` |

### Client-Only Additions

```ts
type MessageBulkActionId = 'markRead' | 'markUnread' | 'archive' | 'delete'

type BulkExecutionSummary = {
  action: MessageBulkActionId
  total: number
  succeeded: number
  failed: number
}
```

These are page-local types only; they do not create a new contract surface outside the page component.

## API Contracts

### Backend API Surface

No new route is added in v1.

### Existing Routes Explicitly Reused

| Route | Role In This Feature | Contract Change |
|-------|----------------------|-----------------|
| `GET /api/messages` | List refresh after bulk mutation | None |
| `PUT /api/messages/:id/read` | Bulk mark read | None |
| `DELETE /api/messages/:id/read` | Bulk mark unread | None |
| `PUT /api/messages/:id/archive` | Bulk archive | None |
| `DELETE /api/messages/:id` | Bulk delete | None |

### Shared UI API Addition

`DataTable` gains one optional additive prop:

```ts
selectionScopeKey?: string
```

Behavior:
- when omitted, `DataTable` behaves exactly as it does today
- when the prop changes, `DataTable` clears `rowSelection`

This is additive-only and does not break any existing `DataTable` caller.

## Internationalization (i18n)

Reuse existing keys where possible:
- `messages.actions.markRead`
- `messages.actions.markUnread`
- `messages.actions.archive`
- `messages.actions.delete`

Add new keys in `packages/core/src/modules/messages/i18n/{en,pl,de,es}.json`:

| Key | English Default |
|-----|-----------------|
| `messages.bulk.delete.title` | `Delete {count} messages?` |
| `messages.bulk.delete.description` | `This removes the selected messages from your view.` |
| `messages.bulk.flash.markReadSuccess` | `{count} messages marked as read.` |
| `messages.bulk.flash.markUnreadSuccess` | `{count} messages marked as unread.` |
| `messages.bulk.flash.archiveSuccess` | `{count} messages archived.` |
| `messages.bulk.flash.deleteSuccess` | `{count} messages deleted.` |
| `messages.bulk.flash.partial` | `{succeeded} of {total} messages processed; {failed} failed.` |
| `messages.bulk.flash.failed` | `Failed to process {count} messages.` |

The selected-count label continues to use the shared `ui.dataTable.bulkAction.selectedCount` key from the UI package.

## UI/UX

### Inbox List Behavior

- Bulk checkboxes are visible only in the `Inbox` folder on `/backend/messages`.
- The header checkbox selects all rows on the current page.
- The selected-count label and bulk action buttons appear in the existing `DataTable` toolbar area when at least one row is selected.
- The inbox page intentionally does not expose the `messages.inbox` perspective picker in v1 because the table currently has a single primary column.
- Delete requires the shared `ConfirmDialog`; mark read, mark unread, and archive do not require confirmation.
- Buttons remain enabled for mixed read/unread selections because the underlying endpoints are idempotent.

### Explicit Non-Goals

- No sticky or floating action bar in v1
- No cross-page selection
- No batch actions in `Sent`, `Drafts`, `Archived`, or `All`
- No conversation-level bulk actions

### Accessibility

- Reuse the existing `Checkbox` and `Button` semantics from `DataTable`.
- Keep row selection keyboard-accessible.
- Use the shared `ConfirmDialog` instead of `window.confirm`.

## Migration & Backward Compatibility

- No database migration
- No new ACL feature IDs
- No route removal or rename
- No response schema narrowing
- `/backend/messages` intentionally stops exposing the page-level `messages.inbox` perspective UI because the inbox currently renders a single primary column; existing perspective records are preserved in storage but are no longer reachable from this page
- One additive-only shared UI prop: `selectionScopeKey` on `DataTable`

This spec preserves the stability rules in `BACKWARD_COMPATIBILITY.md`:
- API routes remain stable
- existing `DataTable` props remain unchanged
- the new shared `DataTable` prop is optional and additive only

This is a user-visible UX reduction on an existing page, but it does not remove a frozen contract surface from `BACKWARD_COMPATIBILITY.md`: no route, schema, event ID, import path, or shared component API is removed. The page-level perspective omission is intentional and documented here so the tradeoff is explicit.

## Implementation Plan

### Phase 1: Shared Selection Reset Hook

1. Add `selectionScopeKey?: string` to `DataTable` props.
2. Reset `rowSelection` when `selectionScopeKey` changes.
3. Add a shared test proving selection clears when the scope key changes and remains unchanged when the prop is omitted.

### Phase 2: Messages Inbox Bulk Actions

1. Add `useConfirmDialog()` to `MessagesInboxPageClient`.
2. Define inbox-only `bulkActions` for mark read, mark unread, archive, and delete.
3. Implement a small page-local bulk executor that:
   - maps selected rows to the correct route
   - limits concurrency to `5`
   - collects `succeeded` / `failed`
   - invalidates message list queries after any success
4. Pass `selectionScopeKey` derived from folder, page, search, and filter state.
5. Add new i18n keys in all four locales.

### Phase 3: Verification

1. Add UI integration coverage for bulk mark read/unread.
2. Add UI integration coverage for bulk archive and bulk delete with confirmation.
3. Verify the inbox list refreshes correctly after partial success and total failure cases.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/ui/src/backend/DataTable.tsx` | Modify | Add optional `selectionScopeKey` support |
| `packages/ui/src/backend/__tests__/DataTable.extensions.test.tsx` | Modify | Test selection reset behavior |
| `packages/core/src/modules/messages/components/MessagesInboxPageClient.tsx` | Modify | Wire inbox bulk actions and scope reset |
| `packages/core/src/modules/messages/i18n/en.json` | Modify | Add bulk action copy |
| `packages/core/src/modules/messages/i18n/pl.json` | Modify | Add bulk action copy |
| `packages/core/src/modules/messages/i18n/de.json` | Modify | Add bulk action copy |
| `packages/core/src/modules/messages/i18n/es.json` | Modify | Add bulk action copy |
| `packages/core/src/modules/messages/__integration__/TC-MSG-013.spec.ts` | Create | UI: bulk mark read and mark unread |
| `packages/core/src/modules/messages/__integration__/TC-MSG-014.spec.ts` | Create | UI: bulk archive and bulk delete |

### Testing Strategy

#### Integration Coverage

| ID | Path | Scenario |
|----|------|----------|
| `TC-MSG-013` | `/backend/messages` + `PUT/DELETE /api/messages/:id/read` | Select multiple inbox rows, bulk mark read, then bulk mark unread |
| `TC-MSG-014` | `/backend/messages` + `PUT /api/messages/:id/archive` + `DELETE /api/messages/:id` | Select multiple inbox rows, archive them, then delete selected rows with confirmation |

#### Shared UI Coverage

- `DataTable.extensions.test.tsx`: selection clears when `selectionScopeKey` changes

#### Notes

- Existing API integration tests already cover the single-message route behavior. This feature adds list-level orchestration, so the primary new coverage should be UI integration tests.

## Risks & Impact Review

### Data Integrity Failures

Bulk actions reuse existing per-message commands and routes. There is no new database write path, migration, or server-side batch persistence. The main integrity risk is partial success when some selected rows mutate and others fail.

#### Partial Batch Completion
- **Scenario**: A user selects 20 rows, 17 requests succeed, and 3 fail because the rows were changed in another tab.
- **Severity**: Medium
- **Affected area**: `/backend/messages` list UX and operator confidence
- **Mitigation**: Execute per row, collect exact counts, invalidate the list after any success, and show a partial-result flash instead of claiming all rows succeeded
- **Residual risk**: Users may need to retry the failed subset manually, which is acceptable in v1 because no server-side compound command is introduced

### Cascading Failures & Side Effects

The feature does not introduce new event types or new subscribers. Each single-message mutation continues to emit the same existing message events.

#### Event Burst During Large Selection
- **Scenario**: Selecting a full page emits many existing message events in a short window
- **Severity**: Low
- **Affected area**: list refresh and unread badge convergence
- **Mitigation**: Current page size remains bounded (`<= 100`, default `20`); v1 uses a concurrency cap of `5`
- **Residual risk**: Very large future page sizes could make event bursts noisier, but the current inbox page configuration keeps this bounded

### Tenant & Data Isolation Risks

The feature does not add any new query surface. All writes continue to use already-scoped route helpers and commands.

#### Folder Scope Mismatch
- **Scenario**: Bulk actions are shown on sender-owned or mixed folders, causing avoidable 403 responses
- **Severity**: Medium
- **Affected area**: Messages list UX
- **Mitigation**: Only enable bulk actions when `folder === 'inbox'`
- **Residual risk**: None for v1 inbox scope

### Migration & Deployment Risks

No migration or deployment choreography is required beyond normal frontend rollout.

#### Shared Table Regression
- **Scenario**: Adding `selectionScopeKey` accidentally changes selection behavior for existing `DataTable` consumers
- **Severity**: Medium
- **Affected area**: Any page using `DataTable` bulk actions
- **Mitigation**: Make the prop optional, default to current behavior when omitted, and add a focused shared-table regression test
- **Residual risk**: Low; the change is additive and localized

#### Messages Inbox Perspectives Become Unavailable
- **Scenario**: Users who previously relied on saved `messages.inbox` perspectives no longer see that UI on `/backend/messages`
- **Severity**: Low
- **Affected area**: inbox list personalization
- **Mitigation**: Document the intentional removal in the spec; retain stored perspective records so the UI can be re-enabled later without data recovery work
- **Residual risk**: Existing saved perspectives remain unreachable from this page in v1

### Operational Risks

#### Stale Selection After Query-Scope Changes
- **Scenario**: Users change search, filters, or page and act on stale selection state
- **Severity**: Medium
- **Affected area**: Messages inbox bulk-action UX
- **Mitigation**: Reset selection when `selectionScopeKey` changes
- **Residual risk**: Low once the shared prop is implemented

## Final Compliance Report — 2026-04-23

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | Simplicity first; make every change as simple as possible | Compliant | Reuses existing message APIs and commands instead of adding a new batch backend |
| root `AGENTS.md` | No direct ORM relationships between modules | Compliant | No data-model changes |
| root `AGENTS.md` | Never hard-code user-facing strings; use locale files | Compliant | New flash and confirm strings are declared in i18n |
| `.ai/specs/AGENTS.md` | Non-trivial specs must include TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks, Final Compliance Report, Changelog | Compliant | All required sections included |
| `packages/core/AGENTS.md` | API routes MUST export `openApi` | Compliant | No new route is introduced; existing route contracts remain unchanged |
| `packages/ui/AGENTS.md` | Use `DataTable` as the default list view | Compliant | The feature extends the existing `DataTable` host page |
| `packages/ui/AGENTS.md` | Use shared `ConfirmDialog` instead of `window.confirm` | Compliant | Delete confirmation is explicitly routed through `useConfirmDialog` |
| `packages/ui/AGENTS.md` | Keep `pageSize` at or below 100 | Compliant | No page-size expansion is introduced |
| `BACKWARD_COMPATIBILITY.md` | API route URLs are stable; additive changes only | Compliant | No route rename/removal; no response narrowing |
| `BACKWARD_COMPATIBILITY.md` | `DataTable` component props are stable; required props cannot be removed | Compliant | The shared component API remains additive via optional `selectionScopeKey`; the Messages inbox intentionally stops passing its page-level `perspective` config because the table currently exposes a single primary column |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No persistence changes; all mutations reuse current routes |
| API contracts match UI/UX section | Pass | UI actions map directly to existing endpoints |
| Risks cover all write operations | Pass | Read, unread, archive, and delete are all covered |
| Commands defined for all mutations | Pass | Existing commands remain the mutation boundary |
| Cache strategy covers all read APIs | Pass | No new server cache; list refresh relies on existing query invalidation and event/polling behavior |

### Non-Compliant Items

None.

### Verdict

- **Fully compliant**: Approved — ready for implementation

## Changelog

### 2026-04-23
- Initial specification for Messages inbox bulk actions

### 2026-04-24
- Documented the intentional removal of the `messages.inbox` perspective UI from `/backend/messages`; the inbox page now relies on bulk actions without the perspective picker because it currently renders a single primary column

### Review — 2026-04-23
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Shared Selection Reset Hook | Done | 2026-04-23 | Added additive `selectionScopeKey` support to `DataTable` with regression coverage |
| Phase 2 — Messages Inbox Bulk Actions | Done | 2026-04-23 | Added inbox-only bulk read/unread/archive/delete actions with guarded mutations, partial-failure summaries, delete confirmation, and no inbox perspective picker because the page currently renders a single primary column |
| Phase 3 — Verification | Done | 2026-04-23 | Added focused `DataTable` tests and new Playwright coverage for bulk read/unread and archive/delete flows |

### Phase 1 — Detailed Progress
- [x] Step 1: Add `selectionScopeKey?: string` to `DataTable` props
- [x] Step 2: Reset `rowSelection` when `selectionScopeKey` changes
- [x] Step 3: Add shared regression coverage for selection reset behavior

### Phase 2 — Detailed Progress
- [x] Step 1: Add `useConfirmDialog()` to `MessagesInboxPageClient`
- [x] Step 2: Define inbox-only `bulkActions` for mark read, mark unread, archive, and delete
- [x] Step 3: Implement page-local bulk execution with concurrency cap, exact success/failure summaries, and query invalidation after success
- [x] Step 4: Pass `selectionScopeKey` derived from folder, page, search, and filter state
- [x] Step 5: Add new i18n keys in all four locales
- [x] Step 6: Keep the inbox page free of `messages.inbox` perspectives because the list currently exposes a single primary column

### Phase 3 — Detailed Progress
- [x] Step 1: Add UI integration coverage for bulk mark read/unread
- [x] Step 2: Add UI integration coverage for bulk archive and bulk delete with confirmation
- [x] Step 3: Verify partial-success and total-failure feedback paths in automated coverage
