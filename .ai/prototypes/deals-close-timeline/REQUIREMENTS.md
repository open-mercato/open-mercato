# Deals — Expected Close Timeline: requirements and story map

Input for the prototype under `.ai/prototypes/deals-close-timeline/`. This is **not** a spec. It
sets the vocabulary and per-state behavior so the prototype can be checked against something.
Status: **approved 2026-10-26** with the proposed defaults for §7.

## §1 Problem

Reps and sales managers can see `expectedCloseAt` only as a column in the deals list, a field on a
kanban card, or the "Overdue" subtitle. No view answers *"what is closing when, and whose is it?"*
at a glance. A pipeline review today means sorting the list by close date and scanning
row by row. Slipped or bunched-up deals get missed.

## §2 Existing building blocks (verified in code)

- `CustomerDeal.expectedCloseAt` is a nullable bare date
  (`packages/core/src/modules/customers/data/entities.ts:347`).
- Overdue = `status='open' AND expected_close_at < today`
  (`.ai/specs/implemented/2026-05-13-customers-deals-kanban-redesign.md`).
- `GET /api/customers/deals` already filters by `expectedCloseAtFrom/To`, `status[]`,
  `pipelineId[]`, `ownerUserId[]`, `isOverdue`, and sorts by `expectedCloseAt`.
- Deals already has sibling views: list (`/backend/customers/deals`), pipeline kanban
  (`/deals/pipeline`), map (`/deals/map`, `.ai/specs/2026-06-10-deals-map-view-tab.md`).
- ACL: `customers.deals.view` (read), `customers.deals.manage` (write).
- Optimistic locking is on by default, so rescheduling must send the deal's `updatedAt`.

## §3 Decisions being prototyped

1. **Placement**: a new **Timeline** tab next to List / Pipeline / Map on the Deals page. It shares
   that page's saved views and reuses the Kanban/Map `FilterBarRow` with dropdown chips: Status,
   **Pipeline** (`PipelineFilterPopover`: single-select, "All pipelines" plus each pipeline with its
   deal count), Owner, People and Companies. The close-date chip is omitted because the timeline
   window already bounds close dates.
2. **Columns**: time buckets, not a day axis. Column size is **Week / Month / Quarter**, defaulting
   to Week (last week, this week, three weeks ahead). The current bucket is tinted and labelled
   "This week/month/quarter". Single days are never drawn as columns.
3. **Rows (swimlanes)**: grouped by **Owner** (default) or **Pipeline stage**. Toggling changes only
   the grouping, never the filters.
4. **Deal card**: a compact version of the Kanban `DealCard` (title, probability, value, close
   date, company; owner avatar when lanes are stages), about 4.5rem tall instead of about 11rem.
   It has a stage-coloured left edge. It sits in the cell for its bucket, and its date line
   carries the exact day, so card width never implies a duration. Overdue uses the Kanban card's
   status-error date treatment.
5. **Drag to reschedule**: dragging a card into another column of the same lane changes
   `expectedCloseAt` only, shifting it by whole buckets. Dropping it in another swimlane is **not**
   supported in v1, so owner and stage stay unchanged. Exact days are set in the dialog.
6. **Out of scope (v1)**: value roll-ups per bucket, a dedicated undated tray, cross-lane
   drag, and portal or dashboard widgets.

## §4 Story map

### Epic A — See what is closing when

- **US-A1** As a sales rep, I want to see my open deals placed on a timeline by expected close
  date, so that I know what I have to close this month.
  - AC: the Timeline tab loads with week columns starting last week, with all filters inherited.
  - AC: each deal card shows title, probability, formatted value with currency, close date,
    company and stage colour.
  - AC: cards in one cell are sorted by date, then value. With more than 3 in a cell, a "+N more"
    button opens a popover listing all of them with dates.
  - AC: clicking a deal opens the existing deal detail page.
- **US-A2** As a sales manager, I want to switch columns between weeks, months, and quarters, so
  that I can do both a weekly standup and a quarterly forecast review.
  - AC: the column-size control is a segmented toggle, and the selection persists per user (saved view).
  - AC: Prev / Today / Next buttons move by one column, and the range label shows the window.
- **US-A3** As a sales manager, I want overdue deals to stand out, so that slipped deals get
  attention.
  - AC: open deals with a past close date show their date with the status-error token and an alert
    icon, the same as the Kanban card.
  - AC: when the window starts after the oldest overdue deal, a "N overdue before <date>" button
    above the lanes pages back to them.
- **US-A4** As a user, I want closed deals (won/lost) excluded by default, so that the timeline
  shows actionable pipeline.
  - AC: the default status filter is `open`, and enabling won/lost renders those cards muted with
    a status label.

### Epic B — Organize by who owns it or where it stands

- **US-B1** As a sales manager, I want swimlanes per owner, so that I can spot an overloaded
  or empty rep.
  - AC: the lane header shows avatar, name, and "N deals" in range under the name. Deals with no owner go into
    an "Unassigned" lane at the bottom.
