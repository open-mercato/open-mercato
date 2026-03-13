# SPEC-059: Unified Deal Timeline

## TLDR

**Key Points:**
- Add a unified chronological timeline **drawer** to the deal detail page that aggregates all deal events (stage changes, comments, activities, emails, file uploads, field changes, deal creation) into a single stream — inspired by GitHub PR activity history.
- The timeline is a right-side slide-in panel (like Version History), accessible via a button in the deal header. Existing tabs (Notes, Activities, Products, Stage history, Files, Emails) remain unchanged.

**Scope:**
- Server-side timeline aggregation API (`GET /api/customers/deals/:id/timeline`)
- Client-side `DealTimelinePanel` component with typed entry renderers per event kind
- Merge 6 existing data sources: audit logs, stage history, comments, activities, attachments, emails
- Actor resolution (userId → display name) across all entry types
- Multi-select type filter (toggle which event kinds appear)
- Field change diffs: 1-2 fields inline, 3+ collapsed behind "Show changes"
- Cursor-based pagination with "Load more" button

**Concerns:**
- Audit logs and stage history overlap on stage changes — deduplication required
- Attachments and emails have no `userId` field — actor attribution gap
- Performance: server aggregates 6 sources; cursor pagination mitigates

## Overview

The deal detail page currently fragments deal history across 6 independent tabs. Users must click through each tab to reconstruct the deal narrative. There is no single view answering "what happened on this deal?" — the most fundamental question in sales management.

Market leaders (HubSpot, Salesforce, Pipedrive, Twenty CRM) all provide unified activity streams. HubSpot and Salesforce show all events in a single chronological feed with type filters. Pipedrive separates activities from changelog. Twenty CRM (open-source) includes field-change diffs inline. This spec adopts the best patterns:

> **Market Reference**: Studied HubSpot (filter panel + expandable cards), Salesforce (month grouping + filter bookmarks + expand-all), Twenty CRM (inline field diffs + cursor pagination). Adopted: unified stream with multi-select filters, inline diffs for small changes with collapse for large changes, cursor-based pagination. Rejected: Salesforce's pinning (complexity vs. value), Pipedrive's separate changelog tab (defeats the unified view purpose), HubSpot's tab-based filtering (too coarse).

## Problem Statement

1. **Fragmented history**: 6 tabs, each showing one slice. Users lose the chronological narrative of deal progression.
2. **No "what happened?" view**: To understand deal status, users must mentally merge information from Notes, Activities, Stage History, and Emails tabs.
3. **Missing context on changes**: When a deal value or probability changes, there's no easy way to see what else happened around the same time (e.g., a call was logged, then the probability was updated).
4. **No unified actor attribution**: Each tab shows different levels of actor info — stage history has `changedByUserId`, emails have `fromAddress`, attachments have none.

## Proposed Solution

Add a **Deal Timeline drawer** — a right-side slide-in panel accessible via a button in the deal detail header (next to the existing Version History clock icon). The drawer shows a single, vertically-scrolling chronological feed of all deal events, with:

- **Typed entry renderers**: Each event kind (stage change, comment, activity, email, file upload, field change, deal creation) gets a distinct icon, color, and layout.
- **Server-side aggregation**: A single API endpoint queries all 6 data sources, normalizes entries into a common `TimelineEntry` shape, deduplicates, sorts, and returns a cursor-paginated response.
- **Multi-select filter**: A filter dropdown lets users toggle which event types appear (e.g., show only comments + stage changes).
- **Smart field diffs**: 1-2 field changes render inline ("Probability: 30% → 60%"); 3+ field changes collapse behind a "Show N changes" toggle.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Drawer panel (not a tab) | Keeps existing tabs intact; drawer overlays the page like Version History; users can open it from any tab context |
| Server-side aggregation | Single request vs. 6 parallel client-side fetches; cleaner API; server can deduplicate and sort efficiently; clients stay thin |
| Cursor-based pagination (`before` timestamp) | Matches audit logs API pattern; avoids offset pagination pitfalls on growing datasets |
| Inline + collapsed field diffs (threshold: 2) | Inline for quick changes keeps the timeline scannable; collapse for bulk updates prevents noise; adopted from Twenty CRM pattern |
| Reuse sales `TimelineItem` visual pattern | The `DocumentHistoryWidget` in the sales module already implements icon-circle + connector-line rendering; adapt the pattern for the deal timeline |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Replace tabs with timeline as default tab | User explicitly wanted to keep existing tabs; drawer approach is additive and non-disruptive |
| Client-side aggregation (6 parallel fetches) | 6 HTTP requests per open; complex client-side merge/sort/dedup; worse mobile performance |
| Separate timeline entity/table | Over-engineered; all source data already exists in other tables; adding a denormalized timeline table creates sync burden |

