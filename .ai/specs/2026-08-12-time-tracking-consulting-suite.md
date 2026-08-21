# Time Tracking — Consulting Suite (Staff Module Redesign)

## TLDR

**Key Points:**
- Turns the `staff` module's timesheets area into a full consulting time-tracking product: **Customer → Project → Task → Time entry**, Kanban, billable time, rates & cost, customer reports with lock/export, and global rounding rules.
- **Design authority is `.ai/mockups/time-tracking/` (17 screens).** Where the mockups and the current UI disagree, the mockups win.
- **The one thing we keep from the current UI is the editable project × day hours grid** (`backend/staff/timesheets/page.tsx`). It becomes the third timesheet view — Calendar · List · **Grid** — and stays the fastest bulk-entry surface.
- Pages move to a new **"Time tracking"** sidebar group at `/backend/staff/time-tracking/*`. **Internals do not move**: tables stay `staff_time_*`, ACL ids stay `staff.timesheets.*`, API routes stay `/api/staff/timesheets/*`. Zero contract breakage; old page routes 308-redirect.
- §9 proposals (project budgets with burn bars, daily hour targets, retroactive rounding) are **first-class scope**, not a droppable tail.

**Scope:** 10 new tables, 11 additive columns on 2 existing tables, ~22 new API routes, 7 new ACL features, 17 screens across 7 phases.

**Explicitly out of scope:** approval workflow (§10 defers it), an admin role above Team Leader (§10), per-project/per-customer rounding (§10 fixes it global), task hierarchies deeper than one level.

