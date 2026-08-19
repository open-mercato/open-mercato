# Monthly project budgets

**Status:** draft — awaiting review before implementation
**Module:** `packages/core/src/modules/staff` (time tracking)
**Related:** [`2026-08-12-time-tracking-consulting-suite.md`](./2026-08-12-time-tracking-consulting-suite.md) (D-3 currency lock, budget burn)

## TLDR

A project budget is currently one number for the life of the project. Retainers
are not shaped like that: "40 hours a month" is a limit that resets, and the
month a client buys extra is an exception to that month, not a change to the
agreement. This adds a monthly budget period with per-month overrides.

**Decided (2026-08-19): each month is independent.** Unused hours do not carry
forward and an overrun does not reduce the next month. `40h/month` means 40 hours
in every month, and July running to 45h leaves August at 40h.

## Problem

`staff_time_projects` carries `budget_kind` (`none` | `hours` | `amount`),
`budget_value`, `budget_warn_at_percent` and `budget_alerted_at_percent`. Burn is
computed by `computeBudgetBurn` over **every** entry the project has ever
accrued, so:

- A retainer's bar creeps toward 100% over months and then stays there, saying
  nothing useful about the current month.
- The 80% threshold alert (`subscribers/time-project-budget-threshold-notification`)
  fires once for the life of the project rather than once a month, because
  `budget_alerted_at_percent` is a single column.
- There is no way to say "August is 60 hours because they bought extra", short of
  editing the total and losing the original agreement.

## Decisions

**D-1 — Each month is independent.** No carry-over in either direction. The
alternative (a rolling pool) was rejected: correcting a June entry would have to
recompute every subsequent month's limit, so a two-minute edit silently rewrites
a quarter of history, and the number a client was shown last month stops being
reproducible.

**D-2 — The period budget replaces the total, it does not sit beside it.**
`budget_kind` gains a `period` dimension rather than a parallel model, so exactly
one thing computes burn and the detail page cannot show two disagreeing bars.
A project is either budgeted per period or in total, never both.

**D-3 — An override replaces that month's limit, it does not add to it.**
"August = 60h" reads as the limit for August. An additive model ("+20h") makes
the effective limit invisible without arithmetic, and the number people quote to
a client is the effective one.

**D-4 — Overrides are sparse.** Only months that differ from the default are
stored. A project with a flat 40h/month and one exception has one row, not one
row per month since it started. This also means changing the default retroactively
changes every month that was never overridden — which is the intent: the default
*is* the agreement.

**D-5 — Alerts are per period.** `budget_alerted_at_percent` moves onto the
period row, so each month can alert once. A retainer that runs hot in three
consecutive months raises three alerts, not one.

**D-6 — Amount budgets get the same treatment.** `budget_kind: 'amount'` with a
monthly period means "€9,000 a month". The money path already rounds at the entry
and sums upward (D-7 of the parent spec); nothing about that changes.

**D-7 — The period is the calendar month in the tenant's timezone.** Not a
rolling 30 days and not an anniversary cycle. Both were considered; a client
invoice is cut on calendar months, and the report period selector already thinks
in calendar months.

## Data model

### `staff_time_projects` — additive columns

| Column | Type | Notes |
|---|---|---|
| `budget_period` | `text` enum `total` \| `month`, default `total` | `total` is today's behaviour, so existing rows are unchanged |

`budget_value` keeps its meaning: the limit **per period**. With
`budget_period = 'total'` that is the whole project, with `'month'` it is each
month. `budget_alerted_at_percent` stays for `total` projects and is unused when
the period is monthly (see the new table).

### `staff_time_project_budget_periods` — new

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `organization_id` | uuid | scoping, as everywhere |
| `time_project_id` | uuid | FK id, no ORM relation across modules |
| `period_start` | `date` | first day of the month; the month **is** the key |
| `budget_value` | `numeric(14,4)` | the override — null is not allowed; a row exists only to differ |
| `alerted_at_percent` | `integer` nullable | per-period alert marker (D-5) |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | `updated_at` required — this is user-editable (optimistic locking is default ON) |