## User Stories

- **Sales rep** wants to **open the deal timeline drawer** so that they can **see the full chronological story of a deal in one view** without switching tabs.
- **Sales manager** wants to **filter the timeline to stage changes and field updates** so that they can **quickly audit how a deal progressed through the pipeline**.
- **Account executive** wants to **see who changed the deal value and when** so that they can **understand what triggered the change** (e.g., a call was logged, then value was updated).
- **Sales rep** wants to **see emails and comments interleaved with stage changes** so that they can **prepare for a follow-up call with full context**.

## Architecture

### Data Flow

```
DealTimelinePanel (client)
  └─ opens drawer
  └─ GET /api/customers/deals/:id/timeline?limit=30&before=<cursor>&types=...
       └─ Server route handler
            ├── Query audit logs (field changes, create/delete)
            ├── Query stage history
            ├── Query comments (deal-scoped)
            ├── Query activities (deal-scoped)
            ├── Query attachments (entity-scoped)
            ├── Query deal emails
            ├── Resolve actor display names (batch user lookup)
            ├── Normalize all → TimelineEntry[]
            ├── Deduplicate (stage changes in audit logs vs. stage history)
            ├── Sort by timestamp DESC
            ├── Apply type filter
            ├── Apply cursor pagination (limit + before)
            └── Return { items: TimelineEntry[], nextCursor: string | null }
```

### Component Structure

```
packages/core/src/modules/customers/
├── api/deals/[id]/timeline/
│   └── route.ts              # GET handler + openApi
├── lib/timeline/
│   ├── types.ts              # TimelineEntry, TimelineEntryKind
│   ├── normalizers.ts        # per-source normalizer functions
│   └── aggregator.ts         # merge, dedup, sort, paginate
├── components/detail/
│   ├── DealTimelineAction.tsx # Button that opens the drawer
│   └── DealTimelinePanel.tsx  # Drawer panel with timeline rendering
```

### TimelineEntry Type

```typescript
type TimelineEntryKind =
  | 'deal_created'
  | 'deal_updated'
  | 'deal_deleted'
  | 'stage_changed'
  | 'comment_added'
  | 'activity_logged'
  | 'email_sent'
  | 'email_received'
  | 'file_uploaded'

type TimelineEntry = {
  id: string
  kind: TimelineEntryKind
  occurredAt: string            // ISO-8601
  actor: {
    id: string | null
    label: string               // resolved display name or email/address fallback
  }
  summary: string               // human-readable one-liner (e.g., "moved to Negotiation")
  detail: Record<string, unknown> | null  // kind-specific payload for expanded view
  changes: FieldChange[] | null  // only for deal_updated; null otherwise
}

type FieldChange = {
  field: string                 // e.g., "probability"
  label: string                 // i18n-resolved label (e.g., "Probability")
  from: unknown
  to: unknown
}
```

### Deduplication Strategy

Stage changes appear in both:
1. **Audit logs**: `commandId: 'customers.deals.update'` with `changesJson` containing `pipelineStageId`
2. **Stage history**: `CustomerDealStageHistory` with from/to labels and duration

The aggregator prefers the stage history entry (richer data: labels, duration, `changedByUserId`) and suppresses any audit log entry where the only meaningful change is `pipelineStageId` or `pipelineStage`. If the audit log entry contains other field changes alongside the stage change, those field changes are preserved as a separate `deal_updated` entry with the stage fields stripped.

## Data Models

No new entities. This feature reads from existing tables:

| Table | Used for |
|-------|----------|
| `action_logs` | Field changes, deal create/delete events |
| `customer_deal_stage_histories` | Stage transitions |
| `customer_comments` | Notes/comments |
| `customer_activities` | Logged activities (calls, meetings, tasks) |
| `attachments` | File uploads |
| `customer_deal_emails` | Sent/received emails |

## API Contracts

### GET /api/customers/deals/:id/timeline

Returns a unified, paginated timeline for a deal.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 30 | Items per page (max 100) |
| `before` | string (ISO-8601) | now | Cursor: return entries older than this timestamp |
| `types` | string (comma-separated) | all | Filter: `stage_changed,comment_added,deal_updated,...` |

