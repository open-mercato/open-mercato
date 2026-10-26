# Deals Close-Date Timeline

## 📝 TLDR

**Key Points:**
- Add a fourth **Timeline** tab to the backend Deals area (`Kanban | List | Map | Timeline`). It lays deals out by `expectedCloseAt` in a lanes × time-bucket grid: **owner** or **pipeline-stage** lanes against **week**, **month** or **quarter** columns. Each deal renders as a compact version of the Kanban `DealCard`.
- A new read-only endpoint, `GET /api/customers/deals/timeline`, returns the grid already bucketed, with exact per-column counts and the top cards per cell. A paged **cell mode** of the same endpoint backs the "+N more" popover. It reuses the deals-list filter builder, so filter semantics stay identical across views.
- Reps reschedule a deal by dragging its card into another column (a whole-bucket shift) or through an exact-date dialog. The write is the existing `PUT /api/customers/deals` (`customers.deals.update` command) with optimistic locking. Undo comes from the shell's `LastOperationBanner`, and a 409 surfaces through `surfaceRecordConflict`.
- Saved views use the existing `perspectives` module (`tableId: customers.deals.timeline`). The deals list gains one additive filter, `hasExpectedCloseAt`, behind the timeline's "N deals have no close date" link. There are no new entities, no migrations and no new ACL features.

**Scope:** one spec, two independently shippable phases. **Phase 1** is the read-only timeline: endpoint, page, saved views and the undated link. **Phase 2** adds rescheduling: drag, the exact-date dialog and conflict handling.

**Input:** the approved story map and clickable prototype in `.ai/prototypes/deals-close-timeline/` (`REQUIREMENTS.md`, `index.html`), reviewed on PR #7999. Story IDs (US-A1…US-D5) below refer to that `REQUIREMENTS.md`.

**Related specs:** `.ai/specs/implemented/2026-05-13-customers-deals-kanban-redesign.md` (filters, overdue rule, `DealCard`), `.ai/specs/2026-06-10-deals-map-view-tab.md` (sibling view-tab and endpoint precedent), `.ai/specs/2026-06-08-deals-list-redesign.md`, `.ai/specs/2026-10-18-deal-status-vocabulary.md` (tenant-configurable statuses).

**Concerns:**
- `customer_deals.expected_close_at` is `timestamptz` with no index. Bucketing is pinned to the UTC calendar date, and window queries rely on the `(organization_id, tenant_id)` index plus a range filter. The endpoint has a documented ceiling (see Risks).
- This is the first deals view with real saved views. The Kanban's saved-views section was a stub and was removed from `CustomizeViewDialog.tsx` (the dialog itself remains), so this spec defines the payload contract.

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
   - runs one **light pass per column** (ids, lane key, close date and sort keys only, through the query engine), each capped at `TIMELINE_COLUMN_CAP`, and groups the results in memory into lane cells. `buildDealListFilters` runs **once** per request and its result is reused for every pass. Each column's `total` is exact (the engine's total, itself bounded by `OM_LIST_COUNT_CAP`); in a capped column only the lane split is partial, and the column is flagged `truncated`. The light pass sorts by `expected_close_at` and `id` only (no encrypted fields), so it never triggers the engine's plaintext-sort decryption path;
   - runs a **page-bounded heavy pass** that loads the deal rows (`title` is encrypted) and the primary company labels through `findWithDecryption`, for at most `perCell` deals per cell;
   - returns owner lanes as ids only. Names are resolved on the client the way the Kanban, List and Map already do (`fetchAssignableStaffMembers`, gated on `customers.roles.view`), so no names or emails reach users outside that gate;
   - adds the side data the view needs: overdue deals before the window, the undated count, and the nearest matching deals before and after the window;
   - in **cell mode** (`cellLane` + `cellColumn`), returns one cell's deals paged (`page`, `pageSize ≤ 100`) with the same filters, the exclusive column bound, and support for the no-owner (`__unassigned`) and no-stage (`__nostage:<pipelineId>`) lanes. The deals list API can express neither of those last two.
2. **A timeline page** at `/backend/customers/deals/timeline`. It shows:
   - `ViewTabsRow` (gaining the `timeline` view);
   - the Kanban/Map `FilterBarRow` with the existing popovers (Status, Pipeline, Owner, People, Companies);
   - a saved-views row (`perspectives`);
   - view controls (Group by, Columns, Prev/Today/Next);
   - the board of compact `TimelineDealCard`s.

   A "+N more" cell opens a popover listing that cell's deals, fetched through the endpoint's cell mode.