Indexes: `(organization_id, tenant_id, time_project_id, period_start)` unique
where `deleted_at IS NULL`; `(organization_id, time_project_id)` for the lookup.

A row is created only when a month is overridden. Absence means "use the
project's `budget_value`".

## Computation

`computeBudgetBurn` gains a period-aware sibling rather than being widened in
place, because the existing signature is shared with the portfolio table and the
detail page and must keep answering the total question for `budget_period='total'`
projects.

```
resolveBudgetForMonth(project, overrides, month) -> number | null
computeMonthlyBudgetBurn({ project, overrides, entriesInMonth, month }) -> ProjectBudgetBurn | null
```

The burn shape is unchanged (`percent`, `barPercent`, `tone`), so
`ProjectBudgetCell` renders both without modification — which is the point of
keeping one burn type.

**Entries counted:** those whose `date` falls in the month, scoped to the
project, excluding soft-deleted. Locked entries count: they were worked, and a
closed report does not remove them from the month's consumption.

## UI

**Project form (screen 4).** The existing Budget card gains a period toggle next
to the limit — *Total* / *Monthly*. Choosing Monthly reveals a compact list of
upcoming and recent months with the default value shown greyed, and any month
editable inline. An edited month is visibly an override, with a control to revert
it to the default.

**Project detail.** The Budget KPI shows the **current month** when the period is
monthly, labelled with the month, and the tile footer carries the default so the
reader can see when they are looking at an exception. The Delivery section gains
a small per-month history so a retainer's shape is visible without opening the
form.

**Portfolio table.** The budget column shows the current month's burn for monthly
projects. Sorting and the existing over-budget bulk-selection behaviour are
unchanged; they operate on whatever burn the row reports.

## API

- `GET /api/staff/timesheets/time-projects` — projection gains `budget_period`.
  The `_staff.budget` enricher block gains `period` and, for monthly projects,
  `currentPeriod: { start, value, usedValue, percent }`.
- `GET|PUT /api/staff/timesheets/time-projects/{id}/budget-periods` — list and
  upsert overrides. `PUT` takes `{ periodStart, budgetValue }` and deletes the
  row when the value equals the project default, so reverting leaves no residue.
- Writes go through a command (`staff.timesheets.time_project_budget_period.upsert`)
  with the usual audit/undo/index side effects, and honour optimistic locking.

Guarded by `staff.timesheets.projects.manage`, like every other budget edit.

## Migration

Additive only. `budget_period` defaults to `total`, so every existing project
keeps behaving exactly as it does now and no data is rewritten. No backfill of
`staff_time_project_budget_periods` — an empty table means "no overrides
anywhere", which is correct.

## Testing

Unit:
- `resolveBudgetForMonth` — default, override, override equal to default, month
  before the project started.
- `computeMonthlyBudgetBurn` — under, at warn, over, no budget, amount vs hours.
- Independence (D-1): an overrun in month N leaves month N+1 at its own limit;
  an underrun does not increase it.
- Sparseness (D-4): changing the project default moves every non-overridden month
  and leaves overridden ones alone.

Integration:
- Setting a monthly budget, overriding one month, reverting it.
- Threshold alert fires once per month rather than once per project (D-5).
- A project switched from `total` to `month` and back keeps its total value.

## Open questions

1. **Which months does the form show?** Proposal: the current month, the previous
   two, and the next three, plus a way to reach any month. Showing every month
   since the project started is unusable for a two-year retainer.
2. **Should an override be allowed on a month that is fully closed in a report?**
   It changes a percentage that was already reported. Proposal: allow it, since
   the report itself is frozen and the budget is a management view — but say so in
   the UI rather than letting it look like the report changed.
3. **Does the monthly view need a per-month cost figure for `amount` budgets, or
   is the percentage enough?** Cost is already computed; it is a question of
   whether the form becomes a report.

## Changelog

| Date | Change |
|---|---|
| 2026-08-19 | Initial draft. D-1 (no carry-over) decided by the product owner before drafting; the rolling-pool alternative was rejected because correcting one entry would rewrite every later month's limit. |