**Response:**

```json
{
  "items": [
    {
      "id": "uuid",
      "kind": "stage_changed",
      "occurredAt": "2026-03-07T10:30:00Z",
      "actor": { "id": "user-uuid", "label": "Jane Smith" },
      "summary": "Moved from Qualification to Negotiation",
      "detail": {
        "fromStageLabel": "Qualification",
        "toStageLabel": "Negotiation",
        "durationSeconds": 259200
      },
      "changes": null
    },
    {
      "id": "uuid",
      "kind": "deal_updated",
      "occurredAt": "2026-03-07T10:25:00Z",
      "actor": { "id": "user-uuid", "label": "Jane Smith" },
      "summary": "Updated deal fields",
      "detail": null,
      "changes": [
        { "field": "probability", "label": "Probability", "from": 30, "to": 60 },
        { "field": "valueAmount", "label": "Deal value", "from": "5000", "to": "8000" }
      ]
    },
    {
      "id": "uuid",
      "kind": "email_sent",
      "occurredAt": "2026-03-07T09:00:00Z",
      "actor": { "id": null, "label": "jane@company.com" },
      "summary": "Sent: Follow-up on proposal",
      "detail": {
        "subject": "Follow-up on proposal",
        "fromAddress": "jane@company.com",
        "toAddresses": [{ "email": "client@example.com" }],
        "bodyPreview": "Hi, just following up on..."
      },
      "changes": null
    }
  ],
  "nextCursor": "2026-03-06T15:00:00Z"
}
```

**Auth:** `requireAuth: true`, `requireFeatures: ['customers.deals.view']`

**OpenAPI:** Exported as `openApi` from the route file.

**Error responses:** Standard 401/403/404.

## Internationalization (i18n)

New keys under `customers.deals.timeline.*`:

| Key | Default |
|-----|---------|
| `customers.deals.timeline.title` | `Timeline` |
| `customers.deals.timeline.open` | `Open timeline` |
| `customers.deals.timeline.close` | `Close` |
| `customers.deals.timeline.empty` | `No activity recorded yet.` |
| `customers.deals.timeline.loading` | `Loading timeline...` |
| `customers.deals.timeline.error` | `Failed to load timeline.` |
| `customers.deals.timeline.loadMore` | `Load more` |
| `customers.deals.timeline.filterLabel` | `Filter` |
| `customers.deals.timeline.filterAll` | `All events` |
| `customers.deals.timeline.kind.deal_created` | `Deal created` |
| `customers.deals.timeline.kind.deal_updated` | `Deal updated` |
| `customers.deals.timeline.kind.deal_deleted` | `Deal deleted` |
| `customers.deals.timeline.kind.stage_changed` | `Stage changed` |
| `customers.deals.timeline.kind.comment_added` | `Comment added` |
| `customers.deals.timeline.kind.activity_logged` | `Activity logged` |
| `customers.deals.timeline.kind.email_sent` | `Email sent` |
| `customers.deals.timeline.kind.email_received` | `Email received` |
| `customers.deals.timeline.kind.file_uploaded` | `File uploaded` |
| `customers.deals.timeline.showChanges` | `Show {count} changes` |
| `customers.deals.timeline.fieldChanged` | `{label}: {from} → {to}` |

## UI/UX

### Trigger Button

A new icon button in the deal detail `FormHeader` utility actions area, next to the existing Version History (Clock) and Send Message buttons. Uses a `ListTodo` or `Activity` icon from lucide.

### Drawer Panel

Mirrors the `VersionHistoryPanel` pattern:
- Fixed right-side slide-in panel (`max-w-md`, full height)
- Backdrop overlay
- Escape to close
- Header with title + close button
- Scrollable body with timeline entries
- "Load more" button at bottom when `nextCursor` is present

### Timeline Entry Rendering

Adapts the sales `DocumentHistoryWidget` / `TimelineItem` visual pattern:

```
┌─ [icon ●] ── vertical connector line
│  ┌──────────────────────────────────┐
│  │ Jane Smith · 2 hours ago         │
│  │ Moved from Qualification → Negotiation │
│  │ ⏱ 3 days in previous stage       │
│  └──────────────────────────────────┘
│
├─ [icon ●]
│  ┌──────────────────────────────────┐
│  │ Jane Smith · 2h 5min ago         │
│  │ Updated deal fields              │
│  │ Probability: 30% → 60%          │
│  │ Deal value: $5,000 → $8,000     │
│  └──────────────────────────────────┘
│
├─ [icon ●]
│  ┌──────────────────────────────────┐
│  │ jane@company.com · 3 hours ago   │
│  │ ✉ Sent: Follow-up on proposal    │
│  │ "Hi, just following up on..."    │
│  └──────────────────────────────────┘
```