3. **Rescheduling (Phase 2).** Dropping a card into another column of the same lane shifts its date by whole buckets, through the pure helper `shiftCloseDate`. The page sends `PUT /api/customers/deals { id, expectedCloseAt }` through `useGuardedMutation`, with the `buildOptimisticLockHeader(updatedAt)` header. It applies the move optimistically, rolls back on failure, and calls `surfaceRecordConflict` on a 409. The command already records an undoable operation, so the shell's `LastOperationBanner` provides Undo. Enter on a focused card opens an exact-date dialog for day precision.
4. **The undated link.** `dealListQuerySchema` gains an additive `hasExpectedCloseAt` boolean, honoured by `buildDealListFilters`. The List page reads it from the URL, using the same pattern as `needsAttention`.
   - The List page restores only `search`, `personId`/`companyId`, `needsAttention` and the advanced-filter tree (`filter[...]`) from the URL; plain `status`, `ownerUserId` and `pipelineId` are ignored.
   - The link is therefore built by a shared helper, `buildDealsListHref(timelineFilters)`, which encodes Status, Owner and Pipeline as an advanced-filter tree, using the tree serializer the List page already deserializes. Search, people and companies go as plain params.
   - This makes the List rows match `undatedCount`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Bucketed grid (week, month or quarter columns), no day axis** | Review feedback on the prototype: a close date is a single point, and day-axis bars implied durations. Buckets match how forecasts are discussed ("this week", "Q4"). |
