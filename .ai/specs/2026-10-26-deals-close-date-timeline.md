# Deals Close-Date Timeline

## 📝 TLDR

**Key Points:**
- Add a fourth **Timeline** tab to the backend Deals area (`Kanban | List | Map | Timeline`). It lays deals out by `expectedCloseAt` in a lanes × time-bucket grid: **owner** or **pipeline-stage** lanes against **week**, **month** or **quarter** columns. Each deal renders as a compact version of the Kanban `DealCard`. Clicking a card opens a **deal drawer** over the board (summary, review context and existing actions), so the review never leaves the timeline; the full details page is one link away.
- A new read-only endpoint, `GET /api/customers/deals/timeline`, returns the grid already bucketed, with exact per-column counts and the top cards per cell. A paged **cell mode** of the same endpoint backs the "+N more" popover. It reuses the deals-list filter builder, so filter semantics stay identical across views.
- Reps reschedule an open deal by dragging its card into another column (a whole-bucket shift) or through an explicit "Change close date" action in the deal drawer (opened from a card or a "+N more" row) with an exact-date dialog. The write is the existing `PUT /api/customers/deals` (`customers.deals.update` command) with optimistic locking. Undo comes from the shell's `LastOperationBanner`, and a 409 surfaces through `surfaceRecordConflict`.
- Saved views use the existing `perspectives` module (`tableId: customers.deals.timeline`). The deals list gains one additive filter, `hasExpectedCloseAt`, behind the timeline's "N deals have no close date" link. There are no new entities, no migrations and no new ACL features.

**Scope:** one spec, two independently shippable phases. **Phase 1** is the read-only timeline: endpoint, page, saved views and the undated link. **Phase 2** adds rescheduling: drag, the exact-date dialog and conflict handling.

**Input:** the approved story map and clickable prototype in `.ai/prototypes/deals-close-timeline/` (`REQUIREMENTS.md`, `index.html`), reviewed on PR #7999. Story IDs (US-A1…US-D5) below refer to that `REQUIREMENTS.md`. Where this spec and the story map differ, this spec wins; the story map has been aligned with it (date-then-id ordering, the closed-deals toggle, shell Undo, the explicit date action).

**Related specs:** `.ai/specs/implemented/2026-05-13-customers-deals-kanban-redesign.md` (filters, overdue rule, `DealCard`), `.ai/specs/2026-06-10-deals-map-view-tab.md` (sibling view-tab and endpoint precedent), `.ai/specs/2026-06-08-deals-list-redesign.md`, `.ai/specs/2026-10-18-deal-status-vocabulary.md` (tenant-configurable statuses).

**Concerns:**
- `customer_deals.expected_close_at` is `timestamptz` with no index. Bucketing is pinned to the UTC calendar date, and window queries rely on the `(organization_id, tenant_id)` index plus a range filter. The endpoint has a documented ceiling (see Risks).
- The deals **List** already has saved views through the DataTable's perspectives (`tableId: customers.deals.list`), but its payload is the DataTable shape (columns, sorting, filter values). The Kanban and Map have none (the Kanban's saved-views stub was removed from `CustomizeViewDialog.tsx`; the dialog itself remains). The timeline is the first non-table deals view with saved views, so this spec defines its own payload contract.

## 📝 Overview

Sales reps and managers plan around *when* deals close. The Deals area shows that date only as a list column, a Kanban card field and an "Overdue" subtitle. This feature adds a view built around the close date. It uses the same filters as the other deal views, and it lets users fix forecast dates in place during a pipeline review.

> **Market Reference:** **Pipedrive Forecast view** is the closest match: period columns (week, month or quarter), deal cards, and dragging between periods changes the expected close date. **Odoo CRM** groups its Kanban by expected-closing period and offers calendar and pivot views. **HubSpot Forecast** centres on reps and forecast categories.
> **Adopted from Pipedrive:** period columns rather than a continuous day axis, cards instead of bars, and drag-between-periods editing the date.
> **Rejected:**
> - **Gantt-style bars on a day axis.** It was prototyped first and dropped in review: a deal has a single close date, and bar width implies a duration that doesn't exist.
> - **Per-period value totals and forecast categories.** HubSpot and Pipedrive have them, but they need currency conversion and forecast semantics. They are out of scope for v1 (see Out of Scope).

## 📝 Problem Statement

- No view answers *"what is closing when, and whose is it?"* Reviews mean sorting the List by close date and scanning row by row, so slipped or bunched-up deals get missed.
- Updating forecast dates during a review means opening each deal's edit form.
- The Kanban shows *stage* progress but has no time dimension. The Map shows *place*. Neither shows *time*.
- The List has no way to find open deals that are missing a close date. Those deals silently drop out of any date-based forecast.

## 📝 Proposed Solution

1. **A timeline endpoint**, `GET /api/customers/deals/timeline`. It is a custom read-only sibling of `api/deals/map` and `api/deals/summary`, using the same scaffold. It:
   - validates the deals-list filter subset, reusing `dealListQuerySchema`/`buildDealListFilters`, plus the grid parameters (`bucket`, `from`, `columns`, `groupBy`, `perCell`);
   - runs one **light pass per column** (ids, lane key, close date and sort keys only, through the query engine): a single internal query with `pageSize = TIMELINE_COLUMN_CAP`, so each column costs one COUNT and one SELECT. Column passes run two at a time, and the results are grouped in memory into lane cells. `buildDealListFilters` runs **once** per request and its result is reused for every pass. Each column's `total` is the engine's total; in a capped column only the lane split is partial, and the column is flagged `truncated`. When the engine's own count cap (`OM_LIST_COUNT_CAP`) is hit, the total is a floor and the column's `countCapped` flag is set. The light pass sorts by `expected_close_at` and `id` only (no encrypted fields), so it never triggers the engine's plaintext-sort decryption path;
   - runs a **page-bounded heavy pass** that loads the deal rows (`title` is encrypted) and the primary company and primary person labels through `findWithDecryption`, for at most `perCell` deals per cell;
   - returns owner lanes as ids only. Names are resolved on the client the way the Kanban, List and Map already do (`fetchAssignableStaffMembers`, gated on `customers.roles.view`), so no names or emails reach users outside that gate;
   - adds the side data the view needs: overdue deals before the window, the undated count, and the nearest matching deals before and after the window;
   - in **cell mode** (`cellLane` + `cellColumn`), returns one cell's deals paged (`page`, `pageSize ≤ 100`) with the same filters, the exclusive column bound, and support for the no-owner (`__unassigned`) and no-stage (`__nostage:<pipelineId>`) lanes. The deals list API can express neither of those last two.
2. **A timeline page** at `/backend/customers/deals/timeline`. It shows:
   - `ViewTabsRow` (gaining the `timeline` view);
   - the Kanban/Map `FilterBarRow` with the existing popovers (Status, Pipeline, Owner, People, Companies);
   - a saved-views row (`perspectives`);
   - view controls (Group by, Columns, Prev/Today/Next);
   - the board of compact `TimelineDealCard`s.

   A "+N more" cell opens a popover listing that cell's deals, fetched through the endpoint's cell mode. Clicking a card or a popover row opens `TimelineDealDrawer`.
3. **Rescheduling (Phase 2).** Dropping a card into another column of the same lane shifts its date by whole buckets, through the pure helper `shiftCloseDate`. The page sends `PUT /api/customers/deals { id, expectedCloseAt }` through `useGuardedMutation`, with the `buildOptimisticLockHeader(updatedAt)` header. It applies the move optimistically, rolls back on failure, and calls `surfaceRecordConflict` on a 409. The command already records an undoable operation, so the shell's `LastOperationBanner` provides Undo. Day precision goes through an explicit **Change close date** action in the deal drawer, which opens an exact-date dialog; the drawer opens from a card or from a "+N more" popover row. Click and Enter on a card always open the deal drawer. Closed deals have neither drag nor the date action (see Design Decisions).
4. **The undated link.** `dealListQuerySchema` gains an additive `hasExpectedCloseAt` boolean, honoured by `buildDealListFilters`. The List page reads it from the URL, using the same pattern as `needsAttention`.
   - The List page restores only `search`, `personId`/`companyId`, `needsAttention` and the advanced-filter tree (`filter[...]`) from the URL; plain `status`, `ownerUserId` and `pipelineId` are ignored.
   - The link is therefore built by a shared helper, `buildDealsListHref(timelineFilters)`, which encodes Status, Owner and Pipeline as an advanced-filter tree, using the tree serializer the List page already deserializes. Search, people and companies go as plain params.
   - When `excludeClosed` is in effect (no Status filter chosen), the helper emits a `status` **`is_none_of`** condition over the same closed set the endpoint uses (`CLOSED_DEAL_STATUS_LIST` expanded through `expandDealStatusAliases`). The `select` operator set in `packages/shared/src/lib/query/advanced-filter.ts` supports it, and the List already exposes `status` as an advanced-filter field. Without it, closed undated deals would appear in the List while `undatedCount` excludes them.
   - This makes the List rows match `undatedCount`.
5. **Context preservation across views and forms.**
   - **List → Timeline:** the Timeline tab doesn't take filters from the List, the same as the Kanban and Map tabs today (`ViewTabsRow` links have no parameters). The List's advanced-filter tree can hold conditions the timeline's chips can't show, such as "Owner is not …", so carrying only some of them would change their meaning. The timeline opens with its own state: its URL, or the user's saved view, or the defaults.
   - **Timeline → create form:** "New deal" passes the full current timeline URL (window, grouping, bucket and filters) as `returnTo`. The create page's existing `resolveReturnTo` already accepts any `/backend/customers/deals…` path, so saving or cancelling returns to the same review.
   - **Timeline → List:** the undated link and the truncation "Open in List" link go through `buildDealsListHref`, as above.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Bucketed grid (week, month or quarter columns), no day axis** | Review feedback on the prototype: a close date is a single point, and day-axis bars implied durations. Buckets match how forecasts are discussed ("this week", "Q4"). |