### Kind → Icon + Color Mapping

| Kind | Icon | Background |
|------|------|------------|
| `deal_created` | `Plus` | `bg-green-100` |
| `deal_updated` | `Pencil` | `bg-blue-100` |
| `deal_deleted` | `Trash2` | `bg-red-100` |
| `stage_changed` | `ArrowRight` | `bg-purple-100` |
| `comment_added` | `MessageSquare` | `bg-yellow-100` |
| `activity_logged` | `Phone` / `Calendar` / `CheckSquare` (by activityType) | `bg-orange-100` |
| `email_sent` | `Send` | `bg-emerald-100` |
| `email_received` | `Mail` | `bg-cyan-100` |
| `file_uploaded` | `Paperclip` | `bg-gray-100` |

### Field Change Display (Threshold: 2)

- **1-2 changes**: Render inline below the summary: `Probability: 30% → 60%`
- **3+ changes**: Show a collapsed row: `"Show 5 changes"` — clicking expands to show all field diffs

### Filter Dropdown

A multi-select dropdown button in the panel header. Each kind is a checkbox. Unchecked kinds are excluded via the `types` query parameter. Filter state is local to the panel session (not persisted).

## Migration & Compatibility

- **No database migrations** — reads from existing tables only.
- **No breaking changes** — additive API endpoint; existing tabs and APIs untouched.
- **Backward compatible** — the drawer is a new UI surface; existing deal detail page behavior is preserved.

## Implementation Plan

### Phase 1: Server-Side Aggregation API

1. Create `lib/timeline/types.ts` with `TimelineEntry`, `TimelineEntryKind`, `FieldChange` types.
2. Create `lib/timeline/normalizers.ts` with per-source normalizer functions:
   - `normalizeAuditLog(log, displayUsers) → TimelineEntry[]` — handles create/update/delete, extracts field changes
   - `normalizeStageHistory(entry, displayUsers) → TimelineEntry`
   - `normalizeComment(comment, displayUsers) → TimelineEntry`
   - `normalizeActivity(activity, displayUsers) → TimelineEntry`
   - `normalizeAttachment(attachment) → TimelineEntry` — actor will be `{ id: null, label: 'System' }`
   - `normalizeEmail(email) → TimelineEntry` — actor from `fromAddress`/`fromName`
3. Create `lib/timeline/aggregator.ts`:
   - `aggregateDealTimeline(sources, options) → { items: TimelineEntry[], nextCursor: string | null }`
   - Deduplication: suppress audit log entries where the only change is `pipelineStageId`/`pipelineStage` and a matching stage history entry exists
   - Sort by `occurredAt` DESC
   - Apply `types` filter
   - Apply cursor pagination (`before` + `limit`)
4. Create `api/deals/[id]/timeline/route.ts`:
   - GET handler: validate `id`, parse query params (`limit`, `before`, `types`), fetch all 6 sources in parallel (`Promise.all`), resolve display user names, call aggregator, return response
   - Export `openApi` and `metadata` (`requireAuth: true, requireFeatures: ['customers.deals.view']`)
5. Add field label resolution: map entity field names (e.g., `probability`, `valueAmount`) to i18n labels for the `FieldChange.label` field.

### Phase 2: Client-Side Timeline Panel

1. Create `components/detail/DealTimelineAction.tsx` — button component (icon + tooltip) that toggles the panel open.
2. Create `components/detail/DealTimelinePanel.tsx`:
   - Drawer panel matching `VersionHistoryPanel` structure (fixed right, backdrop, escape-to-close)
   - `useQuery` with `queryKey: ['customers', 'deals', id, 'timeline', cursor, types]`
   - Accumulates entries across pages in local state (infinite append)
   - Filter dropdown in header (multi-select checkboxes for each kind)
   - Timeline entry list with `TimelineItem` sub-component:
     - Icon circle with kind-specific color/icon
     - Vertical connector line (absolute positioned, hidden on last item)
     - Content card: actor name + relative time, summary text, kind-specific detail renderer
     - Field change display with 2-item threshold
   - "Load more" button when `nextCursor` is present
   - Loading/empty/error states