**All open questions are resolved** — see [Resolved Decisions](#resolved-decisions). The two with money attached: an hour already frozen in a closed report is **excluded** from later reports unless deliberately opted in, and money is **rounded at the entry level then summed upward**, so every printed line reconciles by hand.

**Concerns:** rounding semantics touch invoiced amounts; the currency rule must never allow a cross-currency sum; the report lock must hold against *every* write path including the bulk grid save.

---

## Overview

`packages/core/src/modules/staff` today ships a competent internal timesheet: projects, project members, time entries with server-persisted timer segments, a monthly/weekly editable grid, a list view, a projects portfolio view, and two dashboard widgets. It was built for *"how many hours did our employees work"*.

[`2026-08-12-time-tracking-module-requirements.md`](./2026-08-12-time-tracking-module-requirements.md) asks for a different product: *"what do we bill this client, and can we defend the number"*. That needs three things the module has no concept of — **tasks** (the unit work is organised and logged against), **money** (rates, currency, billable/non-billable, cost), and **reports** (a per-customer deliverable that freezes the time it billed).

The mockups in [`.ai/mockups/time-tracking/`](../mockups/time-tracking/) resolve the requirements into 17 concrete screens. They are the design authority for this spec. Their per-screen `notes` blocks flag every place the requirements were silent or self-contradictory; all eight of those are decided in [Resolved Decisions](#resolved-decisions), and two of the decisions deliberately override what the mockup drew.

This spec **extends and refactors** the existing module. It does not fork it. Every existing entity, route, command and event survives; the redesign is additive at the contract layer and a rewrite at the page layer.

---

## Problem Statement

1. **No task layer.** Time attaches to a project. The requirements' whole hierarchy (§2), the Kanban board (§4), and per-task report lines (§8) have nowhere to live.
2. **No money.** `staff_time_projects` has no rate and no currency; `staff_time_entries` has no billable flag and no rate override. Cost (§7) is uncomputable.
3. **No billable/non-billable split.** Every logged minute is treated identically, so a client report cannot separate chargeable work from internal statuses (§8, US-G2).
4. **No reports.** There is no per-customer deliverable, no export, and no way to freeze what was billed (§8, §9, US-G3).
5. **No rounding rule.** Cost math and invoicing need a predictable, auditable rounding policy (§9, §10, US-F3).
6. **Access is not project-scoped in the UI sense.** `staff_time_project_members` exists, but there is no single resolver every route consults, and no graceful "you are not on this project" state (US-A1, US-A2, screen 17).
7. **Entry UX is grid-only.** There is no full entry form, no natural duration parsing (`1h 40m`), no 2-of-3 start/end/duration arithmetic, no overlap warning, no duplicate, no undo-delete (§5, US-D1…D7).
8. **Navigation buries it.** Timesheets sit inside the "Employees" HR group alongside leave requests and availability, which is the wrong mental model for a consultant tracking client work.

---

## Proposed Solution

### The shape

```
customers.customer_entities                (existing, other module — FK by id + snapshot)
        │
        └── staff_time_projects            (EXTENDED: rate, currency, billable default, budget)
                 ├── staff_time_project_members      (existing, unchanged)
                 ├── staff_time_task_statuses        (NEW — Kanban columns, per project)
                 └── staff_time_tasks                (NEW — self-referencing, exactly one level)
                          ├── staff_time_tasks            (child = "subtask"; carries its own time)
                          ├── staff_time_task_comments    (NEW)
                          ├── staff_time_task_tags        (NEW junction)
                          └── staff_time_entries          (EXTENDED: task_id, billable, rate override, lock, rounded_minutes)
                                   ├── staff_time_entry_segments  (existing timer segments, unchanged)
                                   └── staff_time_entry_tags      (NEW junction)

staff_time_reports                         (NEW — always scoped to exactly one customer)
        ├── staff_time_report_projects     (NEW — hand-picked project selection)
        ├── staff_time_report_entries      (NEW — frozen value snapshot per locked entry)
        └── staff_time_report_events       (NEW — close / unlock audit trail with reason)
```

### Navigation and routes

A second sidebar group, `staff.time_tracking.nav.group` → **"Time tracking"**, sits beside the existing "Employees" group. HR pages (team, roles, leave requests, availability, job history) stay where they are.

| Screen | Route | Origin |
|---|---|---|
| 1, 2 — My work / empty state | `/backend/staff/time-tracking` | NEW |
| 3 — Projects | `/backend/staff/time-tracking/projects` | MOVE + EXTEND `timesheets/projects/page.tsx` |
| 4 — New / edit project | `/backend/staff/time-tracking/projects/create`, `/[id]/edit` | MOVE + EXTEND |
| 5 — Project team drawer | `/backend/staff/time-tracking/projects/[id]?panel=team` | NEW |
| 6 — Kanban board | `/backend/staff/time-tracking/projects/[id]/board`, `/backend/staff/time-tracking/board` | NEW |
| 7 — Task detail drawer | `…/board?task=<id>` | NEW |
| 8, 9 — Entry form + edge states | modal, reachable from every screen | NEW |
| 10 — Time entries list | `/backend/staff/time-tracking/entries` | NEW |
| 11, 12 — Timesheet | `/backend/staff/time-tracking/timesheet?period=…&view=calendar\|list\|grid` | NEW views + **KEEP** existing grid |
| 13 — Report config | `/backend/staff/time-tracking/reports/create` | NEW |
| 14 — Report preview | `/backend/staff/time-tracking/reports/[id]` | NEW |
| 15 — Lock / unlock | `/backend/staff/time-tracking/reports/[id]?unlock=1` | NEW |
| 16 — Module settings | `/backend/staff/time-tracking/settings` | NEW |
| 17 — No access | any project-scoped route, guard state | NEW |

Every old `/backend/staff/timesheets*` path returns **308 Permanent Redirect** to its new equivalent, kept for at least one minor release per [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md) and recorded in `UPGRADE_NOTES.md`.

### The timesheet keeps its editable grid

The mockups draw two timesheet views: a month calendar with per-day totals and load bars (screen 11), and a week list with per-day bars and an expandable day (screen 12). Neither replaces what the module already does best — the **project × day table with directly editable hour cells and a bulk save**, which is the fastest way to fill a week.

So the timesheet ships a **three-way view switch**:

| View | Source | Best at |
|---|---|---|
| **Calendar** (screen 11) | NEW | seeing gaps and heavy days across a month |
| **List** (screen 12) | EXTEND `lib/timesheets-ui/ListView.tsx` | closing out a week, day by day |
| **Grid** (kept) | KEEP `backend/staff/timesheets/page.tsx` table | bulk entry — type hours across a whole week in one pass |

Grid stays the default when the period is `week`; calendar becomes the default when the period is `month`. The grid gains three things it lacks today, so it stops being a second-class citizen:

1. Cells use the **shared duration parser** (`1h 40m`, `1:40`, `90m`, `1.5`) instead of its private `decimalToMinutes`.
2. Rows can be **project or project + task** (a row-mode toggle), so grid entries carry `taskId` like every other entry.
3. Cells for **locked** entries render read-only with the lock badge, and the bulk endpoint rejects writes to them.

### Cross-cutting mechanics

**One duration parser, everywhere.** `lib/time-tracking/duration.ts` exports `parseDuration()` / `formatDuration()`. It is the only place any of `1h 40m`, `1.5h`, `90m`, `1:40`, bare `1.5` (= hours) is interpreted. Consumed by the entry form, the quick-entry rows, the inline cell edit on the entries list, the grid cells, the week quick-add, and the task drawer's one-field log. Invalid input never discards what the user typed (US-D2, screen 9 note 1).

**2-of-3 arithmetic.** `lib/time-tracking/interval.ts` holds `deriveInterval({start, end, duration})` → fills the missing third and marks which field was computed. The UI badges the derived field `wyliczone` and re-derives live as the user edits (US-D3, screen 8 note 1). An end earlier than its start is read as **crossing midnight**: the entry ends the following calendar day, the form shows a non-blocking hint saying so, and `date` stays the day the work *started* (D-8). Overlap detection accounts for spans that cross a day boundary.

**Raw time is stored; rounded time is stored beside it.** Screen 8 note 4 flags the contradiction between §5 (tracked time is a field) and §7 (cost comes from rounded time). Resolution: `duration_minutes` keeps the **raw** value the user entered and is what the timesheet and project hour totals display; `rounded_minutes` is computed on every write from the tenant's rounding rule and is the **only** input to cost. Storing it means a later settings change cannot silently restate historic invoices.

**Cost, rounded at the entry then summed upward.** `lib/time-tracking/cost.ts`:
```
rate(entry)   = entry.rateOverrideAmount ?? project.hourlyRate
amount(entry) = entry.isBillable ? round2((roundedMinutes / 60) × rate) : null
lineTotal     = Σ amount(entry)      // task / person / day group
groupTotal    = Σ lineTotal          // project
grandTotal    = Σ groupTotal
```
Money is rounded **once, at the entry**, and every level above is an exact sum of already-rounded values (D-7). Two properties fall out of that: a client adding up the printed lines always arrives at our total, and the total does not move when the report grouping changes from task to person to day. Rounding at the *line* instead would break the second property, since regrouping redraws the line boundaries.

Non-billable yields `null`, never `0` — zero reads as free work rather than out-of-scope work (screen 10 note 5).

**Task hours are always an inclusive rollup.** `loggedMinutes(task) = own entries + Σ children's entries` (D-2). One helper, `lib/time-tracking/rollup.ts`, feeds every surface that shows hours against a task: the board card, the column header sum, the task drawer, the project totals, and the report's task lines. There is deliberately no "including subtasks?" toggle anywhere — the rule is fixed, so no number in the app is ever ambiguous about what it counts.

**Currency never crosses.** Currency lives on the project. No screen sums across currencies: the projects table has no grand-total row (screen 3 note 2), and a report is scoped to one customer whose selected projects must agree on currency — if they do not, report creation is blocked with an explanation naming the offenders.

**Project access is one resolver.** A DI service `timeTrackingAccessResolver` returns `{ canManageAll, projectIds }` for the request. `canManageAll` is true for holders of `staff.timesheets.projects.manage`; otherwise `projectIds` comes from active `staff_time_project_members` rows for the caller's staff member. Every board, task, entry, timesheet and report route filters through it. A denied project route renders screen 17 — an explanation that names neither the customer nor the project, plus a way back (US-A2, screen 17 note 1).

**TL-only actions do not render for a TM** (US-A2). Feature checks gate the render, not the `disabled` attribute.

---

## Architecture

### Where code lives

```
packages/core/src/modules/staff/
├── data/entities.ts                    # + 8 entities, + 9 columns
├── data/validators.ts                  # + task/report/settings zod schemas
├── acl.ts                              # + 7 features
├── setup.ts                            # + defaultRoleFeatures grants
├── events.ts                           # + task/report events
├── notifications.ts                    # + budget threshold, report closed
├── lib/time-tracking/                  # NEW — pure, unit-tested domain helpers
│   ├── duration.ts                     #   parseDuration / formatDuration
│   ├── interval.ts                     #   deriveInterval (2-of-3)
│   ├── rounding.ts                     #   roundMinutes(raw, settings)
│   ├── cost.ts                         #   rate / entry amount / report totals
│   ├── rollup.ts                       #   loggedMinutes incl. child tasks
│   ├── overlap.ts                      #   findOverlaps (midnight-aware)
│   ├── settings.ts                     #   keys + defaults + read/write
│   └── access.ts                       #   resolveProjectAccess
├── lib/time-tracking-ui/               # NEW — shared client components
│   ├── DurationInput.tsx               #   parser-backed, error-preserving
│   ├── TimeEntryDialog.tsx             #   screens 8 + 9
│   ├── QuickEntryRow.tsx               #   screens 1, 7, 12
│   ├── KanbanBoard.tsx                 #   screen 6
│   ├── TaskDrawer.tsx                  #   screen 7
│   ├── TimesheetCalendar.tsx           #   screen 11
│   └── ReportSheet.tsx                 #   screen 14
├── commands/                           # + tasks, subtasks, comments, reports
├── api/timesheets/                     # + tasks, tags, reports, settings routes
└── backend/staff/time-tracking/        # NEW page tree (17 screens)
```

Nothing outside `staff` imports any of this. The module remains extractable into `@open-mercato/staff` per [`2026-05-08-staff-decouple-from-core.md`](implemented/2026-05-08-staff-decouple-from-core.md); the customer link stays FK-id + snapshot, never an ORM relation (root `AGENTS.md` § Architecture).

### Reuse, not reinvention

| Need | Reuse |
|---|---|
| Kanban drag & drop | `@dnd-kit/core` + `sortable`, already a `packages/ui` dependency; **reference implementation**: `customers/backend/customers/deals/pipeline/page.tsx` (lanes, optimistic move, filter popovers, bulk bar) |
| Tag entity + assignment | `customers/data/entities.ts` → `CustomerTag` / `CustomerTagAssignment` shape |
| Module settings storage | `ModuleConfigService` with tenant scope; **reference**: `catalog/api/settings/route.ts` |
| Retro-rounding job | `progress` module `ProgressJob` + a `@open-mercato/queue` worker (root `AGENTS.md` § Operation Progress) |
| Live board / timer updates | `events` DOM Event Bridge — `clientBroadcast: true` on task status + timer events |
| Tables, filters, bulk actions | `DataTable` + `data-table:<id>:*` injection spots |
| Forms | `CrudForm` + `FormFooter` ordering (extra → Delete → Cancel → Save) |
| Optimistic locking | default-ON `updated_at` versioning; `CrudForm` auto-derive, `buildOptimisticLockHeader` for the board's drag PATCH |
| Undo on delete | existing command `undo` handlers, surfaced as the toast action |

### Optimistic locking

Every new user-editable entity (`staff_time_tasks`, `staff_time_task_comments`, `staff_time_task_statuses`, `staff_time_reports`) carries `updated_at`, returns `updatedAt` in list/detail responses, and lets `CrudForm` auto-derive the header. Three non-`CrudForm` paths need explicit handling:

- **Board drag-drop** (`PATCH …/tasks/[id]/status`) — wrap with `buildOptimisticLockHeader(task.updatedAt)`; a 409 rolls the card back to its origin column and shows the conflict bar via `surfaceRecordConflict`.
- **Task drawer inline property edits** (save on blur) — same per-field.
- **Grid bulk save** — exempt per row (each cell writes a distinct entry); the endpoint instead rejects any row whose entry is locked by a report.

`staff_time_report_entries` and the two tag junctions are assignment/snapshot tables and are exempt.

---

## Data Models

### New entities

**`staff_time_task_statuses`** — Kanban columns, configurable per project (D-1).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `organization_id` | uuid | scoping |
| `time_project_id` | uuid | owning project |
| `name` | text | column label |
| `slug` | text | stable id for filters; unique per project |
| `color` | text null | DS chart token key, drives `kcol-accent` |
| `position` | int | column order |
| `is_default` | bool | new tasks land here (US-C1) |
| `is_done` | bool | terminal column; drives `closed_at` on the task |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Seeded on project create from a tenant default template: Backlog · In progress · In review · Done.

**`staff_time_tasks`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `organization_id` | uuid | |
| `time_project_id` | uuid | §2 — a task lives in exactly one project |
| `parent_task_id` | uuid null | a "subtask" is a child task; **exactly one level** — a child may not itself have children |
| `task_status_id` | uuid | children draw from the same project status set |
| `sequence_number` | int | per-project counter, unique with project |
| `reference` | text | denormalized `<project.code>-<sequence_number>`, e.g. `TT-142` |
| `title` | text | the only required field (US-C1) |
| `description` | text null | |
| `assignee_staff_member_id` | uuid null | defaults to creator (US-C1) |
| `position` | int | order within its column |
| `created_by_user_id` | uuid null | |
| `closed_at` | timestamptz null | set when moved into an `is_done` column |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Indexes: `(organization_id, time_project_id, task_status_id, position)`, `(organization_id, parent_task_id)`, `(organization_id, assignee_staff_member_id)`, unique `(organization_id, tenant_id, time_project_id, sequence_number) WHERE deleted_at IS NULL`, unique `(organization_id, tenant_id, reference) WHERE deleted_at IS NULL`.

**Subtasks are child tasks** (D-2). There is no separate subtask table: a subtask is a `staff_time_tasks` row with `parent_task_id` set. That falls out of the decision that subtasks carry time — anything that can hold a time entry is structurally a task, and modelling it twice would mean two CRUD surfaces, two permission paths and two sets of report plumbing.

Consequences, all enforced in the command layer:

- **Depth is capped at one.** Creating or re-parenting a task whose intended parent already has a `parent_task_id` is rejected (`400 subtask_depth_exceeded`). A child task's own drawer therefore shows no "add subtask" affordance.
- **The board shows top-level tasks only** — every board query filters `parent_task_id IS NULL`. Children appear as the checklist inside the parent's drawer, where they gain the one thing a plain checklist could not give them: an assignee and their own logged time.
- **Ticking a child** moves it to the project's first `is_done` status; unticking returns it to the `is_default` status. Done-ness has a single source of truth (the status column) rather than a parallel boolean that could disagree with it.
- **A child inherits nothing implicitly.** It has its own status, assignee, tags and entries. Only the *display* rolls up.
- **Soft-deleting a parent** soft-deletes its children in the same transaction. Entries keep pointing at the deleted task so closed reports still resolve their line labels.
- **Reports group by top-level task** by default, with child time folded into the parent line and expandable underneath — a client-facing sheet stays readable at the level they contracted for.

**`staff_time_task_comments`** — `id`, scoping, `task_id`, `body` text, `author_user_id` uuid null, timestamps.

**`staff_time_tags`** — `id`, scoping, `slug` (unique per org+tenant), `label`, `color` text null, timestamps.

**`staff_time_task_tags`** — `id`, scoping, `tag_id`, `task_id`, unique `(tag_id, task_id)`.

**`staff_time_entry_tags`** — `id`, scoping, `tag_id`, `time_entry_id`, unique `(tag_id, time_entry_id)`.

**`staff_time_reports`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `organization_id` | uuid | |
| `customer_id` | uuid | §8 — a report is always exactly one customer |
| `customer_snapshot` | jsonb | name/tax id at generation; survives the customers module |
| `reference` | text | `RAP-<year>-<seq>`, unique per org+tenant |
| `title` | text | |
| `period_kind` | enum `week\|month\|year\|custom` | a preset that has had either date moved is stored as `custom` (D-4) |
| `period_from`, `period_to` | date | always populated; presets fill them, the user may adjust |
| `currency_code` | text | asserted identical across selected projects |
| `grouping` | enum `project_task\|project_person\|project_day` | |
| `nonbillable_mode` | enum `separate\|exclude` | screen 13 |
| `include_already_reported` | bool | default `false` — entries frozen in an earlier report are skipped unless this is deliberately set (D-5) |
| `show_rates` | bool | screen 13 |
| `rounding_unit_minutes`, `rounding_direction` | int, text | snapshot of the rule at close |
| `status` | enum `draft\|closed` | |
| `total_billable_minutes`, `total_nonbillable_minutes` | int null | frozen at close |
| `total_amount` | numeric(14,2) null | frozen at close |
| `closed_at`, `closed_by_user_id` | timestamptz, uuid null | |
| `created_by_user_id` | uuid null | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

**`staff_time_report_projects`** — `id`, scoping, `report_id`, `time_project_id`, unique `(report_id, time_project_id)`.

**`staff_time_report_entries`** — the freeze record, written only on close.

| Column | Type |
|---|---|
| `id` | uuid PK |
| `tenant_id`, `organization_id` | uuid |
| `report_id`, `time_entry_id` | uuid |
| `frozen_raw_minutes`, `frozen_rounded_minutes` | int |
| `frozen_rate_amount` | numeric(14,4) null |
| `frozen_currency_code` | text |
| `frozen_amount` | numeric(14,2) null — already rounded at the entry (D-7); every total above it is an exact sum |
| `frozen_is_billable` | bool |
| `created_at` | timestamptz |

Unique `(report_id, time_entry_id)`. This table is also what makes D-5 enforceable: "has this entry been reported already?" is a lookup here against reports in `closed` status.

**`staff_time_report_events`** — `id`, scoping, `report_id`, `event_type` enum `closed|unlocked|exported`, `reason` text null (required for `unlocked`), `actor_user_id`, `metadata` jsonb null, `created_at`. Append-only, optimistic-lock exempt.

### Additive columns on existing entities

**`staff_time_projects`** (+7)

| Column | Type | Default | Screen |
|---|---|---|---|
| `hourly_rate` | numeric(14,4) null | — | 4 |
| `currency_code` | text null | — | 4 — read-only once the project has entries (D-3) |
| `billable_by_default` | bool | `true` | 4 |
| `budget_kind` | enum `none\|hours\|amount` | `none` | 4 |
| `budget_value` | numeric(14,4) null | — | 4 |
| `budget_warn_at_percent` | int | `80` | 4 |
| `budget_alerted_at_percent` | int null | — | idempotency for the threshold notification |
| `customer_snapshot` | jsonb null | — | 3, 4, 13 — name and tax id captured on assignment (D-9) |

`customer_id` already exists and stays nullable for BC, but is **dormant**: no foreign key, and no UI has ever populated it. This spec puts it to work pointing at `customers.customer_entities` (D-9), with `customer_snapshot` alongside so the projects list and report header never join across the module boundary. The Time-tracking project form requires the customer (US-B1); existing rows created before this change keep a null customer and surface a "Assign a customer" prompt on the projects list rather than blocking.

`code` stays required and unique. It is now **auto-derived from the name** on create rather than typed (D-10) — `lib/time-tracking/projectCode.ts` owns the derivation and the dedupe, and is unit-tested against diacritics, collisions and the 20-character cap.

**`staff_time_entries`** (+6, and one reinterpretation)

| Column | Type | Default | Screen |
|---|---|---|---|
| `task_id` | uuid null | — | 7, 8 |
| `is_billable` | bool | from project | 8, 10 |
| `rounded_minutes` | int null | computed on write | 8, 14 |
| `rate_override_amount` | numeric(14,4) null | — | 8, 10 |
| `rate_currency_code` | text null | project snapshot at write | 8 |
| `locked_report_id` | uuid null | — | 10, 15 |
| `locked_at` | timestamptz null | — | 10, 15 |

`notes` is **reused as the entry description** (§5) rather than adding a near-duplicate column. The new API surface exposes it as `description`; the legacy `notes` key stays in responses for one minor release.

`started_at` / `ended_at` are full timestamps, so an entry that crosses midnight simply has `ended_at` on the next calendar day (D-8). `date` always records the day the work *started* — it is what the timesheet, the grid and the per-day totals bucket on.

`locked_report_id` / `locked_at` are a denormalized fast path so list queries need no join. `staff_time_report_entries` remains authoritative; the close and unlock commands maintain both inside one `withAtomicFlush` transaction.

Index additions: `(organization_id, task_id)`, `(organization_id, staff_member_id, date, started_at)` for overlap detection, `(organization_id, locked_report_id)`.

### Module settings (not a table)

Stored via `ModuleConfigService`, module id `staff.time_tracking`, **tenant-scoped**, defaults applied when absent:

| Key | Type | Default | Screen |
|---|---|---|---|
| `rounding.unitMinutes` | `0 \| 5 \| 10 \| 15` | `0` | 16 |
| `rounding.direction` | `up \| nearest` | `up` | 16 |
| `defaults.billable` | bool | `true` | 16 |
| `defaults.chainStartFromPreviousEnd` | bool | `true` | 16 |
| `targets.dailyHours` | number \| null | `8` | 11, 12, 16 |
| `warnings.overlap` | bool | `true` | 9, 16 |
| `warnings.runningTimer` | bool | `true` | 16 |
| `access.assignmentGraceDays` | number | `14` | 16 — D-12; days past `assigned_end_date` that project access survives |

§10 fixes rounding as global — there is deliberately no per-project or per-customer override.

---

## API Contracts

All new routes live under the existing STABLE `/api/staff/timesheets/` namespace. Every route exports `openApi`; every non-`makeCrudRoute` write wires the mutation guard registry (`packages/core/AGENTS.md` § API Routes).

### Tasks

| Method | Route | Features | Notes |
|---|---|---|---|
| `GET/POST/PUT/DELETE` | `/api/staff/timesheets/tasks` | `tasks.view` / `tasks.manage` | `makeCrudRoute`, `indexer: { entityType: 'staff:staff_time_task' }`; list filters `timeProjectId`, `taskStatusId`, `assigneeStaffMemberId`, `parentTaskId`, `topLevelOnly`, `tagIds`, `q`; always intersected with `resolveProjectAccess().projectIds`. Create/update reject a `parentTaskId` that itself has a parent (`400 subtask_depth_exceeded`). Responses carry `loggedMinutes` (rollup), `ownMinutes`, and `childCount` |
| `PATCH` | `/api/staff/timesheets/tasks/[id]/status` | `tasks.manage` | `{ taskStatusId, position }`; optimistic-lock header required; emits `…time_task.status_changed` with `clientBroadcast`. Also the subtask tick — the drawer sends the project's first `is_done` status, or `is_default` to untick |
| `GET/POST/PUT/DELETE` | `/api/staff/timesheets/tasks/[id]/comments` | `tasks.view` / `tasks.manage` | |
| `GET/POST/PUT/DELETE` | `/api/staff/timesheets/task-statuses` | `tasks.view` / `projects.manage` | per-project columns; reorder via `position` |
| `GET/POST/DELETE` | `/api/staff/timesheets/tags` | `timesheets.view` / `tasks.manage` | |

There is deliberately no `/subtasks` route — a subtask is a task with `parentTaskId`, created through the same endpoint (D-2).

### Projects

| Method | Route | Features | Notes |
|---|---|---|---|
| `POST` | `/api/staff/timesheets/time-projects/[id]/change-currency` | `projects.manage` | D-3. Body `{ currencyCode, acknowledged: true }`. Returns `409 project_has_locked_entries` listing the blocking reports; otherwise relabels without converting and records the change on the project's activity trail |
| `POST` | `/api/staff/timesheets/access-requests` | `timesheets.view` | D-6. Body `{ timeProjectId? }` — omitted from the empty state, set from screen 17. Notifies `projects.manage` holders; deduplicated to one pending request per user per project per 24h |

### Time entries (extended)

`/api/staff/timesheets/time-entries` gains request fields `taskId`, `description`, `isBillable`, `tagIds[]`, `rateOverrideAmount`, and query filters `taskId`, `isBillable`, `tagIds`, `locked`, `customerId`. Responses gain `roundedMinutes`, `cost`, `currencyCode`, `isLocked`, `lockedReportId`, `tags[]`, and `description` (aliasing `notes`).

| Method | Route | Purpose |
|---|---|---|
| `GET` | `…/time-entries/overlaps?date&startedAt&endedAt&excludeId` | US-D7 — returns overlapping entries; **advisory only**, never blocks a save |
| `POST` | `…/time-entries/[id]/duplicate` | US-D6 — prefills task, description, tags, billable |
| `POST` | `…/time-entries/copy-day` | US-D6 — `{ fromDate, toDate }`, clones the previous working day as editable drafts |
| `POST` | `…/time-entries/bulk` | existing grid save — **now rejects any row whose entry is locked**, returning `409` with the offending ids |

All write paths return `409 time_entry_locked` when the target entry has `locked_report_id`, and the entries list marks such rows read-only (screen 10 note 4).

### Reports

| Method | Route | Features | Notes |
|---|---|---|---|
| `POST` | `/api/staff/timesheets/reports/preview` | `reports.view` | Computes totals **without persisting** — powers the live per-project numbers and the range summary on screen 13. Validates single-currency. Returns `alreadyReportedCount` / `alreadyReportedMinutes` / `alreadyReportedIn[]` so the UI can show what is being skipped and offer the opt-in (D-5) |
| `GET/POST` | `/api/staff/timesheets/reports` | `reports.view` / `reports.manage` | |
| `GET` | `/api/staff/timesheets/reports/[id]` | `reports.view` | |
| `POST` | `/api/staff/timesheets/reports/[id]/close` | `timesheets.lock` | Writes `staff_time_report_entries` snapshots, sets `locked_*` on entries, freezes totals, appends a `closed` report event — one `withAtomicFlush` transaction |
| `POST` | `/api/staff/timesheets/reports/[id]/unlock` | `reports.unlock` | Body requires `reason` (non-empty); clears `locked_*`, appends an `unlocked` event with the reason and actor |
| `GET` | `/api/staff/timesheets/reports/[id]/export?format=pdf\|csv\|xlsx` | `reports.view` | Honours current grouping, filters, rounding and currency; appends an `exported` event. **Export alone never locks** (screen 14 note 5). |

### Settings and aggregates

| Method | Route | Features |
|---|---|---|
| `GET/PUT` | `/api/staff/timesheets/settings` | `timesheets.view` / `settings.manage` |
| `POST` | `/api/staff/timesheets/settings/reapply-rounding` | `settings.manage` — enqueues a `ProgressJob`; **skips locked entries unconditionally** |
| `GET` | `/api/staff/timesheets/settings/rounding-impact` | `settings.manage` — the 90-day impact preview on screen 16 |
| `GET` | `/api/staff/timesheets/my-work` | `timesheets.view` — screen 1 aggregate: today/week/month/non-billable KPIs, today's entries, my projects with burn, recent tasks |

### Events (additive to `events.ts`)

```
staff.timesheets.time_task.created | updated | deleted
staff.timesheets.time_task.status_changed        (lifecycle, clientBroadcast: true)
staff.timesheets.time_task_comment.created | updated | deleted
staff.timesheets.project_access.requested        (lifecycle)
staff.timesheets.time_report.created | updated | deleted
staff.timesheets.time_report.closed | unlocked   (lifecycle)
staff.timesheets.time_project.budget_threshold_reached  (lifecycle)
```

### Notifications

| Trigger | Recipients | Screen |
|---|---|---|
| Project crosses `budget_warn_at_percent` or 100% | project owner + `projects.manage` holders | 3, 4 |
| Report closed | members of the included projects | 15 |
| Timer running > 8h | the timer's owner (gated by `warnings.runningTimer`) | 16 |
| **Access requested** (D-6) | `projects.manage` holders — the notification's action deep-links to the project team drawer with the requester pre-selected | 2, 17 |

---

## Access Control

### New ACL features (additive — no existing id is renamed; ids are FROZEN)

```
staff.timesheets.tasks.view
staff.timesheets.tasks.manage
staff.timesheets.reports.view
staff.timesheets.reports.manage
staff.timesheets.reports.unlock
staff.timesheets.settings.manage
staff.timesheets.rates.view
```

Two existing features are put to their intended use rather than duplicated: `staff.timesheets.lock` gates **close & lock**, and `staff.timesheets.projects.manage` is the marker of a Team Leader. `staff.timesheets.approve` stays declared and unused — §10 defers approvals.

### Role mapping

| §3 role | Features |
|---|---|
| **Team Member** | `timesheets.view`, `timesheets.manage_own`, `projects.view`, `tasks.view`, `tasks.manage`, `rates.view` |
| **Team Leader** | everything above plus `projects.manage`, `manage_all`, `reports.view`, `reports.manage`, `lock`, `reports.unlock`, `settings.manage` |

`setup.ts` `defaultRoleFeatures`: `admin` already holds `staff.*` (wildcard covers all new ids); `employee` gains the Team Member set. Existing tenants receive the grants via `yarn mercato auth sync-role-acls`.

**Who can unlock** (screen 15 note 4) is answered by `reports.unlock` being a distinct feature — it can be withheld from Team Leaders who should not restate billed time, without inventing an admin role §10 rejects.

---

## Implementation Phases

Each phase is one PR, independently shippable, with its integration tests in the same change (`.ai/qa/AGENTS.md`).

### Phase 1 — Foundations (no user-visible change)

1. Add the 10 entities and 11 columns to `data/entities.ts` (`staff_time_tasks` self-referencing via `parent_task_id`); author the migration and update `migrations/.snapshot-open-mercato.json`.
2. Add zod schemas to `data/validators.ts`; derive all types with `z.infer`.
3. Build `lib/time-tracking/`: `duration`, `interval`, `rounding`, `cost`, `rollup`, `overlap`, `settings`, `access` — pure functions, full unit coverage.
4. Register `timeTrackingAccessResolver` in `di.ts`.
5. Add the 7 ACL features and the `setup.ts` grants; run `yarn mercato auth sync-role-acls`.
6. Add the new event ids to `events.ts`; run `yarn generate`.
7. `GET/PUT /api/staff/timesheets/settings` backed by `ModuleConfigService`.

**Exit:** unit tests green for every helper; no page changes; `yarn typecheck && yarn test` clean.

### Phase 2 — Projects, team, navigation (screens 3, 4, 5, 17)

1. Create the `backend/staff/time-tracking/` page tree and the "Time tracking" nav group; 308-redirect the old `timesheets/*` routes; note both in `UPGRADE_NOTES.md`.
2. Extend the project form: customer (required, picking from `customer_entities` — companies and people — with inline create and a snapshot write), auto-derived editable code (D-10), rate, currency, billable-by-default, budget card (kind, value, warn-at), status, team chips. Currency becomes read-only once the project has entries, with the explicit change action and its non-conversion warning (D-3). Legacy projects with a null customer show an "Assign a customer" prompt on the list rather than erroring.
3. Extend the projects list: Rate / Hours / Cost / Budget-burn columns, card + table view toggle (already present), row action → team drawer, bulk **Assign members** and **Report from selected** (the latter blocked, with an explanation, when the selection spans customers — screen 3 note 4). **No grand-total row.**
4. Build the project team drawer: search, assigned vs rest of org, multi-select, TL row locked with a lock badge, confirm when removing someone with logged hours, "removing access keeps entries" notice.
5. Build the no-access state for every project-scoped route, plus the request-access action and its notification to `projects.manage` holders (D-6).
6. Wire `budget_threshold_reached` + its notification.

**Exit:** TC-TT-003/004/005/017 pass; a TM never sees Projects, Reports or Settings in the sidebar.

### Phase 3 — Tasks and Kanban (screens 6, 7)

1. CRUD + commands for statuses, tasks (parent and child), comments, tags, including the depth-1 guard and the parent→child soft-delete cascade.
2. `KanbanBoard.tsx` on `@dnd-kit`, modelled on the deals pipeline: per-column accent, count badge, summed hours in the header, inline quick-add, drop placeholder, optimistic move with rollback + retry toast, add-status column. Board queries filter `parent_task_id IS NULL`.
3. Task cards: title, tags, subtask progress, assignee avatar, **rolled-up** logged hours, running-timer marker, hover/focus quick actions (Start · Stop · Add time).
4. `TaskDrawer.tsx`: one-field quick log, logged-time breakdown (own vs children), subtask checklist where each row carries its own assignee and hours and can be timed or logged against, recent entries, comments (⌘↵ to post), properties saved on blur.
5. `rollup.ts` wired into every hours display — card, column header, drawer, project totals.
6. Board filters (assignee, tag, status) with persisted state.

**Exit:** TC-TT-006/007/020 pass; drag-drop conflict returns the card to its origin column and surfaces the conflict bar; a request to nest a subtask under a subtask is rejected.

### Phase 4 — The time entry model (screens 8, 9, 10)

1. `DurationInput.tsx` — parser-backed, keeps invalid text, lists accepted formats inline.
2. `TimeEntryDialog.tsx` — task picker (project and customer derived from it), description, date, 2-of-3 start/end/duration with a `computed` badge, billable switch, rate override with live read-only cost showing the rounding applied, tags, immutable creator notice, ⌘↵ save / Esc cancel, **Save and add another** (start chains from the previous end).
3. Overlap check on blur → non-blocking warning with **Show that entry** and **Snap start to …**. An end before its start renders the midnight-crossing hint rather than an error (D-8).
4. Entries DataTable: inline duration cell edit (Enter/blur saves, Esc reverts), duplicate, delete with an Undo toast, rate-override badge, locked rows read-only with a link to the closing report, footer totals, empty Cost cell for non-billable rows.
5. `copy-day` and `duplicate` endpoints; extend the existing entry routes and the bulk endpoint's lock rejection.

**Exit:** TC-TT-008/009/010 pass; a locked entry cannot be modified through the form, the inline cell, the bulk grid, or the duplicate endpoint.

### Phase 5 — Timesheet and My work (screens 1, 2, 11, 12)

1. Period selector (year / quarter / month / week) that preserves the current date context on switch (US-E1).
2. Project and person filters — a TM sees only themselves; a TL sees all assigned people. Both persisted per user (US-E2).
3. **Calendar view**: month grid, per-day total, load bar scaled to `targets.dailyHours`, entry chips with a dashed border for non-billable, hover `+ dodaj`, footer with period / billable / target / delta.
4. **List view**: per-day bars, expand the day that deviates from target, per-day entry table, quick-add row with task + duration + start.
5. **Grid view — the kept editable table**, upgraded: shared duration parser, project-or-task rows, locked cells read-only.
6. Three-way view switch, persisted; grid default for `week`, calendar default for `month`.
7. My work dashboard (screen 1) and the empty state (screen 2).

**Exit:** TC-TT-001/002/011/012/027 pass; the existing grid-save integration test (`TC-STAFF-027`) still passes unchanged.

### Phase 6 — Reports and billing (screens 13, 14, 15)

1. Report config: customer (single), period presets that fill an editable From/To pair (D-4), project pick-list with live per-project hours and cost, grouping, non-billable mode, show-rates toggle, range summary card, rounding notice, and the **already-reported panel** — count, minutes, the reports responsible, and an unticked "include anyway" opt-in (D-5). This deviates from screen 13, which drew already-reported entries as silently included; the mockup's own note 4 flagged the choice as open.
2. `ReportSheet.tsx` preview: per-project groups with rate and subtotal, task rows rolled up from child tasks (expandable), override badges, separate non-billable group at zero, grand total with the rounding rule spelled out.
3. Close & lock: snapshot writer, entry lock, frozen totals, `closed` event.
4. Unlock: modal requiring a reason, sent-to-client warning, report history timeline, destructive-outline styling.
5. Exports: PDF (mirrors the sheet), CSV/XLSX (adds raw date / person / description columns for accounting).

**Exit:** TC-TT-013/014/015/021 pass; closing a report freezes values such that a later rounding change does not move the total; an hour already frozen elsewhere cannot reach a second invoice without a deliberate tick.

### Phase 7 — Settings and polish (screen 16)

1. Settings page: rounding unit + direction with live worked examples, entry defaults, daily target, warning toggles, scope explanation card.
2. 90-day rounding impact preview.
3. Retroactive rounding as an **explicit action** (not a passive toggle) backed by a `ProgressJob` worker that never touches locked entries.
4. Keyboard-first pass across the entry loop (pick task → duration → save → next) with no mouse.
5. i18n completion for all 5 locales; `yarn i18n:check-hardcoded` and `yarn i18n:check-values` clean.
6. DS compliance sweep — semantic status tokens only; migrate the `bg-green-100 / text-green-800` status pill and the `border-amber-400 / bg-amber-50` dirty-cell styling already present in the grid page (Boy Scout Rule).

**Exit:** TC-TT-016 passes; `yarn lint`, `yarn test`, `yarn build:app` clean.

---

## Testing Coverage

### Unit

| Target | Cases |
|---|---|
| `duration.parseDuration` | `1h 40m`, `1.5h`, `90m`, `1:40`, `1.5`, `1,5`, empty, `1godz i troche` → error, negative, > 24h clamp |
| `interval.deriveInterval` | start+duration→end, start+end→duration, end+duration→start, all three consistent, all three inconsistent, **end < start → next-day crossing with the `crossesMidnight` flag set** |
| `rounding.roundMinutes` | each unit × each direction; `1:02→1:15`, `1:16→1:30`, `0:03→0:15`, `2:00→2:00`; `unit=0` is identity |
| `cost` | project rate, entry override, non-billable → `null`; **entry-level round-then-sum**: printed lines always add to the group total and the group totals to the grand total; the grand total is identical across all three groupings of the same data |
| `rollup.loggedMinutes` | parent with no children, parent with children, child in isolation, soft-deleted child excluded |
| `projectCode.derive` | diacritics (`Łódź → LODZ`), 20-char word-boundary cap, collision suffixing, name that slugifies to empty |
| `overlap.findOverlaps` | touching edges (not an overlap), containment, partial, excludeId, **a span crossing midnight against one on the following day** |
| `access.resolveProjectAccess` | manage-all, membership-only, no membership, inactive membership |
| Report totals | grouping variants, non-billable separate vs excluded, already-reported excluded vs opted in, frozen-vs-live divergence after a settings change |

### Integration (Playwright, `__integration__/`)

| Id | Screen | Path |
|---|---|---|
| TC-TT-001 | 1 | My work loads, quick entry saves, timer pill visible |
| TC-TT-002 | 2 | Unassigned member sees the empty state, not a blank table |
| TC-TT-003 | 3 | Projects list shows hours/cost/budget; no grand total |
| TC-TT-004 | 4 | Create project with customer, rate, currency, budget; code auto-derives and dedupes; a sole-trader customer works as well as a company |
| TC-TT-005 | 5 | Assign a member; access is immediate without re-login; a request-access notification reaches the TL |
| TC-TT-006 | 6 | Drag a card between columns; failure rolls back; child tasks never appear as board cards |
| TC-TT-007 | 7 | Subtask tick/untick, comment, one-field time log, time logged directly on a subtask |
| TC-TT-008 | 8 | 2-of-3 arithmetic; save and add another chains the start |
| TC-TT-009 | 9 | Bad duration blocks save and keeps the text; overlap warns but permits |
| TC-TT-010 | 10 | Inline edit, duplicate, delete + undo, locked row is read-only |
| TC-TT-011 | 11 | Month calendar totals and per-day add |
| TC-TT-012 | 12 | Week list bars and quick-add |
| TC-TT-013 | 13 | Report config live totals; mixed-currency selection is blocked; already-reported hours are listed and excluded |
| TC-TT-014 | 14 | Preview totals; export leaves entries unlocked |
| TC-TT-015 | 15 | Close locks; unlock demands a reason and records history |
| TC-TT-016 | 16 | Settings save; retro-rounding skips locked entries |
| TC-TT-017 | 17 | Non-member hitting a project URL gets the guard state, not a 403 dump |
| TC-TT-018 | — | **Lock gate**: a locked entry resists the form, the inline cell, the bulk grid save, and duplicate |
| TC-TT-019 | — | **Tenant isolation**: no route leaks tasks, entries or reports across tenants |
| TC-TT-020 | 6, 7 | **Rollup**: hours logged on a child appear in the parent's card, its column header and the project total; nesting a subtask under a subtask is rejected |
| TC-TT-021 | 13, 14 | **No silent double-billing**: an hour frozen in report A is absent from report B's total until the opt-in is ticked, then present with its frozen amount |
| TC-TT-022 | 8 | **Midnight crossing**: 23:00–01:00 saves as a 2:00 entry dated to the start day, with the hint shown |
| TC-STAFF-027 | — | existing grid save — must still pass unmodified |

---

## Risks & Impact Review

| # | Risk | Failure scenario | Severity | Mitigation | Residual |
|---|---|---|---|---|---|
| R1 | Rounding restates invoiced money | A TL switches rounding from none to 15-up; historic reports silently gain hours and a client disputes an invoice | **High** | `rounded_minutes` frozen per entry at write; reports snapshot the rule and the per-entry values at close; retro-rounding is an explicit job that skips locked entries; screen 16 shows a 90-day impact preview before saving | Draft (unclosed) reports still move when rounding changes — by design, and the screen says so |
| R2 | Cross-currency sum | Two projects of one customer are in PLN and EUR; the report adds them into one number and bills nonsense | **High** | Currency is per project and read-only once entries exist (D-3); report creation asserts a single currency and names the conflicting projects; no grand-total row anywhere outside a report | A customer with genuinely mixed-currency projects needs one report per currency |
| R2b | Same hour billed twice | A July report and a June–July report overlap; the overlap is invoiced on both | **High** | Already-reported entries are excluded by default; including them takes a deliberate tick against a visible count and a named source report (D-5); `staff_time_report_entries` makes "already reported" an indexed lookup, not a heuristic | A TL who ticks the box without reading still re-bills — by then it is an explicit act, not a silent default |
| R3 | Lock bypassed by a side door | The grid bulk save writes a locked entry because it targets entries by `(project, date)` rather than by id | **High** | Lock enforced in the command layer, not per route; `409 time_entry_locked`; TC-TT-018 exercises all four write paths | A future write path could forget — mitigated by the command-layer placement |
| R4 | Route move breaks bookmarks and integrations | A saved dashboard link or an external deep link 404s | Medium | 308 redirects on every old page route for ≥1 minor release; API routes are untouched; `UPGRADE_NOTES.md` entry | Deep links into removed sub-pages that have no new equivalent |
| R5 | Board performance | A project with 400 tasks makes drag-drop stutter | Medium | Gap-based integer `position`; per-column pagination beyond 100 cards; server-side column counts and hour sums | Very large boards remain heavier than small ones |
| R6 | Task reference collisions | Two users create a task simultaneously and both get `TT-142` | Medium | Per-project counter allocated inside the create transaction; unique index on `(org, tenant, project, sequence_number)`; retry on conflict | A gap in the sequence after a rollback — cosmetic |
| R7 | Scope pressure on `staff` | The module grows large enough to complicate the planned `@open-mercato/staff` extraction | Medium | Everything lands under `lib/time-tracking*`, `backend/staff/time-tracking/`, and the existing `staff.timesheets.*` namespaces; no new core→staff imports; `module-decoupling.test.ts` stays green | The module is simply bigger |
| R8 | Overlap query cost | A member with thousands of entries makes every keystroke on the entry form hit a slow query | Low | Index `(organization_id, staff_member_id, date, started_at)`; check runs on blur, not on keystroke; advisory-only so a timeout degrades to no warning | — |
| R9 | Notes → description reinterpretation | An external API consumer reading `notes` sees content it did not expect | Low | Column unchanged; both `notes` and `description` returned for ≥1 minor release; documented in `UPGRADE_NOTES.md` | — |
| R10 | Double-counted rollup | A surface sums parent *and* child hours that already include the child, inflating a client-facing total | Medium | `rollup.ts` is the single source of the number; `ownMinutes` and `loggedMinutes` are distinct response fields so a caller cannot confuse them; report task lines aggregate **entries**, never other lines; TC-TT-020 asserts the totals | A new surface could sum the wrong field — caught by the naming and the test |
| R11 | Currency relabelled without conversion | A TL uses the change action and past PLN amounts silently read as EUR | Medium | The action requires an explicit acknowledgement that states the count and the sum being relabelled, refuses while any entry is locked, and is recorded on the project trail; closed reports keep their own frozen currency | A project with genuinely wrong historic currency still needs manual correction |

---

## Migration & Backward Compatibility

Reviewed against [`BACKWARD_COMPATIBILITY.md`](../../BACKWARD_COMPATIBILITY.md)'s 13 contract surfaces:

| Surface | Impact |
|---|---|
| 1. Auto-discovery files | Additive only — new pages, routes, commands, widgets |
| 2. Public types | Additive fields on time-entry and project response shapes |
| 3. Signatures | None changed |
| 4. Import paths | None changed; all new code is module-internal |
| 5. Event ids | **Additive only.** No existing id renamed or removed |
| 6. Widget spot ids | Additive — new `data-table:` ids for the entries and tasks tables |
| 7. API routes | **Additive only.** Existing routes gain optional request fields and additive response fields |
| 8. DB schema | Additive — 10 new tables, 11 nullable/defaulted columns (incl. `staff_time_tasks.parent_task_id`, `staff_time_projects.customer_snapshot`). No column dropped or retyped; `customer_id` gains a declared target but no enforced FK, since it crosses a module boundary |
| 9. DI names | Additive — `timeTrackingAccessResolver` |
| 10. ACL features | **Additive only.** 7 new ids; no existing id renamed (they are FROZEN) |
| 11. Notification ids | Additive |
| 12. CLI commands | Unchanged |
| 13. Generated files | Regenerated via `yarn generate`; no contract change |

**Page routes are the one moving part.** `/backend/staff/timesheets*` → `/backend/staff/time-tracking*` with 308 redirects retained for at least one minor release, plus an `UPGRADE_NOTES.md` entry covering the move, the `notes`/`description` aliasing, and the new default role grants.

No deprecation protocol is triggered beyond that, because nothing is removed in this change.

---

## Resolved Decisions

Every question the requirements left open — each one traced to the mockup note that raised it — was decided on 2026-08-13. Nothing in this spec is pending an answer.

| # | Question (mockup note) | Decision |
|---|---|---|
| **D-1** | Kanban columns per project or global? (s6 n6) | **Per project**, seeded from a tenant default template. Team Leaders add, rename, reorder and recolour their own. An audit project and a migration project are allowed to look nothing alike. |
| **D-2** | Can a subtask carry time? (s7 n4) | **Yes — and the parent always displays the inclusive rollup** (own + all children). Because anything that holds a time entry is structurally a task, subtasks are modelled as child tasks (`parent_task_id`, one level deep) rather than a second table. Fixing "always sum" as the single rule is what removes the ambiguity the mockup worried about: there is no "including subtasks?" toggle anywhere, so no hours figure in the app is ever unclear about what it counts. |
| **D-3** | Currency after hours are logged? (s4 n2) | **Read-only once entries exist**, with an explicit change action that states it relabels without converting, names the count and sum affected, and refuses while any entry sits in a closed report. |
| **D-4** | Fixed periods or arbitrary ranges? (s13 n3) | **Presets fill an editable range.** Week/month/year set From and To; both stay adjustable. `period_kind` flips to `custom` once either date moves. Consulting invoices rarely align to a calendar month. |
| **D-5** | An hour already frozen in an earlier report? (s13 n4) | **Excluded by default**, with a visible count, the source reports named, and an unticked opt-in to include them at their frozen values. This overrides screen 13, which drew silent inclusion — re-billing the same hour must be a deliberate act, never a default. |
| **D-6** | "Ask your Team Leader for access" (s2 n2) | **A real in-app notification** to `projects.manage` holders, deduplicated to one pending request per user per project per 24h, with an action that opens the team drawer with the requester pre-selected. The button stops being decorative. |
| **D-7** | Round each line or round the total? (s14 n4) | **Round at the entry, then sum upward.** Every level above an entry is an exact sum of already-rounded values, which buys two properties: a client adding up the printed lines always reaches our total, and the grand total does not shift when the report is regrouped from task to person to day. Rounding at the *line* would have broken the second, since regrouping redraws the line boundaries. |
| **D-8** | Start later than end? (s9 n4) | **Read as crossing midnight**, with a non-blocking hint naming the end date. `date` records the day the work started. A genuine typo stays visible because the hint spells out what was inferred. |
| **D-9** | What does `customer_id` point at? (not raised by the mockups — found in code review: the column exists, has no FK, and nothing populates it) | **`customer_entities`**, the customers-module supertype, so a client may be a company *or* a sole trader without a second code path. Carried as FK-id **plus a `customer_snapshot`**, per the cross-module rule — the projects list and the report header resolve a customer name without joining another module, and survive it being absent. |
| **D-13** | Should a Team Member see the Projects page at all? (raised in build — `setup.ts` grants `employee` the `projects.view` feature, while mockup screen 1 draws the TM nav without a Projects entry) | **Keep the grant; scope the data.** A Team Member keeps the Projects nav entry and sees **only the projects they are assigned to** — the list route narrows through `resolveProjectAccess` (`canManageAll` → unrestricted, otherwise `access.projectIds`). Removing the grant would have hidden a page Team Members legitimately want; leaking every project was the actual bug, and that is fixed at the data layer rather than by hiding a menu item. |
| **D-11** | Sidebar: nested or flat? (raised in build, not by the mockups) | **Accept the platform's nesting.** `buildAdminNav` derives hierarchy from href prefix, and `/backend/staff/time-tracking` is a prefix of the other six routes, so the group renders "My work" with the rest indented beneath it and expands inside the module. The mockups draw seven flat siblings, but the existing `Employees` group already nests the same way, and flattening would mean a nav opt-out in shared `packages/ui` code used by every module. Platform consistency beats pixel fidelity here. |
| **D-12** | Do expired project assignments revoke access? (raised in build — `assigned_end_date` existed but the spec's access rule never mentioned it) | **Enforce the window, with a configurable grace period (default 14 days).** Access requires `assigned_start_date <= today <= assigned_end_date + grace`, with a null end date meaning open-ended. The grace period is what makes enforcement safe: without it, a consultant rolled off on the 31st loses access on the 1st with that week's time still unlogged. New tenant setting `access.assignmentGraceDays`, alongside rounding and targets. |
| **D-10** | Where does the project `code` come from? (screen 4 omits the field; the column is required and unique) | **Auto-derived from the name, editable behind an "edit" affordance.** Derivation: transliterate diacritics (`ł→L`, `ą→A`), uppercase, non-alphanumerics to `-`, **accumulate whole words while the result stays under 20 characters (word budget 19)**, then dedupe with a numeric suffix; 20 remains the hard cap that suffixing and single-word truncation also honour. `Nordvik — portal serwisowy` → `NORDVIK-PORTAL`; `Nordvik — migracja B2B` → `NORDVIK-MIGRACJA`. *The budget is 19 rather than 20 deliberately: an earlier draft of this row said "within 20 characters" while giving `NORDVIK-MIGRACJA` as the answer, but that slug is **exactly** 20 characters, so the rule as written would have kept `NORDVIK-MIGRACJA-B2B` and contradicted its own example. Stopping below 20 reproduces both examples and leaves room for a dedupe digit.* The cap matters because the code prefixes every task reference — an uncapped slug would turn the mockup's `TT-142` into `NORDVIK-PORTAL-SERWISOWY-142`. Uniqueness is checked live against the existing partial unique index. |

---

## Final Compliance Report

| Rule (root / package `AGENTS.md`) | How this spec complies |
|---|---|
| No cross-module ORM relations | `customer_id` is an FK id plus a jsonb snapshot on the report; no MikroORM relation to `customers` |
| Tenant/org scoping on every entity | All 8 new tables carry `tenant_id` + `organization_id` with a scoping index |
| `updated_at` on user-editable entities | Present on all new editable entities; assignment/snapshot/append-only tables documented as exempt |
| Optimistic locking on edit/delete forms | `CrudForm` auto-derive for forms; explicit headers for the board PATCH and drawer blur-saves; conflict surfaced via `surfaceRecordConflict` |
| Commands, not direct ORM writes | Every new write ships a command with side effects, undo, and `indexer` metadata |
| `withAtomicFlush` where a phase queries mid-write | Report close and unlock (multi-table, transactional) use it with `{ transaction: true }` and a `label` |
| Mutation guard registry on custom writes | Wired on `status`, `close`, `unlock`, `duplicate`, `copy-day`, `reapply-rounding` |
| `apiCall` / `useGuardedMutation`, never raw fetch | All new client code; the board's optimistic move uses `runMutation` with `retryLastMutation` in context |
| `indexer: { entityType }` on CRUD routes | `staff:staff_time_task`, `staff:staff_time_report` — matching the existing `staff:staff_time_entry` / `staff:staff_time_project` convention in `entities.ids.generated.ts` |
| ACL additive, ids FROZEN | 7 new ids; zero renames; `setup.ts` grants + `sync-role-acls` |
| i18n — no hardcoded user-facing strings | All copy through `useT()` / `resolveTranslations()`; internal throws prefixed `[internal]`; 5 locales in Phase 7 |
| DS — no raw status colors, no arbitrary values | Semantic `{property}-status-{status}-{role}` tokens; Boy Scout migration of the grid page's existing green pill and amber dirty-cell |
| `pageSize` ≤ 100 | Board columns paginate at 100; all lists default to 50 |
| Dialogs: ⌘↵ submit, Esc cancel | Entry dialog, unlock dialog, quick-add rows |
| Progress module for long work | Retro-rounding runs as a `ProgressJob` + queue worker |
| Integration tests ship with the feature | 19 test cases mapped to phases; `.ai/qa/AGENTS.md` self-contained fixture rules apply |
| Spec content checklist | TLDR, Overview, Problem Statement, Proposed Solution, Architecture, Data Models, API Contracts, Risks, Compliance, Changelog — all present |
| Open Questions gate (`om-spec-writing`) | Closed — all 8 decided and recorded in [Resolved Decisions](#resolved-decisions); none deferred into implementation |

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-16 | Demo data added (`seedStaffTimeTrackingExamples`, `mercato staff seed-time-tracking-examples`, wired into `setup.ts seedExamples`), so a fresh tenant lands on a populated portfolio, board, week grid and report list instead of four empty screens. Projects link to real `customer_entities` when the CRM examples are present and degrade to a snapshot name when they are not. Fixed three raw-SQL sites that bound an id array to a single `= ANY(?)` placeholder — MikroORM interpolates rather than binds, so the projects list 500'd for every tenant that had a project, the rounding-impact preview 500'd for org-narrowed callers, and the retro-rounding job selected no candidates while reporting success. Shared helper: `lib/time-tracking/sqlInClause.ts`. |
| 2026-08-13 | Pre-implementation code review against the live module closed two gaps the spec had assumed away: `staff_time_projects.customer_id` is dormant (no FK, never populated by any UI) and now targets `customers.customer_entities` with a `customer_snapshot` alongside (D-9); the required-and-unique `code` column, absent from screen 4, is now auto-derived from the name with a 20-character cap so task references stay short (D-10). Corrected `indexer.entityType` to the generated `staff:staff_time_task` convention and `currency_code` to `text` per the `sales` precedent. |
| 2026-08-13 | All 8 open questions resolved (D-1…D-8) and propagated. Structural change: subtasks now carry time, so `staff_time_subtasks` is dropped in favour of a self-referencing `staff_time_tasks.parent_task_id` (one level), with an inclusive-rollup rule (`rollup.ts`) feeding every hours display. Money is rounded at the entry then summed upward, so `frozen_amount` narrows to `numeric(14,2)`. Reports gain `include_already_reported` (default `false`) so a previously billed hour cannot reach a second invoice silently. Added the currency-change and access-request endpoints, the `project_access.requested` event and notification, midnight-crossing handling in `interval`/`overlap`, and test cases TC-TT-020/021/022. |
| 2026-08-12 | Initial specification. Derived from [`2026-08-12-time-tracking-module-requirements.md`](./2026-08-12-time-tracking-module-requirements.md) (§1–§11) and the 17-screen prototype in `.ai/mockups/time-tracking/`. Decisions taken up front: pages move to a "Time tracking" nav group at `/backend/staff/time-tracking/*` while tables, ACL ids and API routes stay in the `staff.timesheets.*` namespace; §9 proposals (budgets, daily targets, retroactive rounding) are first-class scope; the existing editable project × day hours grid is kept as the third timesheet view. |