| **New aggregated endpoint (Q2b)** rather than paging through the list API | Exact "+N more" counts and lane totals at any volume, and one round trip per window. Reusing `buildDealListFilters` keeps filter semantics identical to List, Kanban and Map. |
| **Per-column light pass, then page-bounded heavy pass** | Follows the Map endpoint precedent. Counts need only ids and keys, while decryption and company lookups are bounded by `lanes × columns × perCell`. Capping per column means hitting a cap degrades only that column's lane split. A single ordered pass would silently drop the later columns. |
| **Cell popover is a paged mode of the timeline endpoint** | The list API can't express the popover. `expectedCloseAtTo` is inclusive (`$lte`), so a deal at a bucket boundary would appear in two cells. `ownerUserId` drops `__unassigned`, so the Unassigned popover would return every owner's deals. Cell mode reuses the same filter path and bucket arithmetic, so the popover matches the cell's `total` whenever the column isn't truncated. In a truncated column the grid shows partial counts as "{n}+", and the popover's exact total is authoritative. |
| **Weeks start on Monday (ISO), whatever the locale (Q3a)** | Matches the prototype and keeps bucket keys stable for saved views and URLs. Locale-dependent weeks would also make server buckets depend on the client. |
| **Bucketing by the UTC calendar date of `expected_close_at`** | The column is `timestamptz`. The deal form submits `YYYY-MM-DD`, which is coerced to UTC midnight. `dealsMetrics` already uses UTC quarter windows for the same reason. |
| **Writes reuse `PUT /api/customers/deals`** | The route already enforces optimistic locking (in the CRUD factory and mutation-guard layer, `shared/lib/crud/factory.ts`), and the `customers.deals.update` command already does audit and undo, and emits events. A dedicated reschedule endpoint would duplicate it. |
| **Undo comes from `LastOperationBanner`**, not a timeline-specific Undo | The shell already offers Undo for the last command through its audit-log undo token. A second Undo control would be inconsistent with the Kanban. |
| **Saved views via `perspectives` (Q4b)** | The module stores per-user views by `tableId`, and `settings.filters` is a free-form record, so timeline state fits with no schema change. The List already uses perspectives through the DataTable; the Kanban and Map never shipped saved views. The timeline doesn't reuse the List's payload, because that shape describes table columns, sorting and the advanced-filter tree, none of which exist on the board, while the timeline needs `groupBy` and `bucket`, which the table has no slot for. |
| **The window position is not saved** | A saved view is "My Q4 review", not "the week of Oct 19". Views always reopen anchored on today. The URL carries `from` so a link can be shared. |
| **Deal drawer instead of navigating to the details page** | A review touches many deals; navigating away loses the window and scroll position, and the compact card drops the Kanban's activity and stage signals. The drawer (the `Drawer` primitive from `@open-mercato/ui`, already used by `forms`' `SubmissionDrawer`) restores that context in place. It is deliberately a **summary plus existing actions, not the edit form**: embedding the form would reopen close-date edits on closed deals (see the closed-deals decision) and duplicate the details page. The open deal lives in the URL (`?deal=<id>`), so reload, Back and shared links work, and the drawer header links the deal title, company and person to their existing CRM pages, so the full records stay one click away. |
| **New `TimelineDealCard`** instead of a prop variant of `DealCard` | `DealCard` carries quick actions, an activity badge, days-in-stage and bulk selection. A compact sibling avoids regression risk on the Kanban. Shared tone classes and formatting helpers are reused. |
| **Stage-lane metadata is gated on `customers.pipelines.view`** | With the feature, stage lanes include empty stages, their order, the tone from `customer_dictionary_entries.color` (the Kanban's source) and the pipeline name. Without it, lanes derive only from the deals in the window, labelled with the deal's own `pipelineStage` text (already visible to `customers.deals.view` users), in a neutral tone, and grouped by `pipelineId` without a name. No pipeline metadata leaks beyond the existing gate. |
| **Open, won and lost are classified only through `lib/dealStatus.ts`** | Status spellings are becoming tenant-configurable (`.ai/specs/2026-10-18-deal-status-vocabulary.md`, PR #7625). The server passes the request's resolved vocabulary when that lands. The client uses the vocabulary the settings endpoint delivers, falling back to the shipped helpers. No `'open'`/`'win'`/`'lost'` literals in timeline code. `lib/dealStatus.ts` defines *open* as "not closed" and has no open-status list. So the Status filter defaults to empty, as on the Kanban and Map, and the endpoint's `excludeClosed` (default `true` while no Status filter is set) adds a `status $nin` condition built from the helpers' closed set (`CLOSED_DEAL_STATUS_LIST` expanded through `expandDealStatusAliases`, or the resolved vocabulary once #7625 lands). Choosing any status in the popover disables `excludeClosed`. |
| **Closed deals are a visible toggle, not a hidden default** | The shared `StatusFilterPopover` labels an empty selection "All" and shows it as inactive, so a hidden `excludeClosed` would read "All" while won and lost deals are missing. A separate segmented control, **Hide closed deals** (default) / **All deals**, makes the state visible. It maps to `excludeClosed` and is built from the status helpers, so it works with a configurable vocabulary where an open deal isn't literally `open`. |
| **Closed deals are view-only on the board (v1)** | The CRM summary reports bucket wins and losses by `updated_at` (`lib/dealsSummaryQueries.ts`), and `customer_deals` has no stable closure date. Any write to a won or lost deal (a new close date, a stage change, marking it won or lost again) moves its `updated_at` and therefore its reporting period. Until a stable closure date exists, the board and the drawer offer no write to a closed deal: no drag, no Change close date, no Change stage, no Mark won or Mark lost. Schedule follow-up stays, because it creates an interaction and doesn't write the deal (`commands/interactions.ts` only checks the deal is in scope). Reopening or correcting a result stays on the existing deal page, unchanged; its effect on reporting is part of the closure-date follow-up. The `PUT` route itself is unchanged. |
| **Timeline doesn't inherit List filters** | The Kanban and Map tabs don't inherit them either. The List's advanced-filter tree supports negations, OR groups and custom fields, while the timeline offers only "is one of" chips, so a partial carry-over would silently change a filter's meaning (for example, dropping "Owner is not Maya"). Links in the other direction (timeline → List) stay, because the List can represent every timeline filter exactly. |
| **Overdue uses the UTC date and the status helpers** | This matches the bucketing. The List's existing `isOverdue` filter uses server-local midnight and an `'open'` literal (`api/deals/route.ts:396-400`), so counts can differ for a few hours around midnight. That is documented as a known divergence; aligning the List filter is a follow-up owned by the status-vocabulary work. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Page through `GET /api/customers/deals` with a client cap of 500 (Q2a) | Rejected in Q2. Counts become wrong once the cap is reached, and a busy quarter would need up to 5 round trips. |
| Gantt or day-axis bars | Rejected in prototype review: width implies duration. |
| Kysely aggregation with a re-implemented filter set | Filter semantics would drift from `buildDealListFilters`. Grouping a bounded light pass in memory keeps one filter source of truth. |
| Locale-dependent week start | Bucket keys would change per user, breaking shared links and saved views (Q3). |
| Timeline-only Undo flash, as prototyped | It duplicates the shell's command undo. |
| Dragging across lanes to change owner or stage | Rejected in the story map for v1: mixing two edits in one gesture is error-prone. |

## 📝 User Stories / Use Cases

The approved story map in `.ai/prototypes/deals-close-timeline/REQUIREMENTS.md` §4 (US-A1…US-D5) is normative for behaviour. Summary:

- **Epic A (see what is closing when):** cards per bucket, column-size switch, overdue emphasis, won and lost hidden by default.
- **Epic B (organise):** owner or stage lanes, and collapsible lanes.
- **Epic C (reschedule):** drag, the keyboard dialog, conflict handling, and the read-only user (Phase 2).
- **Epic D (edge states):** first run, no results, undated, no access, loading and error.

## 📝 Architecture

```
/backend/customers/deals/timeline  (client page)
  ├─ ViewTabsRow (active="timeline")                          [shared, extended]
  ├─ FilterBarRow + Status/Pipeline/Entity filter popovers     [reused from pipeline/components]
  ├─ TimelineSavedViews (perspectives tableId customers.deals.timeline)
  │     └─ ViewChip / NewViewForm                              [reused from @open-mercato/ui/backend/views]
  ├─ TimelineControls (Group by · Columns · Prev/Today/Next · range label)
  └─ DealsTimelineBoard
       ├─ useQuery → GET /api/customers/deals/timeline          (readApiResultOrThrow)
       ├─ TimelineLane[] → TimelineCell[] → TimelineDealCard[]
       ├─ TimelineCellPopover → GET /api/customers/deals/timeline?cellLane=…&cellColumn=… (paged, ≤ 100)
       ├─ [Phase 2] @dnd-kit drag between cells of one lane → shiftCloseDate()
       │            → useGuardedMutation(PUT /api/customers/deals, lock header)
       ├─ TimelineDealDrawer (click/Enter on a card or popover row; URL ?deal=<id>)
       │     └─ header links: title → deal page · company → company page · person → person page
       │        close date + Change close date · summary (stage + Change stage) · activity + Schedule follow-up · Mark won/lost section
       └─ [Phase 2] ChangeCloseDateDialog (drawer → Change close date)

/api/customers/deals/timeline  (custom GET route)
  ├─ zod (route-local, derived from dealListQuerySchema): filter subset + grid params
  ├─ buildDealListFilters(query, ctx) + per-column [from, to) window
  ├─ light pass per column (queryEngine, one query of ≤ TIMELINE_COLUMN_CAP rows, two columns at a time)
  ├─ in-memory grouping → lane cells → top perCell ids per cell
  ├─ heavy pass (deal rows + primary company and person labels via findWithDecryption)
  ├─ owner lanes as ids (names resolved client-side) · stage lanes (metadata gated on customers.pipelines.view)
  ├─ side queries: overdueBefore, undatedCount, adjacent {previous, next}
  └─ cell mode: one lane × column, paged (page, pageSize ≤ 100)
```

- **Pure library (`lib/dealsTimeline.ts`):** `buildTimelineColumns(bucket, from, count)`, `bucketIndexFor(date, columns)`, `alignToBucketStart(date, bucket)` and `shiftCloseDate(date, bucket, delta)`. The server and client share it, so bucket and shift rules have one source of truth. All of it is UTC date-only arithmetic.
- **Server/client boundary:** the page and components are client components, like every deals backend page. The only server addition is the route, plus the additive list filter.
- **`"use client"` ledger:** `timeline/page.tsx` and the components under `timeline/components/`. There are no provider or shell changes.
- **Events and commands:** none new. Reschedules ride `customers.deals.update`, which already emits the deal-updated event, writes the audit log and invalidates caches.
- **Bundle:** `@dnd-kit/core` is already used by the Kanban, so there is no new dependency for the product. It currently resolves in `core` only through hoisting from `ui`/`enterprise`, so Phase 2 declares it in `packages/core/package.json` (same version range as `ui`) instead of relying on hoisting.

## 📝 Data Models

No new entities and no migrations.

### Used as-is
- **`CustomerDeal` (`customer_deals`):** `id`, `title` (**encrypted**, `encryption.ts`, so reads go through `findWithDecryption`), `status`, `pipelineId`, `pipelineStageId`, `valueAmount`, `valueCurrency`, `probability`, `expectedCloseAt` (**`timestamptz`, nullable, not indexed**), `ownerUserId`, `updatedAt` (lock version), plus org/tenant scope and soft delete.
- **`CustomerDealCompanyLink` → company `CustomerEntity`:** supplies the card's primary company label. The first linked company by link creation is used: the link query sets an explicit `orderBy: { createdAt: 'asc', id: 'asc' }` on `CustomerDealCompanyLink`, so the card label is deterministic (the Map endpoint's link fetch has no `orderBy`, so it can't be relied on for this). Decrypted via `findWithDecryption`.
- **`CustomerDealPersonLink` → person `CustomerEntity`:** supplies the drawer's primary person (contact) label, with the same rule: the first linked person by `orderBy: { createdAt: 'asc', id: 'asc' }`, decrypted via `findWithDecryption`.
- **Pipeline stages and `customer_dictionary_entries.color`:** supply the label, order and tone for stage lanes when `groupBy=stage` and the caller has `customers.pipelines.view`. This is the same source and org/tenant scoping as the Kanban (`pipeline/page.tsx`).
- **`perspectives` rows:** saved views. One row per user view, `tableId = 'customers.deals.timeline'`, stored in the existing table.

### Saved-view payload (`PerspectiveSettings`)

```jsonc
{
  "filters": {
    "timeline": {
      "v": 1,
      "status": [],                    // StatusFilterPopover values; empty = default (closed deals excluded via excludeClosed)
      "pipelineId": "uuid|null",       // PipelineFilterPopover is single-select (null = all); the API's pipelineId[] exists for parity
      "ownerUserId": ["uuid"],
      "personId": ["uuid"],
      "companyId": ["uuid"],
      "excludeClosed": true,           // Hide closed deals / All deals toggle; missing = true
      "groupBy": "owner",              // 'owner' | 'stage'
      "bucket": "week"                 // 'week' | 'month' | 'quarter'
    }
  },
  "searchValue": "optional search"
}
```

- The window anchor, collapsed lanes and popover state are **not** saved. Collapsed lanes live in `sessionStorage`, keyed by user and `tableId`.
- Unknown or invalid payloads (wrong `v`, bad enum values) are dropped field by field to defaults, never thrown. Validation uses a zod schema in `data/validators.ts`.

## 📝 API Contracts

### `GET /api/customers/deals/timeline` (new)

- **Metadata:** `{ GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] } }`
- **Query (zod, defined in the route file like the Map route, derived from `dealListQuerySchema`; this avoids `data/validators.ts` importing from an API route):**
  - **Filter subset reused from `dealListQuerySchema`:** `search`, `status[]`, `pipelineId[]`, `ownerUserId[]`, `personId[]`, `companyId[]`, `valueCurrency[]`. Repeated and comma-joined values are parsed with `readQueryParamList`, as in the Map route.
  - **Dropped params:** `dealListQuerySchema` is `.passthrough()`, so the route builds the object passed to `buildDealListFilters` from the parsed subset above only. Close-date params (`expectedCloseAtFrom`/`To`, `hasExpectedCloseAt`), `isOverdue`, and the advanced-filter tree (`filter[...]`) never reach the builder; the window bounds close dates.
  - **Merging with the builder's output:** `buildDealListFilters` can already set `filters.expected_close_at` and `filters.status`. The per-column `[from, to)` window (`$gte`/`$lt`) and the `excludeClosed` `$nin` are **merged** into the existing operator objects for those keys (or wrapped in `$and` when an operator would collide), never assigned over them. A unit test asserts that a `status` filter from the builder survives `excludeClosed` and that the window doesn't replace a builder-set `expected_close_at` condition.
  - **`bucket`:** `'week' | 'month' | 'quarter'`, default `'week'`.
  - **`from`:** `YYYY-MM-DD`. Defaults to the start of last week for week columns, and to the start of the current month or quarter for month and quarter columns. Any value is aligned down to its bucket start.
  - **`columns`:** integer 1–8, default 5 for weeks and 4 for months and quarters.
  - **`groupBy`:** `'owner' | 'stage'`, default `'owner'`.
  - **`perCell`:** integer 1–10, default 3.
  - **`excludeClosed`:** boolean, default `true` when no `status` is given and ignored when `status` is given. Excludes deals the status helpers classify as closed (won or lost). The page always sends it explicitly, from the Hide closed / All deals toggle.
  - **Cell mode:** `cellLane` (an owner id, a stage id, `__unassigned` for no owner, or `__nostage:<pipelineId>` for no stage) together with `cellColumn` (`0…columns-1`), plus `page` (≥ 1) and `pageSize` (1–100, default 50). Giving one without the other is a `400`, checked in the handler after parsing (no schema refinement).
- **Response `200`:**

```jsonc
{
  "bucket": "week", "groupBy": "owner", "weekStartsOn": 1,
  "from": "2026-10-19", "to": "2026-11-23",          // to = exclusive end
  "columns": [{ "index": 0, "from": "2026-10-19", "to": "2026-10-26", "isCurrent": false,
                "total": 14, "truncated": false,       // truncated = lane split partial
                "countCapped": false }],               // total hit OM_LIST_COUNT_CAP and is a floor
  "lanes": [{
    "key": "uuid | __unassigned | __nostage:<pipelineId>", // ownerUserId or pipelineStageId
    "kind": "owner",                                  // 'owner' | 'stage'
    "owner": { "id": "uuid" },                       // owner lanes; display name resolved client-side
    "stage": null,                                    // stage lanes: { label, pipelineId, order?, tone?, pipelineName? } (optional fields need customers.pipelines.view)
    "total": 8,                                       // deals in window for this lane
    "partial": false,                                 // true when any column is truncated: total is a lower bound
    "cells": [{
      "column": 1, "total": 5, "partial": false,        // partial: the cell is in a truncated column, total is a lower bound
      "items": [{
        "id": "uuid", "title": "LIMS migration", "status": "open",
        "valueAmount": 91000, "valueCurrency": "EUR", "probability": 65, // valueAmount: number | null
        "expectedCloseAt": "2026-11-02",              // UTC calendar date
        "pipelineId": "uuid", "pipelineStageId": "uuid", "pipelineStage": "Qualified", // pipelineStage: the deal's stage label text, string | null
        "ownerUserId": "uuid|null", "updatedAt": "2026-10-23T09:12:44.120Z",
        "primaryCompany": { "id": "uuid", "label": "Veridian Labs" }, // or null
        "primaryPerson": { "id": "uuid", "label": "Ingrid Malmberg" }   // or null; first linked person
      }]
    }]
  }],
  "overdueBefore": { "count": 3, "latestExpectedCloseAt": "2026-10-14", // open deals before `before`
                    "before": "2026-10-19",            // the earlier of the window start and today
                    "countCapped": false },
  "undatedCount": 12,                                  // matching deals with expected_close_at IS NULL
  "undatedCountCapped": false,
  "adjacent": { "previous": "2026-10-14", "next": null }, // nearest matching close dates outside the window
  "scopeHasDeals": true,                               // any non-deleted deal in scope, ignoring filters and window
  "truncated": false,                                  // any column hit TIMELINE_COLUMN_CAP (300)
  "cardsTruncated": false,                             // heavy pass hit TIMELINE_RESPONSE_CARD_CAP (240)
  "countsCapped": false                                // any of the counts above hit OM_LIST_COUNT_CAP
}
```

- **`scopeHasDeals`:** one 1-row query on `customer_deals` with only the org/tenant scope and soft delete applied. The query engine always runs its capped count probe first (up to `OM_LIST_COUNT_CAP` + 1 rows) and then the 1-row select; the engine has no option to skip the probe. It lets the page tell a new organization (first-run state) apart from one whose deals are all closed, undated, outside the window or filtered out.
- **Cell-mode response:** `{ "lane": "uuid|__unassigned|__nostage:<pipelineId>", "column": 1, "items": [ /* same item shape */ ], "total": 5, "page": 1, "pageSize": 50, "totalPages": 1, "countsCapped": false }`. The items use the same ordering as the grid.
- **Capped counts:** each count carries its own flag (`columns[].countCapped`, `overdueBefore.countCapped`, `undatedCountCapped`), so one capped count never marks the others as floors. `countsCapped` is the aggregate.

- **Lane rules:**
  - **Owner lanes:** owners with at least one matching deal in the window, plus every owner explicitly selected in the `ownerUserId` filter (even with zero deals). The client sorts them by resolved name; owners it can't resolve (beyond the staff lookup's 100-member page, or without `customers.roles.view`) show a generic "Owner" label with initials from the id and sort last, before `__unassigned`, which always comes last. In a truncated column, an owner whose deals all fall beyond the cap has no lane until the filters are narrowed; the truncation alert says so.
  - **Stage lanes (with `customers.pipelines.view`):** every stage of the selected pipeline(s) in pipeline order, empty ones included. With several or all pipelines they are grouped by `pipelineId`, with the pipeline name.
  - **Stage lanes (without it):** only stages that have deals in the window, ordered by label, with no pipeline name.
- **`valueAmount` wire type:** `number | null`. The entity stores `numeric(14,2)` as `string | null`; the projection converts it with `toFiniteNumberOrNull`, exactly as the Map endpoint does (`api/deals/map/route.ts`), and the response zod schema declares `z.number().nullable()`.
- **Cell items** are ordered by `expectedCloseAt` ascending, then `id`. Neither `title` (encrypted, so sorting would force decrypting every candidate) nor value (amounts in different currencies aren't comparable) is used.
- **Stage-lane gating** is checked inside the route with `rbacService.userHasAllFeatures(userId, ['customers.pipelines.view'], scope)`, which honours wildcard grants.
- **Multi-organization caveat (inherited):** `buildDealListFilters` resolves the People/Companies, `needsAttention` and stuck-deal filters against `ctx.auth.orgId` (`api/deals/route.ts:410-453`). Under "All organizations" those specific filters narrow to a single organization, exactly as they do on the List, Kanban and Map today. The timeline inherits this and doesn't fix it; fixing it belongs in `buildDealListFilters` for all views.
- **Scoping:** every pass and side query applies the same org/tenant scope resolution as `api/deals/map` (`resolveOrganizationScopeForRequest` and `resolveOrganizationScopeFilter`).
- **Errors:**
  - `400`: invalid query, such as `bucket=day`, `columns=9`, a malformed `from`, or `perCell=0`.
  - `401` when unauthenticated, and `403` without `customers.deals.view`.
- Exports `openApi`, following the Map and summary routes.

### `GET /api/customers/deals`: additive `hasExpectedCloseAt` filter

- `dealListQuerySchema` gains `hasExpectedCloseAt` (`booleanQueryParam`, optional).
- `buildDealListFilters` maps `false` to `expected_close_at IS NULL` and `true` to `IS NOT NULL`. When the param is absent, behaviour is unchanged.
- **Combination rules:**
  - `true` together with `expectedCloseAtFrom`/`To` or `isOverdue`: merged into the same `expected_close_at` condition object. The range already implies not-null, so the result is the range alone.
  - `false` together with a close-date range, or with `isOverdue` while `needsAttention` is absent (the builder ignores `isOverdue` when `needsAttention` is set): contradictory, so the **route handler** returns a `400` after parsing. `dealListQuerySchema` itself stays a plain `z.object` with one added optional field. A zod refinement would make `.extend()` throw under zod 4, which breaks the Map route (`dealListQuerySchema.extend`) and the shared `withIdsQueryParam` OpenAPI helper.
  - `false` together with an `expected_close_at` rule in the List's advanced-filter tree (for example a "this month" preset) is not rejected. It returns an empty list, which is documented here as expected.
  - `false` with `needsAttention` is allowed. It is evaluated as the existing `needsAttention` composite, intersected with null close dates.
- The deals List page reads `hasExpectedCloseAt` from the URL into its filter state (the same pattern as `needsAttention`) and shows it as a removable chip.

### Reschedule write (Phase 2): existing route, no contract change

- `PUT /api/customers/deals` with body `{ id, expectedCloseAt: 'YYYY-MM-DD' }` and the optimistic-lock header from `buildOptimisticLockHeader(item.updatedAt)`.
- Requires `customers.deals.manage`, which the existing route already enforces. Responses: `200`, `409` (stale version, handled with `surfaceRecordConflict`), and `403` or `422`, which become an error flash and a rollback.

## 📝 Internationalization (i18n)

All five customers locales (`en`, `pl`, `de`, `es`, `ko`) go in `packages/core/src/modules/customers/i18n/*.json`:

- **Labels:** `customers.deals.kanban.view.timeline` is the tab label ("Timeline"). `customers.nav.deals.timeline` is the page title and breadcrumb ("Deals Timeline").
- **`customers.deals.timeline.*`:**
  - controls: `groupBy.label`, `groupBy.owner`, `groupBy.stage`, `columns.label`, `columns.week`, `columns.month`, `columns.quarter`, `nav.previous`, `nav.today`, `nav.next`;
  - column headers: `column.week` ("Week {number}"), `column.thisWeek`, `column.thisMonth`, `column.thisQuarter`;
  - lanes: `lane.unassigned`, `lane.count` ("{count} deals", pluralised), `lane.collapse`, `lane.expand`;
  - cards and cells: `card.aria` (composed label), `cell.more` ("+{count} more"), `cell.popoverTitle`;
  - edge links: `overdueBefore` ("{count} overdue before {date}"), `undated` ("{count} deals have no close date", with no status word because the Status filter is applied);
  - empty, error and saved-view states: `empty.noDeals.*`, `empty.noResults.*`, `jump.previous`, `jump.next`, `loadError`, `truncated`, `savedViews.*`;
  - closed toggle, preview, context and truncation: `closed.hide`, `closed.all`, `empty.showClosed`, `drawer.*` (title, sections, actions, `status`), `truncated` (owners may be missing), `truncatedOpenInList`, `partialCount` ("{count}+");
  - Phase 2: `reschedule.action`, `reschedule.showDeal`, `reschedule.closedHint`, `reschedule.success`, `reschedule.error`, `reschedule.dialog.title`, `reschedule.dialog.current`, `reschedule.dialog.quick.*`, `reschedule.readOnlyHint`.
- **List chip:** `customers.deals.list.filters.noCloseDate`.
- Dates and currency are formatted through the existing locale-aware helpers (`formatCurrency` from `components/detail/utils.ts`). No hard-coded user-facing strings.

## 📝 UI/UX

The prototype in `.ai/prototypes/deals-close-timeline/index.html` (screens s1–s17) is the visual reference, aligned with this spec on 2026-11-03. It must be implemented with DS tokens and primitives. States specified here but not drawn in the prototype: the truncation alert with "{n}+" partial counts and Open in List, the "Show deal" flash, muted won/lost cards under All deals, the view-only drawer, and the drawer for a won or lost deal. Only behaviour that the prototype can't show unambiguously is specified here.

- **Page scaffold:** mirrors `map/page.tsx`, plus the Kanban's "New deal" button:
  - breadcrumb Deals → Deals Timeline;
  - an `h1` and a `SearchInput` (`w-64`);
  - "New deal" (`customers.deals.manage` only, as on the Kanban, `pipeline/page.tsx`; the Map has none), linking to `/backend/customers/deals/create?returnTo=<the current timeline URL, encoded>`, so saving or cancelling returns to the same window, grouping and filters;
  - `ViewTabsRow`, resolved through the component registry (`VIEW_TABS_ROW_COMPONENT_ID`).
- **Filter bar:** `FilterBarRow` with:
  - a **Hide closed deals / All deals** segmented control (default Hide closed deals), mapped to `excludeClosed`. The two controls never contradict each other, so they always describe the cards on screen:
    - choosing a closed status (won or lost, per the status helpers) in the popover switches the toggle to **All deals**;
    - switching to **Hide closed deals** removes every closed status from the Status selection and keeps the open ones;
    - with only open statuses chosen, either toggle position shows the same cards, so the toggle stays where the user left it;
    - Clear filters resets to Hide closed deals with no statuses. Today and Prev/Next move only the window and never change filters;
    - saved views store it (`excludeClosed` in the payload; a missing field means `true`). A view that holds both `excludeClosed: true` and a closed status loads normalized by the same rule: the closed statuses are removed.
    The endpoint keeps its rule (an explicit `status` wins over `excludeClosed`), but the page never sends that combination;
  - `StatusFilterPopover` (empty by default, as on the Kanban and Map), `PipelineFilterPopover`, and `EntityFilterPopover` for Owner, People and Companies. There is **no** `CloseDateFilterPopover`, because the window already bounds close dates, and no `SortByPopover`, because the order is by date.
- **Saved views row:** chips for the user's `perspectives` (`ViewChip`), "Save view" (`NewViewForm`) and delete. It is hidden without `perspectives.use`. Saving, renaming (a POST with `perspectiveId`) and deleting are non-`CrudForm` writes, so each goes through `useGuardedMutation(...).runMutation` with `retryLastMutation` (customers `AGENTS.md` rule 6). Rename and delete send `buildOptimisticLockHeader(perspective.updatedAt)`. A `409` with `code: 'duplicate_name'` shows an inline name error in `NewViewForm`; any other `409` goes to `surfaceRecordConflict` and reloads the view list. Role defaults and sharing are out of scope for v1.
- **Controls row:**
  - Group by (`owner` or `stage`) and Columns (`week`, `month` or `quarter`) as segmented controls;
  - Prev/Today/Next move by one column; Today resets `from` to the default anchor;
  - a range label.

  The state is mirrored in the URL (`bucket`, `groupBy`, `from`, plus the filters) so links can be shared.
- **Board:**
  - a CSS grid of a lane-header column (avatar, name and "{n} deals") plus `columns` equal cells. Each column has a minimum readable width (`12rem`, enough for a two-line title and the full close date); when the viewport is narrower, the board scrolls horizontally and the lane-header column stays pinned (`position: sticky`), so owner names stay visible;
  - the current column is tinted with the `accent-indigo` alpha tokens and shows a "This week/month/quarter" pill;
  - cells hold up to `perCell` cards, then a "+N more" button that opens `TimelineCellPopover`;
  - the "{n} overdue before {date}" button (status-error tokens) sits above the lanes and moves `from` to the bucket containing `overdueBefore.latestExpectedCloseAt`;
  - the footer has the stage legend and the undated link (`buildDealsListHref({ ...activeFilters, excludeClosed, hasExpectedCloseAt: false })`; with `excludeClosed` the helper adds the `status is_none_of` closed-set condition, so the List shows exactly the counted deals).
- **`TimelineDealCard`** (compact `DealCard`, about 4.5rem tall):
  - row 1: the title (truncated) and a probability pill;
  - row 2: the value (`formatCurrency`) and the close date with a calendar icon. Overdue dates (an open deal per `lib/dealStatus.ts`, with a date before today) use status-error tokens and a warning icon, as on `DealCard`;
  - row 3: the primary company, plus an owner avatar when `groupBy=stage`;
  - a left edge in the stage tone, using the `Lane.tsx` tone-class map;
  - deals the status helpers classify as won or lost (only shown when the Status filter includes them) render muted with a status badge;
  - the card is a button: click and Enter both open the deal drawer, in both phases. For users with `customers.deals.manage`, modified clicks (Cmd/Ctrl-click, middle-click) open the existing deal page `/backend/customers/deals/{id}` in a new tab, so the old link behaviour isn't lost;
  - the card has no menu of its own: every action, and the links to the existing CRM pages, live in the drawer.
- **Deal drawer (`TimelineDealDrawer`):** opened by click or Enter on a card, or on a "+N more" popover row. Built on the `Drawer` primitive (`@open-mercato/ui/primitives/drawer`), right side, overlay. It keeps the card compact while restoring the review context the Kanban card shows:
  - **Header:** the deal title, then a subline with the primary company and the primary person (contact). Each is a link to its existing CRM page (below). There is no status badge in the header and no separate "Full page" link.
  - **Layout**, top to bottom, so each action sits next to what it changes:
    1. **Expected close date** (overdue treatment), the timeline's subject, with **Change close date** beside it (Phase 2, open deals only);
    2. a compact **summary**: value, probability, stage with the **status badge next to it** (open, won or lost per the status helpers) and **Change stage** beside it (`ChangeStageDialog`), and owner;
    3. **Activity**: open activities count, days in current stage and the stalled flag, with **Schedule follow-up** beside it;
    4. a separate **Close deal** section at the bottom with **Mark won** and **Mark lost** with a reason (the closure flow of `useDealClosure` and `ConfirmDealLostDialog`, extracted from the deal detail page into a shared hook if needed).

    The `_pipeline` signals come from the existing enrichment (`data/enrichers.ts`); the drawer fetches `GET /api/customers/deals?ids=<id>` when it opens, so it never shows stale card data.
  - **Schedule follow-up** reuses `ScheduleActivityDialog` (`components/detail/ScheduleActivityDialog.tsx`), as the deal page does: `dealId` is the deal, and `entityId`/`entityType` are the primary person, or the primary company when there is no person. It has a date and time, so the follow-up is scheduled, not just logged. When the deal has neither a person nor a company, the action is hidden, because an interaction needs a customer. Creating the interaction doesn't write the deal.
  - **Closed deals** (won or lost): the drawer shows the summary, activity and header links, and offers only Schedule follow-up. Change close date, Change stage and the Close deal section are hidden (see the closed-deals design decision).
  - **Header links to existing CRM pages:** no new detail pages; each link opens the page that exists today, reused unchanged:
    - **deal title** → `/backend/customers/deals/{id}` (`deals/[id]/page.tsx`), requires `customers.deals.manage`;
    - **company** → `/backend/customers/companies-v2/{id}`, requires `customers.companies.view`;
    - **person** → `/backend/customers/people-v2/{id}`, requires `customers.people.view`.

    The `-v2` routes are the ones the deals UI links to today (deal detail, Kanban). Each link renders only when the user has that page's feature, checked once per page load with `/api/auth/feature-check` and the wildcard-aware `hasAllFeatures` (as `useAuditPermissions` does); otherwise the label is plain text, so no one lands on a no-access page. They are real links, so Cmd/Ctrl-click and middle-click open a new tab.
    - **Returning:** none of these pages reads `returnTo`. Because the whole timeline state (window, grouping, filters and `?deal=`) is in the URL, the browser's Back returns to the same review with the drawer open. Teaching those pages to honour `returnTo` is a possible follow-up and is not part of this spec.
  - Mutating actions require `customers.deals.manage`; view-only users see the drawer content only. Schedule follow-up requires `customers.interactions.manage` (the `POST /api/customers/interactions` guard), checked with the same feature check as the header links; without it the action is hidden.
  - **No edit form.** Field edits happen on the details page.
  - **URL state:** the open deal is `?deal=<id>` on the timeline URL. Reload, Back (closes the drawer) and shared links restore it. A `deal` id that doesn't resolve in scope (deleted, other organization, no access) closes the drawer silently and drops the param.
  - **Focus and keyboard:** it is a modal dialog: focus moves into the drawer, Escape closes it, and focus returns to the card that opened it. If that card is no longer rendered (rescheduled out of view), focus follows the "Destination not visible" rule.
  - **Narrow screens:** the drawer overlays the board (max `32rem`, full width below the `sm` breakpoint), and the board keeps its scroll position underneath.
  - **Freshness and locking:** every write from the drawer uses the `updatedAt` it fetched, with `buildOptimisticLockHeader`. After any write from the drawer, or a drag of the same deal on the board, the drawer re-reads the deal and the timeline query is invalidated, so it never writes with a stale version.
- **Collapsed lanes:** a single row showing per-column counts ("{n} deals", status-error tone when the cell holds an overdue deal), remembered in `sessionStorage`.
- **States:**
  - first run, only when `scopeHasDeals` is `false`: an `EmptyState` with "Create deal" (with `customers.deals.manage`; otherwise a hint to ask an administrator), and the filter and controls rows hidden;
  - no results in the window (`scopeHasDeals` is `true`): the filter, toggle and controls rows **stay visible**, with an `EmptyState` offering "Clear filters", "Jump to previous/next deal" from `adjacent`, and "Show closed deals" when Hide closed deals is on. The undated link stays in the footer when `undatedCount > 0`. This covers organizations with only closed deals, only undated deals, or no deals matching the filters;
  - loading: card-sized skeletons inside the real columns, keeping the previous grid dimmed while a new window loads;
  - error: `ErrorMessage` with retry;
  - truncated: a muted `Alert` naming the column: "Showing the first {n} deals in {column}. Some owners or stages may be missing, and counts there are partial", with an **Open in List** action. That link goes through `buildDealsListHref` with the active filters plus the column's half-open `[from, to)` range, so the List shows exactly the deals of that period. `between` includes both ends (`$gte`/`$lte` in `advanced-filter-tree.ts`), and `expected_close_at` is a `timestamptz`, so the range is sent as two AND-joined conditions: `expected_close_at between [from, to]` and `expected_close_at is_before to`, which the tree compiles to `$and` of `$gte from`/`$lte to` and `$lt to`. A deal closing exactly at `to` (the next period's first day) is excluded. Partial counts (`partial: true`) render as "{n}+" in a muted style, so they never look like complete counts.
- **Phase 2, rescheduling:**
  - **Drag:** `@dnd-kit` with `PointerSensor` and `KeyboardSensor`; drop targets are only the cells of the source lane. While dragging, the origin shows a ghost, the target cell is highlighted, and a tooltip shows the resulting date and the shift ("+1 week"). Esc cancels. Dropping on the origin column does nothing.
  - **After a drop:** the card moves optimistically and is re-sorted in its cell. A success flash appears, and the shell's `LastOperationBanner` offers Undo.
  - **Change close date action:** in the deal drawer, for managers on open deals. A "+N more" popover row opens the same drawer, so hidden deals can be rescheduled without leaving the timeline.
  - **Destination not visible:** when the new date falls outside the window, or the card lands behind "+N more", the view stays where it is. The success flash says "Close date moved to {date}" and carries a **Show deal** action, which moves `from` to the bucket containing the date and, if the card is behind "+N more", opens that cell's popover with the deal focused. Focus goes to the **Show deal** action (never to a card that is no longer rendered); if the card is still visible, focus returns to it.
  - **Closed deals:** no drag handle and no Change close date action; a tooltip explains that closed deals can't be rescheduled from the timeline.
  - **Exact-date dialog:** `ChangeCloseDateDialog` holds the current date, a date input, and quick chips (+1 week, +2 weeks, end of month, end of quarter) that are relative to the current close date. Cmd/Ctrl+Enter saves and Escape cancels. Focus follows the rule under "Destination not visible".
  - **Keyboard:** Up/Down moves focus within a cell, Left/Right across columns.
  - **Read-only users** (no `customers.deals.manage`): no drag affordance and no Change close date action in the drawer. Click and Enter still open the drawer. A tooltip explains why.
- **Accessibility:** each card's `aria-label` is composed from the title, company, value, close date and overdue state, and is recomputed from the current data after a move, an Undo and a rollback (a regression found in the prototype). Icon-only buttons carry `aria-label`. The drag also works from the keyboard through the `@dnd-kit` `KeyboardSensor`.
- **Visual acceptance:** the board stays readable at a 1024 px viewport and at 200% browser zoom: full close dates visible, titles truncated to at least two lines, lane names visible while scrolling horizontally.
- **Page meta (`timeline/page.meta.ts`):** follows the Map page's shape. The Map also requires `customers.activities.view`; the timeline doesn't, because it shows no activity data. Fields: `requireAuth`, `requireFeatures: ['customers.deals.view']`, `pageTitleKey: 'customers.nav.deals.timeline'`, group Customers, `pageOrder: 123`, and breadcrumb Deals → Deals Timeline.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|----------|-----------|
| A deal's `expected_close_at` has a non-midnight UTC time (legacy or import data) | Bucketed and displayed by its UTC calendar date. A reschedule normalises it to UTC midnight. |
| A month shift lands on a day that doesn't exist (Jan 31 + 1 month) | Clamped to the month's last day (Feb 28 or 29). `shiftCloseDate` is unit-tested. |
| Dropping a card into a past column | Allowed without confirmation (story map §7.1). The card turns overdue. |
| A won or lost deal (per the resolved status vocabulary) is shown | Only when the toggle is All deals or the Status filter includes it. It renders muted with a status badge, has no drag handle and no Change close date action, and the overdue treatment never applies. This keeps the summary reports, which bucket closures by `updated_at`, stable. |
| The drawer is open on a deal that is then dragged, or changed by someone else | A drag re-reads the drawer's deal. A write from the drawer with a stale version returns `409`, surfaced with `surfaceRecordConflict`, and the drawer re-reads. |
| A user lacks the feature for a linked page (`customers.deals.manage`, `customers.companies.view` or `customers.people.view`) | That name in the drawer header renders as plain text, and without `customers.deals.manage` there is no modified-click navigation from cards. The drawer still shows everything the timeline needs. |
| A deal has no linked company or person | That part of the subline is omitted. |
| `?deal=<id>` points at a deal that is missing or out of scope | The drawer stays closed and the param is dropped; no error page. |
| A new date falls outside the window, or behind "+N more" | The view stays put; the flash's **Show deal** action navigates there, and focus goes to that action. |
| An organization has deals, but none match (all closed, all undated, or all filtered out) | `scopeHasDeals` is `true`, so the filters and toggle stay visible with the no-results state, "Show closed deals" and the undated link as applicable. |
| The user switches from a filtered List to the Timeline tab | The timeline opens with its own URL state, saved view or defaults, as the Kanban and Map do. No List condition is applied partially. |
| A saved view holds Hide closed deals and a closed status | It loads normalized: the closed statuses are removed, so the toggle and Status agree. |
| An owner is deactivated or unresolvable | The lane shows the generic "Owner" label with initials from the id, and sorts after named owners. This is the Kanban's existing degradation. An additive id lookup on `assignable-staff` is a possible follow-up. |
| A deal has no stage (`pipelineStageId` null) | It appears in its pipeline's "No stage" lane (`__nostage:<pipelineId>`). Stages can't be deleted while active deals reference them (`commands/pipeline-stages.ts` returns 409), so there are no orphaned stage ids. |
| More than `TIMELINE_COLUMN_CAP` matching deals in one column | That column is flagged `truncated`. Its `total` stays exact, its lane split covers only the capped rows (`partial: true`, shown as "{n}+"), and the popover (cell mode) lists every deal of an existing lane with the exact total. An owner whose deals all fall past the cap has no lane, so the alert says owners may be missing and offers **Open in List** for the whole period. |
| A deal sits exactly on a bucket boundary | Columns are half-open `[from, to)` in both the grid and cell mode, so a deal is counted and listed in exactly one cell. |
| Undo via `LastOperationBanner` | The banner reloads the page after a successful undo. The timeline state lives in the URL (including an open drawer's `?deal=`), so the view is restored; only collapsed lanes (`sessionStorage`) and open popovers reset. |
| The deal was changed by someone else before the drop | `409`: the card is rolled back and the conflict bar offers Refresh (US-C3). |
| A mutation guard rejects the write (for example, record lock) | `useGuardedMutation` throws, the card is rolled back, and the guard's message is flashed. |
| The perspective payload is invalid or from an older version | Fields fall back to defaults. The view still loads, and a warning is logged. |
| The user lacks `perspectives.use` | The saved-views row is hidden and everything else works. |
| `customers.pipelines.view` is missing | Stage lanes render from the deals in the window: no empty stages, neutral tone, and no pipeline names. |

## 📝 CRM and Sales Workflow Consistency

The timeline is a **close-date planning view** for CRM deals. It is not a forecast, and it changes nothing outside the deal's own expected close date.

- **What the card shows:**
  - **Amount:** the deal's own `valueAmount` and `valueCurrency`, the manual estimate entered on the deal. It is not taken from a quote, and the deal model doesn't record whether it is net or gross; the label is "Value", as on the Kanban and List.
  - **Date:** `expected_close_at`, the rep's expected close date.
- **What a reschedule changes:** only `customer_deals.expected_close_at`, through the existing update command. Activity dates, quote validity, order delivery dates and payment dates are untouched.
- **Sales documents today:** the Sales quote and order entities reference the customer, not the deal. There is no deal↔quote or deal↔order link, so the timeline doesn't show quotes and doesn't infer one from the company (ambiguous when a customer has several opportunities).
- **Status ownership:** the deal's status is changed only by CRM actions (deal form, Kanban, the deal drawer's Mark won/lost). Accepting a quote, creating an order, or cancelling either does **not** change the deal in v1, and reopening a deal doesn't touch Sales documents. The configured Sales document flow is unchanged.
- **Intended flow (follow-up spec, owned by the customers and sales modules together):** an explicit deal reference on quotes and orders (FK id plus snapshot, no ORM relation), a deal panel listing them, and opt-in rules (for example quote accepted → deal won, order cancelled → reopen prompt) implemented as event subscribers so neither module depends on the other. Alternative quotes for one deal, and which one feeds the deal amount, belong to that spec.
- **Forecasting:** period totals and weighted forecast stay out of scope. Totals per currency (no conversion) are the first follow-up.

## 📝 Migration & Compatibility

- **No database migrations, entity changes or new ACL features.**
- **Additive contract surfaces only** (per `BACKWARD_COMPATIBILITY.md`):
  - **New API route** `GET /api/customers/deals/timeline`.
  - **New backend page route** `/backend/customers/deals/timeline`.
  - **New optional list query param** `hasExpectedCloseAt`.
  - **New i18n keys.**
  - **Widened `KanbanView` union and `DEALS_VIEWS`.** These become `'kanban' | 'list' | 'map' | 'timeline'`, in that canonical order. The union is classified as **additive-only**: a new member can appear in any minor version. The spec adds a `BACKWARD_COMPATIBILITY.md` row stating this explicitly, because a consumer typing `Record<KanbanView, …>` needs a new key on upgrade (the in-repo label map in `ViewTabsRow.tsx` is updated in the same step). `resolveVisibleViews` semantics are unchanged. A deployment that overrides `section:customers.deals.viewTabs` with an explicit `visibleViews` list will **not** show the new tab until it adds `'timeline'`. That is the documented behaviour of the prop, and it will be noted in UPGRADE_NOTES as an informational item.
- **No changes** to `DealCard`, the Kanban page or the Map page beyond `ViewTabsRow`.
- Run `yarn generate` after adding the page and route.

## 📝 Out of Scope (v1)

- Per-column value totals and weighted forecast (needs currency conversion; possible follow-up through `api/deals/summary` conventions).
- Dragging across lanes to change owner or stage; a dedicated undated tray; role-default saved views and sharing; dashboard or portal widgets; a day-precision axis.
- An index on `expected_close_at`. It is a follow-up only if profiling shows a need (see Risks).
- Rescheduling closed deals, until reporting has a stable closure date (a `closed_at` column and report changes, separate spec).
- The deal↔quote/order link and the Sales status rules (see CRM and Sales Workflow Consistency).
- Per-currency period totals (first forecasting follow-up).
- Showing repeated postponements of the same deal (from the audit log) to managers.

## 📋 Phasing

- **Phase 1, read-only timeline:** endpoint, shared bucket library, page, filters, saved views, edge states, and the `hasExpectedCloseAt` list filter. Users can review close dates; there is no editing on the board yet.
- **Phase 2, rescheduling:** drag-to-reschedule, the exact-date dialog, keyboard navigation, the read-only affordances and conflict handling. It depends only on Phase 1.

## 📋 Implementation Plan

### Phase 1: read-only timeline

1. **`lib/dealsTimeline.ts`**, the pure UTC bucket library: `alignToBucketStart`, `buildTimelineColumns`, `bucketIndexFor`, `shiftCloseDate` and `toUtcDateKey`.
   - Unit tests (`lib/__tests__/dealsTimeline.test.ts`) cover:
     - ISO Monday alignment across year boundaries (week 53 and week 1);
     - month and quarter alignment;
     - clamping on shifts (Jan 31 + 1 month, Nov 30 + 1 quarter);
     - negative shifts;
     - non-midnight `timestamptz` inputs.
2. **`hasExpectedCloseAt` list filter:** add it to `dealListQuerySchema` as a plain optional field, honour it in `buildDealListFilters`, and put the contradiction check in the list route handler. Extend `api/deals/__tests__/route.filters.test.ts` for:
   - `true`, `false` and absent;
   - `true` + range;
   - `true` + `isOverdue`;
   - `false` + range → `400` (from the handler);
   - `false` + `isOverdue` → `400`;
   - `false` + `isOverdue` + `needsAttention` → allowed;
   - `false` + `needsAttention`;
   - plus a regression test that `dealListQuerySchema.extend({...})` and `withIdsQueryParam(dealListQuerySchema)` still work.
3. **Schemas:** `dealTimelineSavedViewSchema` in `data/validators.ts`. The timeline query schema lives in the route file, derived from `dealListQuerySchema`. Unit tests cover defaults, bounds, alignment of `from`, `excludeClosed` defaulting, and cell-mode pairing (`cellLane` without `cellColumn` → `400`, checked in the handler).
4. **`api/deals/timeline/route.ts`:**
   - metadata, auth and scope scaffold (copied from `api/deals/map`);
   - `buildDealListFilters` called once, then one light pass per column with a half-open `[from, to)` filter and the `excludeClosed` condition, as one internal query with `pageSize = TIMELINE_COLUMN_CAP` (300; a deliberate internal exception to the `pageSize ≤ 100` rule, which applies to user-facing paging — no query engine enforces a maximum), sorted by `expected_close_at` and `id`, with the engine's `total` as the column total; column passes run two at a time;
   - grouping, then the heavy pass for the top `perCell` ids per cell, allotted round-robin (one more card per cell per round, lanes in display order, cells in column order) up to `TIMELINE_RESPONSE_CARD_CAP` (240), so no lane is starved: deal rows and company labels (link `orderBy: { createdAt: 'asc', id: 'asc' }`) through `findWithDecryption`;
   - stage lanes, with the metadata gated in-route via `rbacService.userHasAllFeatures` (wildcard-aware) on `customers.pipelines.view` and tones from `customer_dictionary_entries.color`, plus per-pipeline `__nostage:<pipelineId>` lanes;
   - side queries (`overdueBefore`, `undatedCount`, `adjacent`) using the helpers' closed-set exclusion and the UTC date;
   - cell mode;
   - an explicit snake_case→camelCase projection, and the `openApi` export.
   - Unit tests (`api/deals/timeline/__tests__/route.test.ts`) cover:
     - grouping and counts;
     - perCell truncation, and the response card cap (`cardsTruncated`, exact `total` on emptied cells);
     - ordering inside a cell;
     - the owner lane rules (selected owner with zero deals, `__unassigned` last);
     - stage lanes including empty stages;
     - scope passthrough, including multi-org `$in` (asserted on the scope filter, not through the single-org People/Companies filters);
     - no plaintext-sort path: the light pass never sorts on an encrypted field;
     - `excludeClosed` with the shipped vocabulary and with aliases (`won`, `loose`);
     - per-column `truncated` with an exact `total`;
     - boundary deals counted once;
     - cell mode for an owner, a stage and `__unassigned`, including paging;
     - decrypted titles;
     - stage lanes with and without `customers.pipelines.view`;
     - `partial` on lanes and cells of a truncated column;
     - `scopeHasDeals` for an empty organization, one with only closed deals, one with only undated deals, and one whose deals the filters exclude;
     - the 400 cases.
5. **`ViewTabsRow`:** add `timeline` to `KanbanView`, `DEALS_VIEWS`, `VIEW_HREFS` and the label map, and extend the `resolveVisibleViews` unit test.
6. **Page and components (read-only):**
   - `backend/customers/deals/timeline/page.meta.ts` and `page.tsx`;
   - `components/DealsTimelineBoard.tsx`, `TimelineLane.tsx`, `TimelineDealCard.tsx`, `TimelineCellPopover.tsx`, `TimelineControls.tsx`;
   - the URL-state hook `useTimelineUrlState.ts`;
   - empty (first run from `scopeHasDeals`, no-results with the filters kept), loading, error and truncation states (owners-may-be-missing alert, "{n}+" partial counts, Open in List), and collapsed lanes in `sessionStorage`;
   - the Hide closed deals / All deals toggle, its pruning of closed statuses, its reset rules and saved-view normalization;
   - minimum column width, horizontal scrolling and the pinned lane-header column;
   - `TimelineDealDrawer` on the `Drawer` primitive: the close-date-first layout, `_pipeline` signals, the reused actions (`ScheduleActivityDialog`, `ChangeStageDialog`, the closure flow), the closed-deal action set, header links (title → deal page, company → company page, person → person page, each gated by that page's feature via `/api/auth/feature-check`), status next to stage, `?deal=` URL state, focus return, and re-read after writes; modified clicks opening the details page in a new tab;
   - "New deal" with the current timeline URL as `returnTo`.
   - Owner names come from `fetchAssignableStaffMembers` (as on the Kanban). The helper takes no header option, so the call is wrapped in `withScopedApiRequestHeaders({ 'x-om-forbidden-redirect': '0' }, …)` and any error falls back to the generic "Owner" label. The same fallback applies when an owner isn't on the first page.
7. **Saved views:** `TimelineSavedViews.tsx`, built on the perspectives API (`/api/perspectives/customers.deals.timeline`) and the `ViewChip`/`NewViewForm` primitives. Saving, renaming and deleting go through `useGuardedMutation`, with the lock header and the `duplicate_name`/conflict handling described in UI/UX. Applying a view sets the filters, the closed-deals toggle, `groupBy` and `bucket` and resets `from`. Unit tests cover payload parse and fallback.
8. **Undated link:**
   - `lib/dealsListHref.ts` provides `buildDealsListHref(filters)`, which encodes Status, Owner and Pipeline into the advanced-filter tree with the serializer `deals/page.tsx` already deserializes, encodes `excludeClosed` as a `status is_none_of` condition over the helpers' closed set (only when no Status is chosen), and passes search, people and companies as plain params;
   - the List page reads `hasExpectedCloseAt` from the URL and renders it as a removable chip;
   - a unit test checks the round trip: `buildDealsListHref` → List URL hydration → the same filter set, both with a chosen Status and with `excludeClosed` (the hydrated tree holds the `status is_none_of` closed-set condition, including the `won`/`loose` aliases), and with a period range for Open in List (the half-open range: a deal at exactly `to` is excluded);
9. **i18n** keys in all five locales (`en`, `pl`, `de`, `es`, `ko`), then `yarn generate` and `yarn i18n:check-sync`.
10. **Integration tests** TC-CRM-TL-001 (API) and TC-CRM-TL-002 (UI, read-only) — see Integration Test Coverage. Final IDs follow the repo's next free `TC-CRM-*` numbers at implementation time.

### Phase 2: rescheduling

11. **Drag:** declare `@dnd-kit/core` in `packages/core/package.json`, then wire `@dnd-kit` (`PointerSensor` and `KeyboardSensor`) into `DealsTimelineBoard`, with drop targets limited to the source lane and computation through `shiftCloseDate`. Add the ghost, target highlight and tooltip, Esc to cancel, and a no-op on the origin column.
12. **Reschedule mutation:** `useRescheduleDeal.ts`, which:
    - updates the query cache optimistically;
    - sends `PUT /api/customers/deals` inside `useGuardedMutation(...).runMutation` with `withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), …)` and passes `retryLastMutation` in the injection context;
    - on failure rolls back and calls `surfaceRecordConflict`, otherwise flashes the error;
    - on success flashes and invalidates the timeline query; Undo comes through `LastOperationBanner`.

    Unit tests cover the cache move, rollback and conflict routing.
13. **Change close date action and `ChangeCloseDateDialog.tsx`:** the action in the deal drawer (reached from cards and "+N more" popover rows); keyboard navigation between cards (Up/Down and Left/Right); Cmd/Ctrl+Enter to save and Escape to cancel; the Show deal flash and focus rule when the destination isn't visible; `aria-label` recomputed after move, Undo and rollback.
14. **Read-only affordances** without `customers.deals.manage`, and for closed deals: no drag, no Change close date action, and a tooltip hint.
15. **Integration test** TC-CRM-TL-003 (UI rescheduling), the DS guardian pass, the full verification gate, and the spec's changelog and Implementation Status.

### File Manifest

| File | Action | Phase |
|------|--------|-------|
| `packages/core/src/modules/customers/lib/dealsTimeline.ts` (+ `__tests__`) | Create | 1 |
| `packages/core/src/modules/customers/data/validators.ts` | Modify (saved-view schema) | 1 |
| `packages/core/src/modules/customers/api/deals/route.ts` | Modify (additive `hasExpectedCloseAt`) | 1 |
| `packages/core/src/modules/customers/api/deals/timeline/route.ts` (+ `__tests__`) | Create | 1 |
| `packages/core/src/modules/customers/backend/customers/deals/pipeline/components/ViewTabsRow.tsx` | Modify | 1 |
| `packages/core/src/modules/customers/backend/customers/deals/timeline/page.meta.ts`, `page.tsx` | Create | 1 |
| `packages/core/src/modules/customers/backend/customers/deals/timeline/components/*` | Create | 1–2 |
| `packages/core/src/modules/customers/backend/customers/deals/page.tsx` | Modify (`hasExpectedCloseAt` URL filter) | 1 |
| `packages/core/src/modules/customers/backend/customers/deals/timeline/components/TimelineDealDrawer.tsx` | Create (on `@open-mercato/ui/primitives/drawer`) | 1 |
| `packages/core/src/modules/customers/i18n/{en,pl,de,es,ko}.json` | Modify | 1–2 |
| `packages/core/src/modules/customers/__integration__/TC-CRM-TL-00{1,2,3}.spec.ts` | Create | 1–2 |
| `UPGRADE_NOTES.md` | Modify (informational `visibleViews` note) | 1 |
| `packages/core/src/modules/customers/lib/dealsListHref.ts` (+ `__tests__`) | Create (`buildDealsListHref`) | 1 |
| `packages/core/src/modules/customers/components/detail/ScheduleActivityDialog.tsx` | Reuse (no change) | 1 |
| `packages/core/src/modules/customers/backend/customers/deals/[id]/hooks/useDealClosure.ts`, `components/detail/ConfirmDealLostDialog.tsx` | Reuse (extract to a shared hook only if the drawer needs it; no behaviour change) | 1 |
| `BACKWARD_COMPATIBILITY.md` | Modify (`KanbanView` additive-only row) | 1 |
| `packages/core/package.json` | Modify (declare `@dnd-kit/core`, already hoisted) | 2 |

### Testing Strategy

- **Unit:** the bucket library (largest surface); the drawer (URL state, missing-deal param, permission-gated actions, closed deals offering only Schedule follow-up); the Hide closed / Status interaction (pruning, reset, Today keeps filters, saved-view normalization); the query schemas; the timeline route (grouping, lanes, scope, cap); the `hasExpectedCloseAt` filter; `ViewTabsRow`; saved-view payload parsing; the reschedule hook (optimistic move, rollback, conflict).
- **Integration:** below.
- **Manual or preview:** compare against prototype screens s1–s17 in light and dark themes, at a 1024 px viewport and at 200% zoom, and keyboard-only rescheduling.

## 📋 Integration Test Coverage

The specs are self-contained Playwright tests. Fixtures come from `packages/core/src/helpers/integration/crmFixtures.ts` (`createDealFixture` already forwards `expectedCloseAt`, `ownerUserId` and `status`, per the deals list redesign), plus `authFixtures`. Each spec cleans up in `finally` and relies on no seeded data. Dates are computed relative to the test run's "today" in UTC.

**TC-CRM-TL-001: `GET /api/customers/deals/timeline` (API)**
1. Returns `401` without a token and `403` for a role without `customers.deals.view`.
2. With four deals for one owner in a week window (three in one week, one in the next), `perCell=2`: the busy cell has `total: 3` and two items ordered by date then id, and the lane `total` is 4.
3. `groupBy=stage` returns every stage of the fixture pipeline in order, including empty ones.
4. Filter passthrough: `status=open&status=win` (the shipped vocabulary) includes both; the pipeline filter excludes the other pipeline's deal; an owner selected with no deals produces an empty lane.
5. `overdueBefore`, `undatedCount` and `adjacent` match the fixtures. `hasExpectedCloseAt=false` on `GET /api/customers/deals` returns only the undated fixture deal.
6. Org isolation: a deal in a second organization is absent from both lanes and counts.
7. Cell mode: the busy cell's popover request returns all three deals, paged with `pageSize=2`. An `__unassigned` cell returns only owner-less deals, and a `__nostage:<pipelineId>` cell (stage grouping) returns only that pipeline's stage-less deals. A deal dated exactly at the next column's `from` appears only in that next column.
8. Invalid query: `bucket=day`, `columns=9`, `from=2026-13-01` and `cellLane` without `cellColumn` each return `400`. On the list API, `hasExpectedCloseAt=false&isOverdue=true` returns `400`.

**TC-CRM-TL-002: Timeline page, read-only (UI)**
1. From `/backend/customers/deals`, the Timeline tab is visible. Clicking it goes to `/backend/customers/deals/timeline`, with the tab selected.
2. A fixture deal closing this week renders as a card in the "This week" column of its owner's lane, showing title, value and close date.
3. Switching Columns to Month and Group by to Stage updates the URL, and the card moves to the matching cell.
4. A cell with more than three deals shows "+N more", and the popover lists every deal of the cell.
5. With a unique search token in the fixture deals' titles and that token in the timeline search, the fixtures include an open undated deal and a closed (`win`) undated deal. The undated link shows a count of 1, and clicking it opens the List with the "no close date" chip, the same search and the closed-set status condition. It shows exactly the open undated deal; the closed one is absent. The unique token keeps other tests' data out.
6. Saving a view, reloading, and applying the view restores Group by, Columns, the closed-deals toggle and filters (perspectives round trip).
7. Undated journey: from the undated link, open the fixture deal from the List, set its close date to next week, save, return to the same timeline URL, and find the card in next week's column with the undated count reduced by one.
8. Context: from a timeline on a future quarter, "New deal" → Cancel returns to the same window, grouping and filters. Open in List on a month column shows that month's fixture deal and not a fixture deal dated exactly on the first day of the next month.
9. Closed toggle: with a won fixture deal in the window, it is hidden under Hide closed deals and shown muted under All deals. Choosing Won in Status switches the toggle to All deals; switching back to Hide closed deals removes Won from the Status selection and hides the card. Today keeps the filters; Clear filters resets to Hide closed deals. With every fixture deal filtered out, the filter bar stays visible with the no-results state.
10. Layout: at a 1024 px viewport, the board scrolls horizontally, a card's full close date is visible, and the lane name stays visible after scrolling right.
11. Drawer: clicking a card opens the drawer with days in stage and the open-activities count, and adds `?deal=<id>` to the URL; Schedule follow-up with a date next week creates an interaction that the API returns with that `scheduledAt` and the deal's `dealId`, and the drawer's open-activities count goes up by one. Reloading keeps the drawer open; Back closes it with the window and filters unchanged; Escape returns focus to the card; the header's deal title, company and person links open the existing deal, company and person pages, and the browser's Back returns to the same timeline URL with the drawer open. The status badge sits next to the stage. A user without `customers.companies.view` sees the company as plain text. Clicking a "+N more" popover row opens the same drawer.

**TC-CRM-TL-003: Rescheduling (UI, Phase 2)**
1. Dragging a card one week later moves it, and the API readback shows the date shifted by 7 days with the weekday kept. The card's `aria-label` names the new date. The last-operation Undo restores the original date, and the label with it.
2. Keyboard path: focus the card, Enter opens the drawer (Escape closes it and focus returns to the card); choose Change close date in the drawer, enter an exact date, press Cmd/Ctrl+Enter, and the card lands in the matching column.
3. Destination not visible: change a date to one outside the window; the view stays, focus is on the flash's Show deal action, and Show deal moves the window to the card. Repeat for a date whose cell already holds `perCell` cards: Show deal opens that cell's popover with the deal focused.
4. "+N more": from a busy cell's popover, Change close date on a hidden deal reschedules it without leaving the timeline.
5. Drawer: Change close date from an open drawer moves the card; the drawer shows the new date. The drawer is modal, so the board can't be dragged while it is open: dragging the same deal right after closing the drawer, then Mark won from the reopened drawer, succeeds (no stale-version 409). Two quick moves of the same card never write with a stale version: the second is blocked while the first is in flight, or succeeds with the fresh version.
6. Conflict: after the deal is updated through the API behind the page's back, a drag shows the record-conflict bar, the card returns to its origin, and its `aria-label` names the original date.
7. A user without `customers.deals.manage` sees no drag affordance and no Change close date action, and Enter opens the drawer with no mutating actions.
8. Closed deals: under All deals, a won deal has no drag affordance, and its drawer has no Change close date, Change stage, Mark won or Mark lost, only Schedule follow-up. The deal's `updatedAt` from the API is unchanged after a follow-up is scheduled from its drawer. Regression: the CRM summary's won count for the current quarter is unchanged after the page is used to reschedule an open deal next to it.

## 📝 Risks & Impact Review

### Data Integrity Failures
The only write is the existing `PUT /api/customers/deals` route: its CRUD factory layer keeps the optimistic locking, and the `customers.deals.update` command keeps its audit trail, undo and events. A failed write rolls the optimistic move back, so it never leaves a lingering visual state. The endpoint is read-only.

### Cascading Failures & Side Effects
Reschedules emit the existing deal-updated event. Subscribers, notifications and indexing behave exactly as for a form edit. If the timeline endpoint fails, only this page is affected (`ErrorMessage` with retry).

### Tenant & Data Isolation Risks
Every pass and side query goes through the Map route's scope resolution. Company labels are decrypted with the row's own organization scope (`findWithDecryption`). This is covered by TC-CRM-TL-001 §6 and route unit tests.

### Migration & Deployment Risks
There are no migrations; the routes and the param are additive. Rolling back means removing the page and route, and saved timeline perspectives become inert rows.

### Operational Risks
Endpoint cost: the filter build runs once. Each column is one light query of up to 300 rows plus its count probe, so the worst case is 8 columns × 2 = 16 light statements, run two columns at a time. After the column passes come five side queries (overdue, undated, previous, next, scope), also two at a time, so at most two queries are in flight per request. Each side query is the engine's capped count probe plus a 1-row select, so they add about ten statements; the probes visit at most `OM_LIST_COUNT_CAP` + 1 rows each. On top of that come the heavy pass and the stage lookups. Lanes are unbounded, so `lanes × columns × perCell` is bounded only by the light-pass cap: the heavy pass is capped at `TIMELINE_RESPONSE_CARD_CAP` (240 = 8 columns × 3 × 10) decrypted cards per response. Cells beyond the cap return `items: []` with their exact `total`, render as "+N more" and load through cell mode, and the response sets `cardsTruncated: true`. Without the cap the worst case would be 8 × 300 = 2,400 decrypted rows and rendered cards (for example stage grouping across all pipelines). Cell mode costs one paged query. Phase 1 profiles the worst case on a seeded 10k-deal tenant (`OM_PROFILE=customers.*`). If it exceeds the deals-list p95, the follow-up is a grouped count through the query engine, not a raised cap.

### Risk Register

#### Unindexed `expected_close_at` range scans
- **Scenario:** a large tenant's window query scans many rows, because only the `(organization_id, tenant_id)` index narrows it.
- **Severity:** Medium
- **Affected area:** timeline endpoint latency.
- **Mitigation:** the scope index narrows to one tenant and organisation, and each per-column light pass is capped and minimal. Profile with `OM_PROFILE=customers.*` on a seeded 10k-deal tenant during Phase 1, and add a composite index in a follow-up only if p95 exceeds the deals-list p95.
- **Residual risk:** Low.

#### Capped column lane split
- **Scenario:** more than 300 deals match one column, so that column's per-lane split covers only the capped rows.
- **Severity:** Low
- **Affected area:** lane cell counts in that column. The column total stays exact, and the popover lists every deal.
- **Mitigation:** the column is flagged `truncated`, and the UI shows an alert asking the user to narrow the filters. The default week window over open deals rarely approaches the cap.
- **Residual risk:** Accepted.

#### Date-shift surprises across timezones
- **Scenario:** a user in UTC−8 sees a different day than one in UTC+2 for a non-midnight stored value.
- **Severity:** Low
- **Affected area:** card date and bucket.
- **Mitigation:** both the server and the client bucket by the UTC calendar date, and writes normalise to UTC midnight. This matches `dealsMetrics`.
- **Residual risk:** Legacy non-midnight values display by their UTC date, which is accepted.

#### Hidden tab for deployments overriding `visibleViews`
- **Scenario:** an app that overrides the view tabs with an explicit list doesn't show Timeline.
- **Severity:** Low
- **Affected area:** discoverability in customised apps.
- **Mitigation:** this is the documented behaviour, and UPGRADE_NOTES carries an informational note.
- **Residual risk:** None.

#### Status vocabulary drift
- **Scenario:** a tenant renames its won or lost status (PR #7625). A timeline that hard-codes literals would mark closed deals as overdue, or count them as open.
- **Severity:** Medium
- **Affected area:** overdue emphasis, `overdueBefore`, default Status filter.
- **Mitigation:** all classification goes through `lib/dealStatus.ts`, with the resolved vocabulary where #7625 provides it. Route unit tests cover a custom vocabulary once #7625 merges. Whichever of the two PRs merges second wires the vocabulary through.
- **Residual risk:** Low.

#### Closed-deal reschedules shifting reports
- **Scenario:** a won deal is rescheduled in a later quarter; its `updated_at` moves, and the summary reports count the win in the wrong quarter.
- **Severity:** Medium
- **Affected area:** CRM win/loss summary reports and closure statistics.
- **Mitigation:** the timeline offers no write to closed deals (v1): no reschedule, stage change or closure action, covered by TL-003 §8. A stable closure date is a separate follow-up.
- **Residual risk:** Low. Other edit paths (the deal form) can still bump `updated_at` on closed deals, as they do today.

#### Saved-view payload drift
- **Scenario:** a future payload change breaks old saved views.
- **Severity:** Low
- **Affected area:** the saved-views row.
- **Mitigation:** the payload is versioned (`v: 1`), and parsing falls back field by field to defaults.
- **Residual risk:** None.

## 📝 Final Compliance Report — 2026-10-26

### AGENTS.md Files Reviewed
- `AGENTS.md` (root): Task Router rows for API routes, optimistic locking, UI/backend components, DS rules and testing.
- `packages/core/AGENTS.md`: API routes and `openApi`, encryption, commands, cross-module coupling.
- `packages/core/src/modules/customers/AGENTS.md`: `useGuardedMutation` for non-CrudForm writes, reference patterns.
- `.ai/specs/AGENTS.md`, `BACKWARD_COMPATIBILITY.md`, `.ai/ds-rules.md`, `.ai/qa/AGENTS.md`.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Tenant/org scoping on every query | Compliant | Map-route scope scaffold for all passes; integration-tested |
| root AGENTS.md | Zod validation in `data/validators.ts` | Compliant | Saved-view schema in `data/validators.ts`. The timeline query schema is route-local, derived from `dealListQuerySchema` (the Map route precedent), to avoid `data/` importing from an API route |
| root AGENTS.md | Optimistic locking on edit flows | Compliant | Lock header from `updatedAt`; 409 handled by `surfaceRecordConflict` |
| customers AGENTS.md | Non-CrudForm writes through `useGuardedMutation` with `retryLastMutation` | Compliant | Reschedule hook (step 12) and perspective writes (step 7) |
| core AGENTS.md | Writes through commands | Compliant | Existing `customers.deals.update` |
| core AGENTS.md | `findWithDecryption` for encrypted reads; `openApi` export | Compliant | Deal rows (encrypted `title`) and company labels; route exports `openApi` |
| core AGENTS.md | ACL boundaries respected | Compliant | Stage and pipeline metadata gated on `customers.pipelines.view`; degraded lanes otherwise |
| core AGENTS.md | No cross-module ORM relations | Compliant | Customers-only, plus the perspectives HTTP API |
| root AGENTS.md | `apiCall`/`readApiResultOrThrow`, no raw `fetch` | Compliant | Specified for all client calls |
| root AGENTS.md | No hard-coded strings; `pageSize ≤ 100` | Compliant | i18n ×5; user-facing paging (the cell popover) at most 100; the light pass reads up to 300 rows per column in one internal query, a deliberate internal exception documented under API Contracts |
| DS rules | Status tokens; no arbitrary values or `dark:` overrides | Compliant | Tone maps from `Lane.tsx`; prototype verified token-only |
| Dialog rules | Cmd/Ctrl+Enter submit, Escape cancel | Compliant | `ChangeCloseDateDialog` |
| BACKWARD_COMPATIBILITY.md | Additive changes only | Compliant | Route, page, param, union widening; UPGRADE note |
| specs AGENTS.md | Integration coverage for all new API and UI paths | Compliant | TC-CRM-TL-001/002/003 |

### Verdict
Implemented (Phases 1 and 2, 2026-11-05) and revised through four code-review rounds. No non-compliant items.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — read-only timeline | Done | 2026-11-05 | Steps 1–10 implemented; unit tests and TC-CRM-TL-001/002 passing |
| Phase 2 — rescheduling | Done | 2026-11-05 | Steps 11–15 implemented; TC-CRM-TL-003 passing |

### Detailed Progress
- [x] 1. `lib/dealsTimeline.ts` UTC bucket library (+ unit tests)
- [x] 2. `hasExpectedCloseAt` list filter, contradiction `400` in the list handler (+ tests)
- [x] 3. `dealTimelineSavedViewSchema` and the tolerant parser `lib/dealsTimelineSavedView.ts` (+ tests)
- [x] 4. `GET /api/customers/deals/timeline` with grid and cell mode (+ route tests)
- [x] 5. `ViewTabsRow` gains `timeline`; `BACKWARD_COMPATIBILITY.md` and UPGRADE_NOTES entries
- [x] 6. Page, board, lanes, card, popover, controls, URL state, edge states, `TimelineDealDrawer`
- [x] 7. Saved views on perspectives (`customers.deals.timeline`)
- [x] 8. `buildDealsListHref` and the List's "No close date" chip (+ round-trip tests)
- [x] 9. i18n in `en`, `pl`, `de`, `es`, `ko`
- [x] 10. TC-CRM-TL-001 (API) and TC-CRM-TL-002 (UI read-only)
- [x] 11. `@dnd-kit/core` declared in `packages/core`; drag between cells of one lane
- [x] 12. `useRescheduleDeal` (optimistic move, per-deal rollback, conflict routing)
- [x] 13. `ChangeCloseDateDialog`, keyboard navigation, Show deal focus rule, live `aria-label`
- [x] 14. Read-only and closed-deal affordances
- [x] 15. TC-CRM-TL-003 (UI rescheduling), review pass, verification gate

## Changelog

### 2026-10-26
- Initial specification, from the approved story map and prototype (PR #7999).
- Aligned status classification with the tenant status-vocabulary spec (2026-10-18, PR #7625): no status literals; the fixture vocabulary uses `win`.
- Open Questions resolved:
  - Q1: one spec in two phases.
  - Q2: a new aggregated endpoint.
  - Q3: ISO Monday weeks.
  - Q4: saved views via `perspectives`. The Kanban and Map have none today and the List's DataTable payload doesn't fit a board, so the timeline defines its own payload.
  - Q5: an additive `hasExpectedCloseAt` list filter.
  - Q6: the spec ships on PR #7999.
- Adversarial review response (changes requested; 0 critical, 3 high, 7 medium, 6 low; all addressed):
  - **H1:** the popover moved to a paged cell mode with half-open bounds and `__unassigned` support.
  - **H2:** the undated link is built with `buildDealsListHref`, encoding filters in the advanced-filter tree the List restores.
  - **H3:** `hasExpectedCloseAt` combination rules defined, contradictions rejected with a `400`.
  - **M4:** per-column light passes with exact column totals.
  - **M5:** deal rows read through `findWithDecryption`.
  - **M6/M7:** stage tones from dictionary entries, and stage/pipeline metadata gated on `customers.pipelines.view`.
  - **M8:** overdue divergence from the List's `isOverdue` documented; default Status filter taken from the helper.
  - **M9:** perspective writes guarded.
  - **M10:** the undated integration check made self-contained.
  - **Lows:** dialog wording corrected; page meta and query-schema placement corrected versus the Map route; owner names resolved on the server; `KanbanView` BC row; value tie-break dropped; undo reload noted.
- Adversarial review, pass 2 (changes requested; 1 critical, 3 high, 3 medium, 3 low; all addressed):
  - **Critical:** no zod refinement on `dealListQuerySchema`. A refined schema makes `.extend()` throw under zod 4, breaking the Map route and `withIdsQueryParam`. The contradiction check moved to the list route handler, with a regression test.
  - **High:**
    - owner names stay client-side behind `customers.roles.view`, because `resolveUserNames` would have widened access and could fall back to emails. A false claim about the summary endpoint was removed;
    - there is no "open-status set", so the Status filter defaults to empty and `excludeClosed` removes the helpers' closed set;
    - the light pass no longer sorts by the encrypted `title`.
  - **Medium:**
    - the inherited single-org behaviour of some list filters is documented;
    - light-pass cost is restated honestly, with a single filter build and the cap lowered to 300;
    - perspective writes send the lock header and handle `duplicate_name`.
  - **Pass-1 follow-through:**
    - truncated columns show "More…" in place of a wrong number;
    - the no-stage lanes are per pipeline (`__nostage:<pipelineId>`);
    - the date-then-value ordering left in TL-001 was fixed;
    - the schema placement contradiction was fixed.
  - **Low:**
    - the impossible deleted-stage edge case was replaced with the no-stage case;
    - the `hasExpectedCloseAt=false` + advanced-tree date rule result is documented;
    - the saved-view `pipelineId` is single-select, with `pipelineId[]` kept for API parity.
- Deviations from the prototype, made during research:
  - Undo uses the shell's `LastOperationBanner` instead of a timeline-specific Undo flash.
  - Bucketing uses the UTC calendar date, because `expected_close_at` is `timestamptz`.

### 2026-10-29
- Specification review on PR #7999 (changes requested; 2 medium, 7 low, 1 nit; all addressed):
  - **M1:** `buildDealsListHref` carries `excludeClosed` as a `status is_none_of` closed-set condition; TL-002 §5 adds a closed undated fixture asserted absent; the round-trip test covers it.
  - **M2:** i18n lists all five customers locales, including `ko`.
  - **L1:** saved-views wording corrected (the List already uses DataTable perspectives) and the separate payload justified.
  - **L2:** explicit `orderBy: { createdAt, id }` for the primary company link.
  - **L3:** the timeline route drops close-date, overdue and advanced-tree params, and merges the window and `$nin` into the builder's operator objects.
  - **L4:** heavy pass capped at `TIMELINE_RESPONSE_CARD_CAP` (240) with `cardsTruncated`.
  - **L5:** `valueAmount` pinned to `number | null`, as in the Map endpoint.
  - **L6:** "New deal" referenced from the Kanban, not the Map.
  - **L7:** Phase 2 declares `@dnd-kit/core` in `packages/core/package.json`.
  - **Nit:** optimistic locking attributed to the CRUD factory/mutation-guard layer of `PUT /api/customers/deals`.

### 2026-11-02
- Design review on PR #7999 (changes requested, 12 points plus one prototype bug; all addressed). Decisions agreed with the author:
  - **1:** minimum column width (`12rem`), horizontal scrolling with a pinned lane-header column; 1024 px and 200% zoom in the visual acceptance and TL-002.
  - **2:** click and Enter always open the deal (in the drawer, see below); an explicit Change close date action in the drawer, which also opens from "+N more" popover rows (no separate card menu).
  - **3:** when the new date isn't visible, the view stays, the flash offers Show deal, and focus goes to that action.
  - **4:** a visible Hide closed deals / All deals toggle replaces the hidden default; reset and saved-view rules defined.
  - **5:** `buildTimelineHrefFromList` carries the supported List conditions and names the dropped ones; "New deal" returns to the full timeline URL.
  - **6:** `scopeHasDeals` separates first run from no results; four organization cases covered.
  - **7:** truncation alert says owners may be missing, partial counts render as "{n}+", and Open in List covers the whole period.
  - **8:** the deal drawer carries activity, days in stage and the stalled flag, reusing the existing follow-up, stage and closure actions.
  - **Deal drawer (author decision):** click and Enter open `TimelineDealDrawer` instead of navigating to the details page. Summary and existing actions only, no edit form (keeps closed deals view-only); `?deal=<id>` URL state; the header's title, company and person link to the existing CRM pages (each gated by that page's feature; reused unchanged, no `returnTo`, the browser's Back returns to the timeline), and the status badge sits next to the stage; focus return, overlay on narrow screens, re-read after writes for optimistic locking.
  - **9:** closed deals are view-only on the board until reporting has a stable closure date; regression test added.
  - **10/11:** new "CRM and Sales Workflow Consistency" section: no deal↔Sales link today, status ownership, reschedule scope, and the follow-up integration flow.
  - **12:** the undated journey is an integration test; repeated postponements listed as a follow-up.
  - **Prototype:** card `aria-label` now updates after a move and Undo; tests cover move, Undo and rollback.
- Re-review Low (PR #7999): `REQUIREMENTS.md` aligned with the spec (US-A1 ordering, US-A4 default, US-C1 Undo, US-C2 action), and the spec states it supersedes the story map where they differ.
- Drawer header: the deal title, primary company and primary person link to their existing CRM pages (`/backend/customers/deals/{id}`, `/backend/customers/companies-v2/{id}`, `/backend/customers/people-v2/{id}`), each shown as a link only with that page's feature; the status badge moved next to the stage; no separate Full page link and no `returnTo` claim. The response items gain `primaryPerson`.
- Removed the card menu: every card action (Change close date, links to the existing CRM pages) lives in the deal drawer, which also opens from "+N more" rows.
- Prototype aligned with the spec: Hide closed deals / All deals toggle with an empty Status filter, a saved-views row, date-then-id ordering, Undo in the shell's last-operation banner (screen 5 and the live drag), the Show deal focus rule (screen 6), the undated link and Show closed deals on no results (screen 10), first run tied to `scopeHasDeals` (screen 11), the timeline endpoint and 300-per-column cap (screen 12), and the undated link without a status word. The spec lists the states it specifies that the prototype doesn't draw.

### 2026-11-03
- Merged the latest `upstream/main`.
- Second design review on PR #7999 (5 points plus an optional layout suggestion). Decisions agreed with the author:
  - **1:** closed deals get no writes from the timeline: the drawer hides Change close date, Change stage and Mark won/lost, and keeps Schedule follow-up (an interaction, which doesn't write the deal). Reopening or correcting a result stays on the existing deal page; its reporting effect belongs to the closure-date follow-up. TL-003 §8 checks `updatedAt` is unchanged.
  - **2:** Schedule follow-up reuses `ScheduleActivityDialog` (date and time, `dealId` plus the primary person or company), as on the deal page; TL-002 §11 checks the interaction's `scheduledAt` and `dealId`.
  - **3:** the Timeline tab no longer inherits List filters, matching the Kanban and Map; `buildTimelineHrefFromList` and the dropped-filters alert are removed.
  - **4:** Hide closed deals and Status can't contradict each other: a closed status switches to All deals, Hide closed deals prunes closed statuses, Today and Prev/Next keep filters, Clear filters resets, saved views load normalized.
  - **5:** Open in List keeps the half-open period (`between` plus `is_before to`); a deal at exactly the next period's start is excluded and tested.
  - **6 (suggestion, adopted):** the drawer leads with the close date and Change close date, then a compact summary with Change stage beside the stage, activity with Schedule follow-up, and Mark won/lost in a separate section at the bottom. The prototype follows.

### 2026-11-05
- Implemented Phases 1 and 2 (branch `feat/deals-close-date-timeline`). Deviations and additions found during implementation:
  - **Perspectives payload:** `maybeMigrateLegacyFilterValues` (perspectives module) erased any `settings.filters` that wasn't a v2 advanced-filter tree on read, so `filters.timeline` never survived. It now passes through records whose every entry is a versioned (`{ v: number }`) namespaced payload; the legacy flat shape is still dropped. This is a small change outside the customers module.
  - **Response additions (additive):** items carry `pipelineStage` (the stage label for stage lanes without `customers.pipelines.view`), and `overdueBefore.before` is the date the overdue count is bounded by (the earlier of the window start and today), which the "{count} overdue before {date}" label shows.
  - **List 400s:** the `hasExpectedCloseAt` contradiction response carries a translated `error` and a `code` (`undated_with_close_date_range`, `undated_with_overdue`).
  - **Lane count** is pluralised (`customers.deals.timeline.lane.count.{one,few,many,other}`).
  - **Keyboard drag** drops with Space only; Enter always opens the drawer.
  - **No-stage lanes** come back with an empty `stage.label`; the client labels them "No stage" from the `__nostage:` key.

- Browser QA pass (Chrome, local dev). Fixes:
  - **Undated link** is pluralised (`customers.deals.timeline.undated.{one,few,many,other}`), as the lane count is.
  - **Drawer owner** uses the same team-member name as the lane header, falling back to the deal's `owner.name`.
  - **Card value** is never truncated: at the minimum column width the value/date row wraps instead of cutting the amount.
  - **Drag announcements** name the deal and the column (`customers.deals.timeline.reschedule.announce.*`) instead of dnd-kit's English defaults with raw ids.
  - **Integration cleanup:** TC-CRM-TL fixtures delete stages and pipelines by body (`deleteEntityByBody`); those routes ignore `?id=`, so the old cleanup leaked a pipeline per run.
  - **Dialogs above the drawer:** the shared `Drawer` sits on `z-popover` (45) and `Dialog` on `z-modal` (40), so Schedule follow-up, Change close date, Change stage and Mark lost opened underneath it. `TimelineDealDrawer` now sets its content to `var(--z-index-modal)`, so dialogs opened from it stack on top and popovers stay above both. The shared primitive is unchanged; aligning `Drawer` with `Dialog` app-wide is a separate UI-package decision.
- Code-review fix round: explicit sort comparator in saved views; module-facts budgets re-measured; capped counts surfaced as `countsCapped` and rendered as "{n}+"; one count per column with bounded query concurrency; translated timeline route errors; round-robin card cap; parsed-date contradiction check documented in OpenAPI; in-flight reschedule lock; functional URL-state updates; `closed` status in the drawer; app-locale formatting. Integration coverage closed the review gaps: Show deal focus without a manual focus, Show deal opening a full cell's popover, real drag attempts for read-only users and closed deals, a follow-up on a won deal leaving its `updatedAt` unchanged, the summary won-count regression, two quick moves without a stale-version conflict, the cross-org cell-mode probe, the search token carried by the undated link, and `?deal=` with an unknown id.
- Code-review round 2: per-count capped flags (`columns[].countCapped`, `overdueBefore.countCapped`, `undatedCountCapped`; `countsCapped` stays the aggregate) so one capped count no longer marks every count as a floor; saved views are validated before saving (`validateDealTimelineSavedViewForSave`, the same bounds the loader applies, plus status and search length); the Architecture and cost paragraphs describe the single-query light pass, round-robin card allotment and two-at-a-time side queries; the list 400 docs say `needsAttention` "is not `true`".
- Code-review round 3: optimistic and rollback cache writes keep the query's `dataUpdatedAt`, and write locks settle at the write's wall-clock time, so a later drag or another window's older cache can no longer release an earlier deal's lock before fetched data lands; a drawer re-read that fails shows Retry and keeps its writes disabled; URL updates made while a history back is pending wait for it to land (with a timeout fallback); saved-view save errors name the field that failed, and URL search and status values are capped at the saved-view bounds; the spec describes `scopeHasDeals` and the side-query cost as the engine runs them.