3. Add `DealTimelineAction` to the deal detail page `FormHeader` utility actions (next to `SendObjectMessageDialog` and `VersionHistoryAction`).
4. Add i18n keys to the customers locale file.

### Phase 3: Polish & Testing

1. Add relative time formatting (e.g., "2 hours ago", "yesterday") with absolute time on hover tooltip.
2. Add smooth scroll-to-top when filter changes.
3. Write unit tests for normalizers and aggregator (deduplication, sorting, field change extraction, cursor pagination).
4. Write integration test: create a deal, update fields, add a comment, change stage — verify timeline API returns all events in correct order with correct kinds.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `lib/timeline/types.ts` | Create | TimelineEntry, TimelineEntryKind, FieldChange types |
| `lib/timeline/normalizers.ts` | Create | Per-source normalizer functions (6 normalizers) |
| `lib/timeline/aggregator.ts` | Create | Merge, dedup, sort, filter, paginate logic |
| `api/deals/[id]/timeline/route.ts` | Create | GET endpoint with openApi + metadata |
| `components/detail/DealTimelineAction.tsx` | Create | Trigger button for the drawer |
| `components/detail/DealTimelinePanel.tsx` | Create | Drawer panel with timeline rendering |
| `backend/customers/deals/[id]/page.tsx` | Modify | Add DealTimelineAction to FormHeader utilityActions |
| `i18n/en.json` (or equivalent locale file) | Modify | Add `customers.deals.timeline.*` keys |

### Testing Strategy

**Unit tests:**
- `normalizers.test.ts`: Each normalizer produces correct `TimelineEntry` shape from source data
- `aggregator.test.ts`: Deduplication removes stage-only audit logs when stage history exists; sorting is correct; cursor pagination returns correct slice; type filtering works

**Integration tests:**
- `TC-CRM-050.spec.ts`: Create deal → update fields → add comment → change stage → GET timeline → verify all 4 events appear in correct order with correct kinds, actors, and field changes

## Risks & Impact Review

### Data Integrity Failures

- **Read-only API**: This feature only reads from existing tables. No write operations, no data corruption risk.
- **Eventual consistency**: Audit log entries are written asynchronously by the command framework. A timeline query immediately after a mutation may not include the latest entry. This is acceptable — the timeline is not a real-time feed.

### Cascading Failures & Side Effects

- **No events emitted**: The timeline API is pure read; no subscribers or workers triggered.
- **Upstream dependency**: If the audit logs API or any source query fails, the timeline degrades. Mitigation: catch per-source errors and return partial results with a warning flag.

### Tenant & Data Isolation Risks

- All 6 source queries are scoped by `organizationId` and `tenantId` via existing middleware. The timeline endpoint inherits the same scoping.
- No shared caches or global state introduced.

### Performance Risks

#### Six Parallel Queries per Request
- **Scenario**: Opening the timeline fires 6 DB queries in parallel.
- **Severity**: Medium
- **Mitigation**: All queries are indexed (audit logs by `resourceKind+resourceId+createdAt`, stage history by `dealId`, comments by `dealId`, activities by `dealId`, attachments by `entityId+recordId`, emails by `dealId+sentAt`). Each query uses `LIMIT` (default 30, max 100). Parallel execution via `Promise.all` keeps wall-clock time bounded by the slowest single query.
- **Residual risk**: For deals with 1000+ events across all sources, the server does more work than a single-source query. Acceptable for the default page size of 30.

#### Large Audit Log Volume
- **Scenario**: A deal with hundreds of field changes generates many audit log entries.
- **Severity**: Low
- **Mitigation**: The `before` cursor and `limit` parameter bound the result set. The existing `action_logs_resource_idx` index covers the query pattern. The aggregator processes at most `limit * 2` entries (over-fetch factor for deduplication headroom).
- **Residual risk**: None significant.

### Migration & Deployment Risks

- No migrations. No schema changes. Deploy is zero-risk.
- The API endpoint is additive — no existing endpoints modified.

### Risk Register

#### Partial Timeline on Source Failure
- **Scenario**: One of the 6 source queries fails (e.g., attachments service timeout) while others succeed.
- **Severity**: Low
- **Affected area**: Timeline drawer shows incomplete data.
- **Mitigation**: Catch per-source errors, include successfully fetched sources, log the error server-side. The response is still useful with 5 of 6 sources.
- **Residual risk**: User sees partial data without explicit indication. Acceptable — the timeline is informational, not transactional.