| **New aggregated endpoint (Q2b)** rather than paging through the list API | Exact "+N more" counts and lane totals at any volume, and one round trip per window. Reusing `buildDealListFilters` keeps filter semantics identical to List, Kanban and Map. |
| **Per-column light pass, then page-bounded heavy pass** | Follows the Map endpoint precedent. Counts need only ids and keys, while decryption and company lookups are bounded by `lanes × columns × perCell`. Capping per column means hitting a cap degrades only that column's lane split. A single ordered pass would silently drop the later columns. |
| **Cell popover is a paged mode of the timeline endpoint** | The list API can't express the popover. `expectedCloseAtTo` is inclusive (`$lte`), so a deal at a bucket boundary would appear in two cells. `ownerUserId` drops `__unassigned`, so the Unassigned popover would return every owner's deals. Cell mode reuses the same filter path and bucket arithmetic, so the popover matches the cell's `total` whenever the column isn't truncated. In a truncated column the grid shows "More…" without a number, and the popover's exact total is authoritative. |
| **Weeks start on Monday (ISO), whatever the locale (Q3a)** | Matches the prototype and keeps bucket keys stable for saved views and URLs. Locale-dependent weeks would also make server buckets depend on the client. |
| **Bucketing by the UTC calendar date of `expected_close_at`** | The column is `timestamptz`. The deal form submits `YYYY-MM-DD`, which is coerced to UTC midnight. `dealsMetrics` already uses UTC quarter windows for the same reason. |
| **Writes reuse `PUT /api/customers/deals`** | `customers.deals.update` already does optimistic locking, audit and undo, and emits events. A dedicated reschedule endpoint would duplicate it. |
| **Undo comes from `LastOperationBanner`**, not a timeline-specific Undo | The shell already offers Undo for the last command through its audit-log undo token. A second Undo control would be inconsistent with the Kanban. |
| **Saved views via `perspectives` (Q4b)** | The module stores per-user views by `tableId`, and `settings.filters` is a free-form record, so timeline state fits with no schema change. The Kanban never shipped saved views. |
| **The window position is not saved** | A saved view is "My Q4 review", not "the week of Oct 19". Views always reopen anchored on today. The URL carries `from` so a link can be shared. |
| **New `TimelineDealCard`** instead of a prop variant of `DealCard` | `DealCard` carries quick actions, an activity badge, days-in-stage and bulk selection. A compact sibling avoids regression risk on the Kanban. Shared tone classes and formatting helpers are reused. |
| **Stage-lane metadata is gated on `customers.pipelines.view`** | With the feature, stage lanes include empty stages, their order, the tone from `customer_dictionary_entries.color` (the Kanban's source) and the pipeline name. Without it, lanes derive only from the deals in the window, labelled with the deal's own `pipelineStage` text (already visible to `customers.deals.view` users), in a neutral tone, and grouped by `pipelineId` without a name. No pipeline metadata leaks beyond the existing gate. |
| **Open, won and lost are classified only through `lib/dealStatus.ts`** | Status spellings are becoming tenant-configurable (`.ai/specs/2026-10-18-deal-status-vocabulary.md`, PR #7625). The server passes the request's resolved vocabulary when that lands. The client uses the vocabulary the settings endpoint delivers, falling back to the shipped helpers. No `'open'`/`'win'`/`'lost'` literals in timeline code. `lib/dealStatus.ts` defines *open* as "not closed" and has no open-status list. So the Status filter defaults to empty, as on the Kanban and Map, and the endpoint's `excludeClosed` (default `true` while no Status filter is set) adds a `status $nin` condition built from the helpers' closed set (`CLOSED_DEAL_STATUS_LIST` expanded through `expandDealStatusAliases`, or the resolved vocabulary once #7625 lands). Choosing any status in the popover disables `excludeClosed`. |
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
       └─ [Phase 2] ChangeCloseDateDialog (Enter on a focused card)

/api/customers/deals/timeline  (custom GET route)
  ├─ zod (route-local, derived from dealListQuerySchema): filter subset + grid params
  ├─ buildDealListFilters(query, ctx) + per-column [from, to) window
  ├─ light pass per column (queryEngine, minimal fields, ≤ TIMELINE_COLUMN_CAP rows, exact total)
  ├─ in-memory grouping → lane cells → top perCell ids per cell
  ├─ heavy pass (deal rows + primary company labels via findWithDecryption)
  ├─ owner lanes as ids (names resolved client-side) · stage lanes (metadata gated on customers.pipelines.view)
  ├─ side queries: overdueBefore, undatedCount, adjacent {previous, next}
  └─ cell mode: one lane × column, paged (page, pageSize ≤ 100)
```

- **Pure library (`lib/dealsTimeline.ts`):** `buildTimelineColumns(bucket, from, count)`, `bucketIndexFor(date, columns)`, `alignToBucketStart(date, bucket)` and `shiftCloseDate(date, bucket, delta)`. The server and client share it, so bucket and shift rules have one source of truth. All of it is UTC date-only arithmetic.
- **Server/client boundary:** the page and components are client components, like every deals backend page. The only server addition is the route, plus the additive list filter.
- **`"use client"` ledger:** `timeline/page.tsx` and the components under `timeline/components/`. There are no provider or shell changes.
- **Events and commands:** none new. Reschedules ride `customers.deals.update`, which already emits the deal-updated event, writes the audit log and invalidates caches.
- **Bundle:** `@dnd-kit/core` is already used by the Kanban. No new dependencies.

## 📝 Data Models

No new entities and no migrations.

### Used as-is
- **`CustomerDeal` (`customer_deals`):** `id`, `title` (**encrypted**, `encryption.ts`, so reads go through `findWithDecryption`), `status`, `pipelineId`, `pipelineStageId`, `valueAmount`, `valueCurrency`, `probability`, `expectedCloseAt` (**`timestamptz`, nullable, not indexed**), `ownerUserId`, `updatedAt` (lock version), plus org/tenant scope and soft delete.
- **`CustomerDealCompanyLink` → company `CustomerEntity`:** supplies the card's primary company label. The first linked company by link creation is used, matching the Map endpoint's company ordering. Decrypted via `findWithDecryption`.
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
  - **`bucket`:** `'week' | 'month' | 'quarter'`, default `'week'`.
  - **`from`:** `YYYY-MM-DD`. Defaults to the start of the bucket before the current one: last week, the current month, or the current quarter. Any value is aligned down to its bucket start.
  - **`columns`:** integer 1–8, default 5 for weeks and 4 for months and quarters.
  - **`groupBy`:** `'owner' | 'stage'`, default `'owner'`.
  - **`perCell`:** integer 1–10, default 3.
  - **`excludeClosed`:** boolean, default `true` when no `status` is given and ignored when `status` is given. Excludes deals the status helpers classify as closed (won or lost).
  - **Cell mode:** `cellLane` (an owner id, a stage id, `__unassigned` for no owner, or `__nostage:<pipelineId>` for no stage) together with `cellColumn` (`0…columns-1`), plus `page` (≥ 1) and `pageSize` (1–100, default 50). Giving one without the other is a `400`, checked in the handler after parsing (no schema refinement).
- **Response `200`:**

```jsonc
{
  "bucket": "week", "groupBy": "owner", "weekStartsOn": 1,
  "from": "2026-10-19", "to": "2026-11-23",          // to = exclusive end
  "columns": [{ "index": 0, "from": "2026-10-19", "to": "2026-10-26", "isCurrent": false,
                "total": 14, "truncated": false }],   // total exact; truncated = lane split partial
  "lanes": [{
    "key": "uuid | __unassigned | __nostage:<pipelineId>", // ownerUserId or pipelineStageId
    "kind": "owner",                                  // 'owner' | 'stage'
    "owner": { "id": "uuid" },                       // owner lanes; display name resolved client-side
    "stage": null,                                    // stage lanes: { label, pipelineId, order?, tone?, pipelineName? } (optional fields need customers.pipelines.view)
    "total": 8,                                       // deals in window for this lane
    "cells": [{
      "column": 1, "total": 5,
      "items": [{
        "id": "uuid", "title": "LIMS migration", "status": "open",
        "valueAmount": 91000, "valueCurrency": "EUR", "probability": 65,
        "expectedCloseAt": "2026-11-02",              // UTC calendar date
        "pipelineId": "uuid", "pipelineStageId": "uuid",
        "ownerUserId": "uuid|null", "updatedAt": "2026-10-23T09:12:44.120Z",
        "primaryCompany": { "id": "uuid", "label": "Veridian Labs" } // or null
      }]
    }]
  }],
  "overdueBefore": { "count": 3, "latestExpectedCloseAt": "2026-10-14" }, // open deals before `from` and before today
  "undatedCount": 12,                                  // matching deals with expected_close_at IS NULL
  "adjacent": { "previous": "2026-10-14", "next": null }, // nearest matching close dates outside the window
  "truncated": false                                   // any column hit TIMELINE_COLUMN_CAP (300)
}
```

- **Cell-mode response:** `{ "lane": "uuid|__unassigned|__nostage:<pipelineId>", "column": 1, "items": [ /* same item shape */ ], "total": 5, "page": 1, "pageSize": 50, "totalPages": 1 }`. The items use the same ordering as the grid.

- **Lane rules:**
  - **Owner lanes:** owners with at least one matching deal in the window, plus every owner explicitly selected in the `ownerUserId` filter (even with zero deals). The client sorts them by resolved name; owners it can't resolve (beyond the staff lookup's 100-member page, or without `customers.roles.view`) show a generic "Owner" label with initials from the id and sort last, before `__unassigned`, which always comes last. In a truncated column, an owner whose deals all fall beyond the cap has no lane until the filters are narrowed; the truncation alert says so.
  - **Stage lanes (with `customers.pipelines.view`):** every stage of the selected pipeline(s) in pipeline order, empty ones included. With several or all pipelines they are grouped by `pipelineId`, with the pipeline name.
  - **Stage lanes (without it):** only stages that have deals in the window, ordered by label, with no pipeline name.
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

All four locales (`en`, `pl`, `de`, `es`) go in `packages/core/src/modules/customers/i18n/*.json`:

- **Labels:** `customers.deals.kanban.view.timeline` is the tab label ("Timeline"). `customers.nav.deals.timeline` is the page title and breadcrumb ("Deals Timeline").
- **`customers.deals.timeline.*`:**
  - controls: `groupBy.label`, `groupBy.owner`, `groupBy.stage`, `columns.label`, `columns.week`, `columns.month`, `columns.quarter`, `nav.previous`, `nav.today`, `nav.next`;
  - column headers: `column.week` ("Week {number}"), `column.thisWeek`, `column.thisMonth`, `column.thisQuarter`;
  - lanes: `lane.unassigned`, `lane.count` ("{count} deals", pluralised), `lane.collapse`, `lane.expand`;
  - cards and cells: `card.aria` (composed label), `cell.more` ("+{count} more"), `cell.popoverTitle`;
  - edge links: `overdueBefore` ("{count} overdue before {date}"), `undated` ("{count} deals have no close date", with no status word because the Status filter is applied);
  - empty, error and saved-view states: `empty.noDeals.*`, `empty.noResults.*`, `jump.previous`, `jump.next`, `loadError`, `truncated`, `savedViews.*`;
  - Phase 2: `reschedule.success`, `reschedule.error`, `reschedule.dialog.title`, `reschedule.dialog.current`, `reschedule.dialog.quick.*`, `reschedule.readOnlyHint`.
- **List chip:** `customers.deals.list.filters.noCloseDate`.
- Dates and currency are formatted through the existing locale-aware helpers (`formatCurrency` from `components/detail/utils.ts`). No hard-coded user-facing strings.

## 📝 UI/UX

The prototype in `.ai/prototypes/deals-close-timeline/index.html` (screens s1–s16) is the visual reference. It must be implemented with DS tokens and primitives. Only behaviour that the prototype can't show unambiguously is specified here.

- **Page scaffold:** mirrors `map/page.tsx`:
  - breadcrumb Deals → Deals Timeline;
  - an `h1` and a `SearchInput` (`w-64`);
  - "New deal" (`customers.deals.manage` only), linking to `/backend/customers/deals/create?returnTo=/backend/customers/deals/timeline`;
  - `ViewTabsRow`, resolved through the component registry (`VIEW_TABS_ROW_COMPONENT_ID`).
- **Filter bar:** `FilterBarRow` with `StatusFilterPopover` (empty by default, as on the Kanban and Map; closed deals are hidden by the endpoint's `excludeClosed` until a status is chosen), `PipelineFilterPopover`, and `EntityFilterPopover` for Owner, People and Companies. There is **no** `CloseDateFilterPopover`, because the window already bounds close dates, and no `SortByPopover`, because the order is by date.
- **Saved views row:** chips for the user's `perspectives` (`ViewChip`), "Save view" (`NewViewForm`) and delete. It is hidden without `perspectives.use`. Saving, renaming (a POST with `perspectiveId`) and deleting are non-`CrudForm` writes, so each goes through `useGuardedMutation(...).runMutation` with `retryLastMutation` (customers `AGENTS.md` rule 6). Rename and delete send `buildOptimisticLockHeader(perspective.updatedAt)`. A `409` with `code: 'duplicate_name'` shows an inline name error in `NewViewForm`; any other `409` goes to `surfaceRecordConflict` and reloads the view list. Role defaults and sharing are out of scope for v1.
- **Controls row:**
  - Group by (`owner` or `stage`) and Columns (`week`, `month` or `quarter`) as segmented controls;
  - Prev/Today/Next move by one column; Today resets `from` to the default anchor;
  - a range label.

  The state is mirrored in the URL (`bucket`, `groupBy`, `from`, plus the filters) so links can be shared.
- **Board:**
  - a CSS grid of a lane-header column (avatar, name and "{n} deals") plus `columns` equal cells;
  - the current column is tinted with the `accent-indigo` alpha tokens and shows a "This week/month/quarter" pill;
  - cells hold up to `perCell` cards, then a "+N more" button that opens `TimelineCellPopover`;
  - the "{n} overdue before {date}" button (status-error tokens) sits above the lanes and moves `from` to the bucket containing `overdueBefore.latestExpectedCloseAt`;
  - the footer has the stage legend and the undated link (`buildDealsListHref({ ...activeFilters, hasExpectedCloseAt: false })`, so the List shows exactly the counted deals).
- **`TimelineDealCard`** (compact `DealCard`, about 4.5rem tall):
  - row 1: the title (truncated) and a probability pill;
  - row 2: the value (`formatCurrency`) and the close date with a calendar icon. Overdue dates (an open deal per `lib/dealStatus.ts`, with a date before today) use status-error tokens and a warning icon, as on `DealCard`;
  - row 3: the primary company, plus an owner avatar when `groupBy=stage`;
  - a left edge in the stage tone, using the `Lane.tsx` tone-class map;
  - deals the status helpers classify as won or lost (only shown when the Status filter includes them) render muted with a status badge;
  - a click or Enter opens `/backend/customers/deals/{id}` (Phase 1). In Phase 2, Enter opens the dialog for managers.
- **Collapsed lanes:** a single row showing per-column counts ("{n} deals", status-error tone when the cell holds an overdue deal), remembered in `sessionStorage`.
- **States:**
  - first run, when the tenant has no deals at all: an `EmptyState` with "Create deal", and the filter and controls rows hidden;
  - no results in the window: an `EmptyState` with "Clear filters" and "Jump to previous/next deal" from `adjacent`;
  - loading: card-sized skeletons inside the real columns, keeping the previous grid dimmed while a new window loads;
  - error: `ErrorMessage` with retry;
  - truncated: a muted `Alert` ("Showing the first {n} deals in this window — narrow the filters").
- **Phase 2, rescheduling:**
  - **Drag:** `@dnd-kit` with `PointerSensor` and `KeyboardSensor`; drop targets are only the cells of the source lane. While dragging, the origin shows a ghost, the target cell is highlighted, and a tooltip shows the resulting date and the shift ("+1 week"). Esc cancels. Dropping on the origin column does nothing.
  - **After a drop:** the card moves optimistically and is re-sorted in its cell. A success flash appears, and the shell's `LastOperationBanner` offers Undo.
  - **Exact-date dialog:** `ChangeCloseDateDialog` holds the current date, a date input, and quick chips (+1 week, +2 weeks, end of month, end of quarter) that are relative to the current close date. Cmd/Ctrl+Enter saves and Escape cancels. Focus returns to the moved card.
  - **Keyboard:** Up/Down moves focus within a cell, Left/Right across columns.
  - **Read-only users** (no `customers.deals.manage`): no drag affordance, and Enter opens the deal. A tooltip explains why.
- **Accessibility:** each card's `aria-label` is composed from the title, company, value, close date and overdue state. Icon-only buttons carry `aria-label`. The drag also works from the keyboard through the `@dnd-kit` `KeyboardSensor`.
- **Page meta (`timeline/page.meta.ts`):** follows the Map page's shape. The Map also requires `customers.activities.view`; the timeline doesn't, because it shows no activity data. Fields: `requireAuth`, `requireFeatures: ['customers.deals.view']`, `pageTitleKey: 'customers.nav.deals.timeline'`, group Customers, `pageOrder: 123`, and breadcrumb Deals → Deals Timeline.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behaviour |
|----------|-----------|
| A deal's `expected_close_at` has a non-midnight UTC time (legacy or import data) | Bucketed and displayed by its UTC calendar date. A reschedule normalises it to UTC midnight. |
| A month shift lands on a day that doesn't exist (Jan 31 + 1 month) | Clamped to the month's last day (Feb 28 or 29). `shiftCloseDate` is unit-tested. |
| Dropping a card into a past column | Allowed without confirmation (story map §7.1). The card turns overdue. |
| A won or lost deal (per the resolved status vocabulary) is dragged | Only possible if the Status filter includes it. The update is allowed (the field is editable), and the overdue treatment never applies to closed deals. |
| An owner is deactivated or unresolvable | The lane shows the generic "Owner" label with initials from the id, and sorts after named owners. This is the Kanban's existing degradation. An additive id lookup on `assignable-staff` is a possible follow-up. |
| A deal has no stage (`pipelineStageId` null) | It appears in its pipeline's "No stage" lane (`__nostage:<pipelineId>`). Stages can't be deleted while active deals reference them (`commands/pipeline-stages.ts` returns 409), so there are no orphaned stage ids. |
| More than `TIMELINE_COLUMN_CAP` matching deals in one column | That column is flagged `truncated`. Its `total` stays exact, its lane split covers only the capped rows, its cells show "More…" without a number, and the popover (cell mode) lists every deal with the exact total. The page shows the truncation alert naming the column. |
| A deal sits exactly on a bucket boundary | Columns are half-open `[from, to)` in both the grid and cell mode, so a deal is counted and listed in exactly one cell. |
| Undo via `LastOperationBanner` | The banner reloads the page after a successful undo. The timeline state lives in the URL, so the view is restored; only collapsed lanes (`sessionStorage`) and open popovers reset. |
| The deal was changed by someone else before the drop | `409`: the card is rolled back and the conflict bar offers Refresh (US-C3). |
| A mutation guard rejects the write (for example, record lock) | `useGuardedMutation` throws, the card is rolled back, and the guard's message is flashed. |
| The perspective payload is invalid or from an older version | Fields fall back to defaults. The view still loads, and a warning is logged. |
| The user lacks `perspectives.use` | The saved-views row is hidden and everything else works. |
| `customers.pipelines.view` is missing | Stage lanes render from the deals in the window: no empty stages, neutral tone, and no pipeline names. |

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
   - `buildDealListFilters` called once, then one light pass per column with a half-open `[from, to)` filter and the `excludeClosed` condition, using internal query-engine paging (`pageSize` 100) up to `TIMELINE_COLUMN_CAP` (300), sorted by `expected_close_at` and `id`, with the engine's `total` as the column total;
   - grouping, then the heavy pass for the top `perCell` ids per cell: deal rows and company labels through `findWithDecryption`;
   - stage lanes, with the metadata gated in-route via `rbacService.userHasAllFeatures` (wildcard-aware) on `customers.pipelines.view` and tones from `customer_dictionary_entries.color`, plus per-pipeline `__nostage:<pipelineId>` lanes;
   - side queries (`overdueBefore`, `undatedCount`, `adjacent`) using the helpers' closed-set exclusion and the UTC date;
   - cell mode;
   - an explicit snake_case→camelCase projection, and the `openApi` export.
   - Unit tests (`api/deals/timeline/__tests__/route.test.ts`) cover:
     - grouping and counts;
     - perCell truncation;
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
     - the 400 cases.
5. **`ViewTabsRow`:** add `timeline` to `KanbanView`, `DEALS_VIEWS`, `VIEW_HREFS` and the label map, and extend the `resolveVisibleViews` unit test.
6. **Page and components (read-only):**
   - `backend/customers/deals/timeline/page.meta.ts` and `page.tsx`;
   - `components/DealsTimelineBoard.tsx`, `TimelineLane.tsx`, `TimelineDealCard.tsx`, `TimelineCellPopover.tsx`, `TimelineControls.tsx`;
   - the URL-state hook `useTimelineUrlState.ts`;
   - empty, loading, error and truncation states, and collapsed lanes in `sessionStorage`.
   - Owner names come from `fetchAssignableStaffMembers` (as on the Kanban). The helper takes no header option, so the call is wrapped in `withScopedApiRequestHeaders({ 'x-om-forbidden-redirect': '0' }, …)` and any error falls back to the generic "Owner" label. The same fallback applies when an owner isn't on the first page.
7. **Saved views:** `TimelineSavedViews.tsx`, built on the perspectives API (`/api/perspectives/customers.deals.timeline`) and the `ViewChip`/`NewViewForm` primitives. Saving, renaming and deleting go through `useGuardedMutation`, with the lock header and the `duplicate_name`/conflict handling described in UI/UX. Applying a view sets the filters, `groupBy` and `bucket` and resets `from`. Unit tests cover payload parse and fallback.
8. **Undated link:**
   - `lib/dealsListHref.ts` provides `buildDealsListHref(filters)`, which encodes Status, Owner and Pipeline into the advanced-filter tree with the serializer `deals/page.tsx` already deserializes, and passes search, people and companies as plain params;
   - the List page reads `hasExpectedCloseAt` from the URL and renders it as a removable chip;
   - a unit test checks the round trip: `buildDealsListHref` → List URL hydration → the same filter set.
9. **i18n** keys in all four locales, then `yarn generate` and `yarn i18n:check-sync`.
10. **Integration tests** TC-CRM-TL-001 (API) and TC-CRM-TL-002 (UI, read-only) — see Integration Test Coverage. Final IDs follow the repo's next free `TC-CRM-*` numbers at implementation time.

### Phase 2: rescheduling

11. **Drag:** wire `@dnd-kit` (`PointerSensor` and `KeyboardSensor`) into `DealsTimelineBoard`, with drop targets limited to the source lane and computation through `shiftCloseDate`. Add the ghost, target highlight and tooltip, Esc to cancel, and a no-op on the origin column.
12. **Reschedule mutation:** `useRescheduleDeal.ts`, which:
    - updates the query cache optimistically;
    - sends `PUT /api/customers/deals` inside `useGuardedMutation(...).runMutation` with `withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), …)` and passes `retryLastMutation` in the injection context;
    - on failure rolls back and calls `surfaceRecordConflict`, otherwise flashes the error;
    - on success flashes and invalidates the timeline query; Undo comes through `LastOperationBanner`.

    Unit tests cover the cache move, rollback and conflict routing.
13. **`ChangeCloseDateDialog.tsx`** with keyboard navigation between cards (Up/Down and Left/Right), Enter to open, Cmd/Ctrl+Enter to save, Escape to cancel, and focus returning to the card.
14. **Read-only affordances** without `customers.deals.manage`: no drag, Enter opens the deal, and a tooltip hint.
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
| `packages/core/src/modules/customers/i18n/{en,pl,de,es}.json` | Modify | 1–2 |
| `packages/core/src/modules/customers/__integration__/TC-CRM-TL-00{1,2,3}.spec.ts` | Create | 1–2 |
| `UPGRADE_NOTES.md` | Modify (informational `visibleViews` note) | 1 |
| `packages/core/src/modules/customers/lib/dealsListHref.ts` (+ `__tests__`) | Create (undated link builder) | 1 |
| `BACKWARD_COMPATIBILITY.md` | Modify (`KanbanView` additive-only row) | 1 |

### Testing Strategy

- **Unit:** the bucket library (largest surface); the query schemas; the timeline route (grouping, lanes, scope, cap); the `hasExpectedCloseAt` filter; `ViewTabsRow`; saved-view payload parsing; the reschedule hook (optimistic move, rollback, conflict).
- **Integration:** below.
- **Manual or preview:** compare against prototype screens s1–s16 in light and dark themes, and keyboard-only rescheduling.

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
5. With a unique search token in the fixture deals' titles and that token in the timeline search, clicking the undated link opens the List with the "no close date" chip and the same search. It shows exactly the fixture's undated deal, so other tests' data can't interfere.
6. Saving a view, reloading, and applying the view restores Group by, Columns and filters (perspectives round trip).

**TC-CRM-TL-003: Rescheduling (UI, Phase 2)**
1. Dragging a card one week later moves it, and the API readback shows the date shifted by 7 days with the weekday kept. The last-operation Undo restores the original date.
2. Keyboard path: focus the card, press Enter, enter an exact date, press Cmd/Ctrl+Enter, and the card lands in the matching column.
3. Conflict: after the deal is updated through the API behind the page's back, a drag shows the record-conflict bar, and the card returns to its origin.
4. A user without `customers.deals.manage` sees no drag affordance, and Enter opens the deal.

## 📝 Risks & Impact Review

### Data Integrity Failures
The only write is the existing `customers.deals.update` command, which keeps its optimistic locking, audit trail, undo and events. A failed write rolls the optimistic move back, so it never leaves a lingering visual state. The endpoint is read-only.

### Cascading Failures & Side Effects
Reschedules emit the existing deal-updated event. Subscribers, notifications and indexing behave exactly as for a form edit. If the timeline endpoint fails, only this page is affected (`ErrorMessage` with retry).

### Tenant & Data Isolation Risks
Every pass and side query goes through the Map route's scope resolution. Company labels are decrypted with the row's own organization scope (`findWithDecryption`). This is covered by TC-CRM-TL-001 §6 and route unit tests.

### Migration & Deployment Risks
There are no migrations; the routes and the param are additive. Rolling back means removing the page and route, and saved timeline perspectives become inert rows.

### Operational Risks
Endpoint cost: the filter build runs once. Each column is up to 3 OFFSET pages of 100, and each page re-runs the engine's count probe, so the worst case is 8 columns × 6 queries = 48 light queries. The default (5 week columns over open deals) is typically 5 pages and 5 count probes. On top of that come the heavy pass (at most `lanes × columns × perCell` deals), stage lookups and three small side queries. Cell mode costs one paged query. Phase 1 profiles the worst case on a seeded 10k-deal tenant (`OM_PROFILE=customers.*`). If it exceeds the deals-list p95, the follow-up is a grouped count through the query engine, not a raised cap.

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
| root AGENTS.md | No hard-coded strings; `pageSize ≤ 100` | Compliant | i18n ×4; popover and light-pass paging at 100 |
| DS rules | Status tokens; no arbitrary values or `dark:` overrides | Compliant | Tone maps from `Lane.tsx`; prototype verified token-only |
| Dialog rules | Cmd/Ctrl+Enter submit, Escape cancel | Compliant | `ChangeCloseDateDialog` |
| BACKWARD_COMPATIBILITY.md | Additive changes only | Compliant | Route, page, param, union widening; UPGRADE note |
| specs AGENTS.md | Integration coverage for all new API and UI paths | Compliant | TC-CRM-TL-001/002/003 |

### Verdict
Draft, ready for review. No non-compliant items.

## Implementation Status
- [ ] Phase 1: read-only timeline
- [ ] Phase 2: rescheduling

## Changelog

### 2026-10-26
- Initial specification, from the approved story map and prototype (PR #7999).
- Aligned status classification with the tenant status-vocabulary spec (2026-10-18, PR #7625): no status literals; the fixture vocabulary uses `win`.
- Open Questions resolved:
  - Q1: one spec in two phases.
  - Q2: a new aggregated endpoint.
  - Q3: ISO Monday weeks.
  - Q4: saved views via `perspectives`. The Kanban has none today, so the timeline defines the payload.
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