- **US-B2** As a sales manager, I want to switch lanes to pipeline stages, so that I can see
  whether late-stage deals are scheduled realistically.
  - AC: stage lanes follow pipeline order. With multiple pipelines selected, lanes are grouped
    under a pipeline subheader.
- **US-B3** As a user, I want to collapse lanes, so that I can focus.
  - AC: a collapsed lane is one line high and shows a per-column deal count, in the error token if
    the column holds an overdue deal. Collapse state persists in the session.

### Epic C — Reschedule by dragging

- **US-C1** As a rep with `customers.deals.manage`, I want to drag a deal to a new date, so that I
  can update forecasts during review without opening each deal.
  - AC: while dragging, a ghost card stays in the origin cell, the target cell is highlighted, and
    a tooltip shows the resulting date. Week columns shift by whole weeks keeping the weekday.
    Month columns shift by whole months and quarter columns by whole quarters, keeping the day of
    month (clamped to month end).
  - AC: on drop the card moves immediately (optimistic) and is re-sorted in its cell, and a flash
    says "Close date moved to <date>" with **Undo** (about 6s).
  - AC: Esc during a drag cancels it, and the card returns to its origin.
  - AC: dropping into the original column does nothing and makes no request.
- **US-C2** As a keyboard user, I want to reschedule without a mouse.
  - AC: with a focused card, `Enter` opens a "Change close date" dialog containing a date input.
    This is also the path for picking an exact day. `Cmd/Ctrl+Enter` saves and `Escape` cancels.
    Arrow Up/Down move focus within a cell, and Left/Right move it across columns.
- **US-C3** As a rep, I want to know when my change collided with someone else's edit.
  - AC: a 409 optimistic-lock response reverts the card and shows the shared record-conflict bar
    (`RecordConflictBanner`) with "Refresh" and "Dismiss". There is no overwrite, which matches the existing
    component.
  - AC: any other failure reverts the card and shows an error flash. No silent loss.
- **US-C4** As a read-only user (`customers.deals.view` only), I can browse but not drag.
  - AC: cards have no drag affordance, and the dialog action is hidden. The tooltip says why.

### Epic D — Edge states

- **US-D1** Empty tenant (no deals): an empty state with "Create deal" (if permitted).
- **US-D2** Filters match nothing in range: "No deals close in this period" with "Clear filters"
  and "Jump to next deal" when one exists outside the window.
- **US-D3** Deals with no expected close date: a footer counter "12 deals have no close date →"
  that opens the list view pre-filtered (no tray in v1).
- **US-D4** No access (`customers.deals.view` missing): the standard backend no-access page.
- **US-D5** Load failure: `ErrorMessage` with retry. While loading, card-sized placeholders in
  the real columns.

## §5 Cross-cutting rules

- Dates are bare dates in UTC, so a card never shifts a day or bucket across timezones.
- All strings are translated, and dates and currency are formatted by locale.
- `pageSize` stays ≤ 100 per request. The view fetches by visible date window plus overdue count.
- Colors come from DS stage and status tokens only.

## §6 Screen inventory

| # | Screen / state | Covers |
|---|---|---|
| s1 | Timeline — week columns, lanes by Owner (default) | US-A1, A3, A4, B1 |
| s2 | Timeline — quarter columns, lanes by Stage | US-A2, B2 |
| s3 | Timeline — month columns, "+N more" popover open | US-A1, A2 |
| s4 | Drag in progress (ghost + target cell + date tooltip) | US-C1 |
| s5 | After drop: optimistic move + Undo flash | US-C1 |
| s6 | "Change close date" dialog (keyboard path) | US-C2 |
| s7 | Conflict (409) bar after drop | US-C3 |
| s8 | Read-only user | US-C4 |
| s9 | Collapsed lanes | US-B3 |
| s10 | No results in range | US-D2, D3 |
| s11 | Empty tenant (first run) | US-D1 |
| s12 | Loading skeleton | US-D5 |
| s13 | Load error | US-D5 |
| s14 | No access | US-D4 |
| s15 | Deal detail (click-through target, abbreviated) | US-A1 |
| s16 | Pipeline filter dropdown open | §3.1, US-B2 |

## §7 Resolved questions

1. Dragging a card into a past column needs **no confirmation**. The card turns overdue immediately.
2. ~~Quarter zoom snaps to weeks~~. Superseded by the bucket layout: a drag snaps to whole
   columns, and exact days go through the dialog.
3. The "Unassigned" lane is placed **last**.

Additional decisions made while drawing:

- 2026-10-26 review feedback: no single-day columns, and deals become Kanban-style cards with
  controlled height. This replaced the day-axis pills, whose width misleadingly suggested a
  duration for what is a single close date.
- Week columns show five weeks. Six made the cards too narrow to read the value and date.
- Overdue uses status-error (as on the Kanban card) instead of the status-warning originally
  drafted.
- The timeline route is `/backend/customers/deals/timeline`. Adding `'timeline'` to `DEALS_VIEWS` /
  `KanbanView` in `ViewTabsRow.tsx` is an additive change to an exported type, so check it against
  `BACKWARD_COMPATIBILITY.md`.
- Review feedback: the pipeline is chosen through the same dropdown as on the other deal views,
  not a static chip.