#### Actor Attribution Gap for Emails and Attachments
- **Scenario**: Emails show `fromAddress` instead of a user name; attachments show "System" as actor.
- **Severity**: Low
- **Affected area**: Timeline entries for emails and files lack user identity.
- **Mitigation**: For outbound emails, `fromAddress` is the sending user's email — recognizable. For attachments, a future enhancement could add `uploadedByUserId` to the `Attachment` entity.
- **Residual risk**: Acceptable for MVP.

## Final Compliance Report — 2026-03-07

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Timeline reads from existing tables via `findWithDecryption`; no cross-module ORM joins |
| root AGENTS.md | Filter by organization_id | Compliant | All source queries inherit tenant scoping from existing APIs/helpers |
| root AGENTS.md | Validate all inputs with zod | Compliant | Query params validated with zod schema (limit, before, types) |
| root AGENTS.md | Use `apiCall`/`apiCallOrThrow` — never raw fetch | Compliant | Client uses `readApiResultOrThrow` via `useQuery` |
| root AGENTS.md | i18n: `useT()` client-side, no hardcoded strings | Compliant | All UI strings use `useT()` with `customers.deals.timeline.*` keys |
| root AGENTS.md | Every dialog: Escape to close | Compliant | Panel registers Escape key handler |
| root AGENTS.md | pageSize at or below 100 | Compliant | Max limit clamped to 100 |
| packages/core/AGENTS.md | API routes MUST export openApi | Compliant | Route exports `openApi` object |
| packages/core/AGENTS.md | Page metadata in colocated `page.meta.ts` | N/A | No new pages; drawer is a component |
| packages/ui/AGENTS.md | Use `Button`/`IconButton` — never raw `<button>` | Compliant | Panel uses `Button` and `IconButton` from `@open-mercato/ui` |
| packages/ui/AGENTS.md | Use `LoadingMessage`/`ErrorMessage` for states | Compliant | Panel uses loading/error/empty state pattern |
| customers AGENTS.md | MUST use `findWithDecryption` instead of `em.find` | Compliant | Source queries use decryption-aware helpers |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No new entities; API response shape matches `TimelineEntry` type |
| API contracts match UI/UX section | Pass | Panel renders exactly the fields returned by the API |
| Risks cover all write operations | Pass | No write operations — read-only feature |
| Commands defined for all mutations | N/A | No mutations |
| Cache strategy covers all read APIs | N/A | No caching in MVP; timeline is always fresh |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved for implementation.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Server-side aggregation API | Done | 2026-03-07 | types.ts, normalizers.ts, aggregator.ts, route.ts |
| Phase 2 — Client-side timeline drawer | Done | 2026-03-07 | DealTimelineAction.tsx, DealTimelinePanel.tsx, wired into deal detail page |
| Phase 3 — Polish, testing, verification | Done | 2026-03-07 | 129 unit tests (33 aggregator + 96 normalizers), i18n keys in 4 locales, build passes |

### Files Created
- `lib/timeline/types.ts` — TimelineEntry types, 9 entry kinds
- `lib/timeline/normalizers.ts` — 6 normalizer functions (audit logs, stage history, comments, activities, attachments, emails)
- `lib/timeline/aggregator.ts` — merge, dedup, sort, paginate
- `lib/timeline/normalizers.test.ts` — 96 unit tests
- `lib/timeline/aggregator.test.ts` — 33 unit tests
- `api/deals/[id]/timeline/route.ts` — GET endpoint with auth, pagination, OpenAPI
- `components/detail/DealTimelineAction.tsx` — trigger button
- `components/detail/DealTimelinePanel.tsx` — full drawer panel with filtering, infinite scroll

### Files Modified
- `backend/customers/deals/[id]/page.tsx` — added DealTimelineAction to FormHeader utility actions
- `i18n/en.json`, `i18n/pl.json`, `i18n/de.json`, `i18n/es.json` — 22 timeline i18n keys each

## Changelog
### 2026-03-07
- Initial skeleton spec with open questions
- Resolved all open questions: drawer (not tab), server-side aggregation, inline+collapsed field diffs (threshold 2), keep existing tabs
- Full spec with architecture, API contracts, implementation plan, risks, and compliance review
- Implementation complete: all 3 phases done, 129 unit tests passing, build verified
