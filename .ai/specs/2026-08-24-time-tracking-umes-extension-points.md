# Time Tracking — UMES Extension Points Implementation Plan

> Audit + implementation plan for making the time-tracking surface of the `staff`
> module (`packages/core/src/modules/staff`, `/backend/staff/time-tracking/*`,
> `/api/staff/timesheets/*`) extensible through the Unified Module Extension
> System. Companion to
> [`2026-08-12-time-tracking-consulting-suite.md`](./2026-08-12-time-tracking-consulting-suite.md).

---

## TLDR

**Audit result.** Time tracking is one of the largest feature surfaces in the platform
— 20 entities, 8 `makeCrudRoute` resources, ~30 hand-rolled API routes, 30+ registered
commands and 30+ UI screens — but it is the *least* extensible large module in the repo.
It exposes **19 working extension surfaces** (commands, DI access resolver, CRUD
interceptor/enricher/guard plumbing on the factory routes, ACL features, dashboard
widgets, notifications, analytics, one sidebar injection). It is missing **51 extension
points**, and it is the only large core module with **no `extension-points.ts`
declaration at all**, so none of its hosts appear in the generated extension-point
catalog or in UMES DevTools.

**51 extension points to add, across 9 mechanism types:**

| # | Mechanism type | EPs | What it unlocks |
|---|---|---|---|
| 1 | Extension-point catalog declaration | 1 | Every host below becomes discoverable in DevTools, module-facts and the generated catalog |
| 2 | Events (CRUD lifecycle, custom-route lifecycle, `clientBroadcast`, `portalBroadcast`, sync subscribers, webhooks) | 8 | React to, veto and mirror every time-tracking write; real-time UI; outbound webhooks |
| 3 | Mutation guards + API interceptors on custom routes | 4 | Policy enforcement and request/response rewriting on the ~15 hand-rolled mutation routes that today bypass both |
| 4 | Response + query-engine enrichers | 3 | Third-party columns/fields on entries, tasks and reports, visible to dashboards, exports and AI |
| 5 | UI injection: DataTable hosts, detail/page spots, CrudForm hosts, component replacement | 15 | Custom columns, row/bulk actions, filters, tabs, badges, panels and full component swaps across every time-tracking screen |
| 6 | Domain strategy registries (rounding, rates, billability, export formats, groupings, entry sources, overlap policy, project codes, capacity targets, approval policy) | 10 | Replace the closed business rules that every consulting/agency/payroll customer needs to change |
| 7 | Data-model extensibility (custom fields, cross-module links, translations, settings schema) | 4 | Custom fields on time entries/projects/tasks/reports, declared cross-module links, contributed settings keys |
| 8 | Search, analytics and notifications contributions | 4 | Full-text tasks/entries/reports, analytics on tasks/projects, reactive alerts |
| 9 | AI tools/agents, portal surface, workers/CLI | 3 | "Log my week", client-facing report portal, custom recalculation jobs |

**Highest-value fixes, and one live defect.**
(a) **No time-tracking `makeCrudRoute` declares an `events:` config**, so the factory's
`runSyncBeforeEvent` / `runSyncAfterEvent` never dispatch — sync lifecycle subscribers
are impossible on every time-tracking resource (G-4). The CRUD event *ids* themselves do
fire today, emitted by the commands through `emitCrudSideEffects` with the
`staff*CrudEvents` configs in `lib/crud.ts`; a small set of custom-route transitions had
no id at all (G-2, corrected below).
(b) `runStaffMutationGuards` bridges only the legacy container guard and never calls
`getAllMutationGuardInstances()`, so module-registered `data/guards.ts` guards **never
run** on any of the 15 custom time-tracking mutation routes (G-5).
(c) The custom mutation routes run **no API interceptors at all**, before or after (G-6).
EP-02, EP-03, EP-10 and EP-12 fix these.

**What this gives a framework user.** After this plan, a third-party module can:
add a "Jira issue" column and a "Push to Jira" row action to the time-entries table
without forking it; enforce "no entry longer than 10h" and "no billable entry without a
purchase order" as a guard that holds on *every* write path including bulk and timers;
plug in a seniority-based rate resolver and a client-specific rounding rule; register a
new `invoice-xml` report export format and a `project_month` grouping; add custom fields
to time entries and see them in reports, search, analytics and the AI agent; broadcast
a live "team timer wall"; publish approved reports to the customer portal; and swap the
whole `TimeEntryDialog` for its own — all without touching a line of core code.

---

## Part 1 — Audit: what exists today

### 1.1 Working extension surfaces (19)

| # | Surface | Where | Notes |
|---|---|---|---|
| E-1 | Command registry | `commands/timesheets-{entries,projects,tasks,task-statuses,task-comments,tags,reports}.ts` | 30+ commands registered via `registerCommand`. Command interceptors (`commands/interceptors.ts`) therefore work today for anything routed through a command. |
| E-2 | `makeCrudRoute` resources | `api/timesheets/{time-entries,time-projects,tasks,task-statuses,tags,reports,tasks/[id]/comments,time-projects/[id]/employees}/route.ts` | 8 factory routes ⇒ API interceptors, response enrichers, registry mutation guards and optimistic locking apply automatically **on these routes only**. |
| E-3 | API interceptors | `api/interceptors.ts` | 2 declared: self-scoping for `staff/timesheets/time-entries` GET and for `dashboards/widgets/data`. |
| E-4 | Response enrichers | `data/enrichers.ts` | `_staff` enrichment for projects (hours trend, financials, members, customer) and task rollups. |
| E-5 | DI-overridable access resolver | `di.ts` → `timeTrackingAccessResolver` | Documented BC surface; the single project-access authority for all TT routes. |
| E-6 | DI-overridable availability resolver | `di.ts` → `availabilityAccessResolver` | Consumed by `planner` with `allowUnregistered: true`. |
| E-7 | ACL features | `acl.ts` | 15 `staff.timesheets.*` features, wildcard-aware, FROZEN ids. |
| E-8 | Declared events | `events.ts` | 40 ids for time tracking — **only 6 emitted**, see G-2. |
| E-9 | Async/persistent subscribers | `subscribers/time-project-{budget-threshold,access-requested}-notification.ts` | Persistent subscriptions with claim logic. |
| E-10 | Notification types + renderers | `notifications.ts`, `notifications.client.ts`, `widgets/notifications/` | 2 TT types with actions. |
| E-11 | Dashboard widgets | `widgets/dashboard/timesheets-{hours-by-project,time-reporting}/` | Registered in the dashboard widget host. |
| E-12 | Widget injection contribution | `widgets/injection-table.ts` | 1 entry: timer indicator into `backend:sidebar:nav:footer`. |
| E-13 | Analytics entity | `analytics.ts` | `staff:staff_time_entries` with field mappings + label resolvers. |
| E-14 | Search config | `search.ts` | Indexes `staff:staff_time_project` (only). |
| E-15 | Module settings | `lib/time-tracking/settings.ts` + `api/timesheets/settings/route.ts` | 8 keys under module id `staff.time_tracking`, via `ModuleConfigService`. |
| E-16 | Query-index integration | `indexer: { entityType: 'staff:staff_time_*' }` on the factory routes | Entities are query-indexed. |
| E-17 | Optimistic locking | All TT entities carry `updated_at`; routes return `updatedAt` | Default-ON contract honoured. |
| E-18 | Message objects/types | `message-objects.ts`, `message-types.ts` | Staff domain objects attachable to messages. |
| E-19 | Worker | `workers/timesheets-reapply-rounding.ts` | Queue worker contract. |

### 1.2 Confirmed gaps (evidence)

| Gap | Evidence |
|---|---|
| G-1 No extension-point catalog | `packages/core/src/modules/staff/extension-points.ts` does not exist. 20 other modules have one (`customers`, `wms`, `sales`, `warranty_claims`, `messages`, `portal`, …). |
| G-2 Some transitions have no event id ~~34/40 declared events never emitted~~ | **Corrected during P1.** The original audit grepped only for `emitStaffEvent(` and missed `emitCrudSideEffects({ events: staffTimeEntryCrudEvents, … })` in `commands/timesheets-*.ts` (`lib/crud.ts:57-64`), which emits the `staff.timesheets.*.{created,updated,deleted}` family. Those ids **do** fire. What was genuinely missing: no id existed for `time_entry.{bulk_updated,copied,locked,unlocked}`, `time_entry_segment.*`, `time_report.exported`, `time_project.currency_changed`, `time_project_access.*`, `time_tracking.{settings_updated,rounding_reapplied}` — and `time_tag` / `time_task_status` still have no declared CRUD ids. EP-04 closes the first set. |
| G-3 ~~Budget subscriber under-fires~~ | **Retracted during P1.** The subscriber's `staff.timesheets.time_entry.*` subscription is matched by the command-emitted CRUD ids, so manual creates, edits, deletes and `/bulk` writes did reach it. The doc comment was accurate; only the claim in this audit was not. |
| G-4 No sync lifecycle subscribers possible | `deriveLifecycleEventIds` (`factory.ts:637`) returns nulls without `opts.events`, so `runSyncBeforeEvent` / `runSyncAfterEvent` never dispatch for TT. |
| G-5 Registry mutation guards skipped on custom routes | `api/guards.ts:runStaffMutationGuards` calls `runMutationGuards([legacyGuard], …)` — it never calls `getAllMutationGuardInstances()` the way `factory.ts:679` does. 15 custom mutation routes are affected. |
| G-6 Custom routes run no API interceptors | `runApiInterceptorsBefore` / `runCustomRouteAfterInterceptors` are used by `wms` and `auth`, never by `staff`. |
| G-7 No DataTable extension hosts | `grep -rn "tableId"` over the whole staff module returns **zero** hits; none of the 3 TT DataTables (`entries/page.tsx:1083`, `projects/page.tsx:1151`, `reports/page.tsx:201`) pass `extensionTableId`, `injectionSpotId` or `perspective`. |
| G-8 No injection spots in TT UI | `grep -rn "InjectionSpot\|useInjection\|spotId"` over `backend/`, `lib/`, `components/` returns **zero** hits. Project detail (`projects/[id]/page.tsx`, 1350 lines) builds its tabs with raw `<Tabs>`. |
| G-9 No component replacement handles | No `widgets/components.ts`; no TT component calls `registerComponent`. |
| G-10 Only one CrudForm host, undeclared | Project create/edit pass `entityIds={[E.staff.staff_time_project]}`, so `crud-form:staff:staff_time_project:*` spots exist implicitly — but are not declared anywhere. `TimeEntryDialog`, `NewTaskDialog`, `TaskDrawer` and report creation are hand-rolled and expose nothing. |
| G-11 Closed business rules | `lib/time-tracking/rounding.ts` (union `0\|5\|10\|15` × `up\|nearest`), `lib/time-tracking/cost.ts:applicableRate` (override → project rate, nothing else), `lib/timesheets-reports/reportExport.ts:21` (`'pdf'\|'csv'\|'xlsx'`), `lib/timesheets-reports/reportTotals.ts:34` (`'project_task'\|'project_person'\|'project_day'`), `data/entities.ts` `@Enum({ items: ['manual','timer','kiosk','mobile'] })`, `lib/time-tracking/overlap.ts`, `lib/time-tracking/projectCode.ts`, `lib/time-tracking-ui/timesheetTargets.ts`. All pure functions or DB enums with no registry, provider or DI seam. |
| G-12 TT entities absent from `ce.ts` | `ce.ts` declares only `staff_team_member` ⇒ no custom fields on time entries, projects, tasks, reports or tags. |
| G-13 No `data/extensions.ts` | `customer_id`, `deal_id`, `order_id` on `StaffTimeEntry` are raw FK ids with no declared link. |
| G-14 Search covers 1 of 5 TT entities | `search.ts:195` indexes only `staff:staff_time_project`. |
| G-15 Enrichers not query-engine enabled | `data/enrichers.ts` has no `queryEngine: { enabled: true }`; enrichment is invisible to dashboards, exports and AI. |
| G-16 No AI surface | No `ai-tools.ts` / `ai-agents.ts` in `staff` (`catalog`, `customers`, `eudr`, `warranty_claims` have them). |
| G-17 No reactive notification handlers | No `notifications.handlers.ts`. |
| G-18 Settings schema is closed | `TIME_TRACKING_SETTING_KEYS` is a frozen array; the settings route validates against a closed zod schema; the settings page renders a fixed form. |
| G-19 No portal surface | No portal page, no portal injection host, no `portalBroadcast: true` on any TT event. |
| G-20 Events not webhook-exposed | No webhook registration for `staff.timesheets.*` (blocked by G-2 anyway). |

---

## Part 2 — Implementation plan (51 extension points)

Legend for **Type**: `catalog` · `event` · `guard` · `interceptor` · `enricher` ·
`data-table` · `crud-form` · `injection` · `component` · `registry` · `entity` ·
`search` · `analytics` · `notification` · `ai` · `portal` · `worker`.

### Group 1 — Extension-point catalog (1)

#### EP-01 · `catalog` · Declare every time-tracking host
- **Add**: `packages/core/src/modules/staff/extension-points.ts`
- **Shape**: `defineModuleExtensionPoints({ moduleId: 'staff', hosts: { … } })` using
  `dataTableExtensionHost`, `crudFormExtensionHost`, `injectionExtensionHost`,
  `componentExtensionHost` from `@open-mercato/shared/modules/widgets/extension-points`.
- **Contents**: every host id introduced by EP-16…EP-30 below, plus the already-implicit
  `crudFormExtensionHost({ entityId: 'staff:staff_time_project' })`.
- **Also update**: `packages/core/src/modules/staff/AGENTS.md` → new "Host extension points"
  section (BACKWARD_COMPATIBILITY.md:276 requires the heading to stay stable);
  run `yarn generate` so module-facts pick the hosts up.
- **Unlocks**: DevTools listing, module-facts provenance, generated catalog, agent discovery.

### Group 2 — Events (8)

#### EP-02 · `event` · Add `events:` config to all 8 TT `makeCrudRoute` resources
- **Edit**: `api/timesheets/time-entries/route.ts:532`, `time-projects/route.ts`,
  `tasks/route.ts`, `task-statuses/route.ts`, `tags/route.ts`, `reports/route.ts`,
  `tasks/[id]/comments/route.ts`, `time-projects/[id]/employees/route.ts`
- **Change**: add `events: { module: 'staff', entity: 'timesheets.time_entry' }`
  (etc.) so `deriveLifecycleEventIds` resolves and the 34 dormant ids in `events.ts`
  actually emit.
- **Note**: the entity string must reproduce the existing declared ids exactly
  (`staff.timesheets.time_entry.created`) — the ids in `events.ts` are a FROZEN
  contract surface; this EP makes them true, it must not rename them.
- **Fixes**: G-4. **Unlocks**: sync lifecycle subscribers (EP-07), and aligns the factory
  routes with the command-side event configs already in `lib/crud.ts`.
- **Known side effect (raised in P1, accepted by the module owner on 2026-08-24 —
  keep the new tags, no compat alias)**: `resolveResourceAliasesList` (`factory.ts:525-535`)
  prefers the `events`-derived resource tag over the command-derived one, so the 7 factory
  routes move off the shared `staff.timesheet` tag onto distinct per-entity tags. This
  changes CRUD list-cache tags (re-pinned in `lib/timesheets/timeEntryCacheInvalidation.ts`),
  `command_logs.resource_kind` values going forward, and the optimistic-lock reader key —
  which previously *collided* across all 7 routes on a first-wins basis and is now correct
  per route. A third-party mutation guard filtering a factory route on the literal
  `staff.timesheet` must be updated; documented in the staff `AGENTS.md` taxonomy section.

#### EP-03 · `event` · Emit lifecycle events from the custom mutation routes
- **Edit**: `time-entries/bulk/route.ts`, `time-entries/copy-day/route.ts`,
  `time-entries/[id]/duplicate/route.ts`, `time-entries/[id]/segments/route.ts`,
  `time-entries/[id]/segments/[segmentId]/route.ts`,
  `tags/entry-assignments/route.ts`, `tags/task-assignments/route.ts`,
  `time-projects/[id]/change-currency/route.ts`,
  `time-projects/[id]/employees/route.ts`, `settings/route.ts`,
  `settings/reapply-rounding/route.ts`, `reports/[id]/export/route.ts`,
  `access-requests/route.ts`
- **Change**: emit the matching `staff.timesheets.*` event after each successful write,
  with the `{ id, tenantId, organizationId }` payload shape the existing subscribers expect.

#### EP-04 · `event` · New event ids for currently un-modelled transitions
- **Edit**: `events.ts`
- **Add**: `time_entry.bulk_updated`, `time_entry.copied`, `time_entry.locked`,
  `time_entry.unlocked`, `time_entry_segment.{created,updated,deleted}`,
  `time_report.exported`, `time_project.currency_changed`,
  `time_project_access.{granted,denied}`, `time_tracking.settings_updated`,
  `time_tracking.rounding_reapplied`.

#### EP-05 · `event` · `clientBroadcast: true` for real-time surfaces
- **Edit**: `events.ts`
- **Set on**: `time_entry.timer_started`, `time_entry.timer_stopped`,
  `time_entry.{created,updated,deleted}`, `time_report.{closed,unlocked}`,
  `time_project.budget_threshold_reached`
- **Unlocks**: `useAppEvent` / `useOperationProgress` consumers — live team timer walls,
  auto-refreshing timesheets, third-party toasts.

#### EP-06 · `event` · `portalBroadcast: true` for the client-facing subset
- **Edit**: `events.ts` — `time_report.closed`, `time_report.exported`
- **Pairs with**: EP-50.

#### EP-07 · `event` · Sync lifecycle subscriber host for the write pipeline
- **Depends on**: EP-02 (sync dispatch needs `events:`)
- **Add**: `subscribers/README` entry + declared host in EP-01 documenting the
  `metadata: { sync: true, priority }` contract for
  `staff.timesheets.time_entry.creating|created|updating|updated|deleting|deleted`
- **Unlocks**: in-pipeline veto and payload modification (e.g. "block billable time on
  a closed client", "stamp a cost centre from an HR system").

#### EP-08 · `event` · Document and pin the budget-threshold subscriber's contract
- **Edit**: `subscribers/time-project-budget-threshold-notification.ts`
- **Change**: keep the `staff.timesheets.time_entry.*` subscription, rewrite the doc
  comment to name the real emission sites (the commands' `emitCrudSideEffects`, `/bulk`'s
  own emit, the explicit timer emits) and to explain why the new batch-level ids carry no
  `id`, and add a regression test asserting a manual create and a `/bulk` write both
  reach it. Not a bug fix — G-3 was retracted; this pins behaviour that already held.

#### EP-09 · `event` · Expose TT events to webhooks
- **Add**: webhook event registration for the `staff.timesheets.*` family
  (see `packages/webhooks/AGENTS.md`), with payload schemas.
- **Unlocks**: outbound Standard-Webhooks delivery to external billing/PM systems.

### Group 3 — Guards and interceptors on custom routes (4)

#### EP-10 · `guard` · Run registry mutation guards on every custom TT route
- **Edit**: `api/guards.ts:runStaffMutationGuards`
- **Change**: `const allGuards = [...getAllMutationGuardInstances(), ...(legacyGuard ? [legacyGuard] : [])]`
  (mirror `factory.ts:678-682`), then `runMutationGuards(allGuards, …)`.
- **Fixes**: G-5 — makes third-party `data/guards.ts` guards effective on timer-start,
  timer-stop, bulk, copy-day, duplicate, segments, task status, tag assignments,
  report close/unlock, change-currency, access-requests, reapply-rounding.

#### EP-11 · `guard` · Publish the guard `resourceKind` taxonomy
- **Edit**: `api/guards.ts` + `AGENTS.md`
- **Add**: a single exported `STAFF_TIME_TRACKING_RESOURCE_KINDS` map so a guard author
  knows the exact `resourceKind` string per route (`staff:time_entry`,
  `staff:time_project`, `staff:time_task`, `staff:time_report`, …), and assert it in tests.

#### EP-12 · `interceptor` · Run `before` interceptors on custom TT routes
- **Add**: `api/timesheets/_shared/withTimesheetInterceptors.ts` wrapping
  `runApiInterceptorsBefore` (`@open-mercato/shared/lib/crud/interceptor-runner`),
  modelled on `packages/core/src/modules/wms/api/inventory/helpers.ts`.
- **Wire into**: the ~15 custom mutation routes and the read aggregates
  (`my-work`, `my-projects`, `projects/kpis`, `reports/preview`, `reports/[id]/sheet`,
  `time-entries/overlaps`).
- **Unlocks**: body/query rewriting, extra scoping and short-circuit denials on routes
  that today accept no interception at all.

#### EP-13 · `interceptor` · Run `after` interceptors on custom TT routes
- **Use**: `runCustomRouteAfterInterceptors` from
  `@open-mercato/shared/lib/crud/custom-route-interceptor`
- **Wire into**: the same routes as EP-12, plus `reports/[id]/export`.
- **Unlocks**: response shaping for aggregates and exports.

### Group 4 — Enrichers (3)

#### EP-14 · `enricher` · Time-entry response enricher host
- **Edit**: `data/enrichers.ts`, `api/timesheets/time-entries/route.ts:555`
- **Change**: move the `hooks.afterList: decorateTimeEntryList` logic behind a declared
  enricher for `staff:staff_time_entry`, so third-party enrichers compose with it
  instead of being invisible behind a route-private hook.

#### EP-15 · `enricher` · Task and report enricher hosts
- **Edit**: `data/enrichers.ts`
- **Add**: enrichers for `staff:staff_time_task` (beyond the current rollups) and
  `staff:staff_time_report` (totals, freeze state, export history).

#### EP-16 · `enricher` · Enable query-engine enrichment
- **Edit**: `data/enrichers.ts`
- **Change**: add `queryEngine: { enabled: true }` to the project/task/entry/report
  enrichers so enriched fields reach dashboards, exports, the query engine and AI tools.
- **Read first**: `apps/docs/docs/framework/extensibility/query-engine-extensibility.mdx`.

### Group 5 — UI extension (15)

#### EP-17 · `data-table` · Time entries table host
- **Edit**: `backend/staff/time-tracking/entries/page.tsx:1083`
- **Change**: `extensionTableId="staff.time_entries.list"`
- **Unlocks**: `data-table:staff.time_entries.list:{columns,row-actions,bulk-actions,filters,toolbar,search-trailing,header,footer,empty-state}`

#### EP-18 · `data-table` · Time projects table host
- **Edit**: `backend/staff/time-tracking/projects/page.tsx:1151`
- **Change**: `extensionTableId="staff.time_projects.list"`

#### EP-19 · `data-table` · Reports table host
- **Edit**: `backend/staff/time-tracking/reports/page.tsx:201`
- **Change**: `extensionTableId="staff.time_reports.list"`

#### EP-20 · `injection` · Project detail spots
- **Edit**: `backend/staff/time-tracking/projects/[id]/page.tsx`
- **Add**: `DetailInjectionSpots.{header,statusBadges,tabs,sidebar,footer}('staff:staff_time_project')`
  around the existing `<Tabs>`/`<PageBody>` structure.
- **Unlocks**: third-party project tabs (invoices, contracts, SLA), header badges, side panels.

#### EP-21 · `injection` · Task drawer / task detail spots
- **Edit**: `lib/time-tracking-ui/TaskDrawer.tsx`, `lib/time-tracking-ui/TaskBoardScreen.tsx`
- **Add**: `detail:staff:staff_time_task:{header,status-badges,tabs,sidebar,footer}`

#### EP-22 · `injection` · Report detail and report sheet spots
- **Edit**: `backend/staff/time-tracking/reports/[id]/page.tsx`, `lib/time-tracking-ui/ReportSheet.tsx`
- **Add**: `detail:staff:staff_time_report:{header,status-badges,footer}` and
  `staff.time_report.sheet:{before-lines,after-totals}`

#### EP-23 · `injection` · Timesheet page spots
- **Edit**: `backend/staff/time-tracking/timesheet/page.tsx`, `lib/time-tracking-ui/TimesheetPeriodFooter.tsx`
- **Add**: `staff.timesheet:{toolbar,period-footer,day-cell-actions}`
- **Unlocks**: "submit for approval" buttons, capacity meters, payroll badges.

#### EP-24 · `injection` · Kanban board spots
- **Edit**: `lib/time-tracking-ui/{KanbanBoard,KanbanColumn,KanbanCard}.tsx`
- **Add**: `staff.time_task.board:{toolbar,column-header,card-badges,card-footer}`

#### EP-25 · `injection` · My-work page spots
- **Edit**: `backend/staff/time-tracking/page.tsx`, `api/timesheets/my-work/myWorkAggregate.ts`
- **Add**: `staff.my_work:{before-sections,after-sections}` plus a server-side section
  contribution contract so a module can add its own "my work" section.

#### EP-26 · `injection` · Settings page section spot
- **Edit**: `backend/staff/time-tracking/settings/page.tsx`
- **Add**: `staff.time_tracking.settings:sections` — pairs with EP-42.

#### EP-27 · `injection` · Timer bar spot
- **Edit**: `lib/timesheets-ui/TimerBar.tsx`
- **Add**: `staff.timesheets.timer-bar:actions`
- **Unlocks**: "start from Jira issue", "attach location", kiosk controls.

#### EP-28 · `crud-form` · Declare and extend the project form host
- **Edit**: `backend/staff/time-tracking/projects/{create,[id]/edit}/page.tsx`,
  `backend/staff/time-tracking/projects/projectFormConfig.ts`
- **Change**: declare the already-implicit `crud-form:staff:staff_time_project` host in
  EP-01, and add named `groupId`s so `CrudFormInjectionSpots.group(...)` targets are stable.

#### EP-29 · `crud-form` · Expose a form host for the time-entry dialog
- **Edit**: `lib/time-tracking-ui/TimeEntryDialog.tsx`, `lib/time-tracking-ui/EntryDetailsFields.tsx`
- **Change**: render `InjectionSpot`s for `crud-form:staff:staff_time_entry:{before-fields,fields,after-fields,footer}`
  and run the `onFieldChange` / `onBeforeSave` / `onAfterSave` lifecycle handlers, so the
  hand-rolled dialog behaves like a `CrudForm` host without being rewritten.

#### EP-30 · `crud-form` · Form hosts for task and report creation
- **Edit**: `lib/time-tracking-ui/NewTaskDialog.tsx`,
  `backend/staff/time-tracking/reports/create/page.tsx`
- **Add**: `crud-form:staff:staff_time_task:*` and `crud-form:staff:staff_time_report:*`

#### EP-31 · `component` · Register replaceable time-tracking components
- **Add**: `packages/core/src/modules/staff/widgets/components.ts` exporting
  `componentOverrides`, and `registerComponent` calls for:
  `staff.time_entry_dialog`, `staff.timer_bar`, `staff.kanban_card`,
  `staff.kanban_column`, `staff.timesheet_grid` (`GridView`),
  `staff.timesheet_list` (`ListView`), `staff.timesheet_calendar`,
  `staff.report_sheet`, `staff.project_card`, `staff.entries_summary_footer`
- **Unlocks**: `replace` / `wrapper` / `props` overrides per
  `apps/docs/docs/framework/widget-injection.md`.

### Group 6 — Domain strategy registries (10)

Each of these replaces a closed pure function or DB enum with a
`specialized-registry` style contract registered at module load and resolved through DI,
with the current behaviour registered as the built-in default (no behaviour change).

#### EP-32 · `registry` · Rounding strategy registry
- **Edit**: `lib/time-tracking/rounding.ts`; call sites
  `commands/timesheets-entries.ts:386`, `lib/time-tracking/roundingImpact.ts:66`,
  `lib/time-tracking-ui/TimeEntryDialog.tsx:764`, `lib/time-tracking-ui/timeTrackingSettingsForm.ts:38`
- **Add**: `registerTimeRoundingStrategy({ id, label, round(rawMinutes, ctx) })` +
  `timeRoundingResolver` DI key; keep `up`/`nearest` × `0|5|10|15` as built-ins.
- **Unlocks**: per-client billing increments, "round down", "minimum 15m per entry",
  "first 15m free" rules.

#### EP-33 · `registry` · Rate resolver chain
- **Edit**: `lib/time-tracking/cost.ts:applicableRate`; call sites
  `api/timesheets/time-entries/route.ts:521`,
  `lib/timesheets-projects/computeProjectFinancials.ts:81`,
  `lib/timesheets-reports/reportTotals.ts:193`, `lib/time-tracking-ui/TimeEntryDialog.tsx:765`
- **Add**: `registerTimeRateResolver({ id, priority, resolve(ctx): number | null })`
  where `ctx` carries entry, task, project, staff member, role, customer and date.
- **Unlocks**: seniority/role rates, task-type rates, date-effective rate cards,
  customer contract rates, currency-converted rates. **The single most requested
  customisation in any consulting time tracker.**

#### EP-34 · `registry` · Billability resolver
- **Edit**: `commands/timesheets-entries.ts` (project default → tenant default chain)
- **Add**: `registerBillabilityResolver({ id, priority, resolve(ctx): boolean | null })`
- **Unlocks**: "internal projects are never billable", "travel is billable at 50%",
  activity-type-driven billability.

#### EP-35 · `registry` · Report export format registry
- **Edit**: `lib/timesheets-reports/reportExport.ts:21,272`,
  `api/timesheets/reports/[id]/export/route.ts:121,164`
- **Add**: `registerReportExportFormat({ id, label, mimeType, extension, serialize(input) })`;
  register `pdf`, `csv`, `xlsx` as built-ins and drive `normalizeReportExportFormat`
  and the OpenAPI enum off the registry.
- **Unlocks**: `invoice-xml`, `datev`, `json`, customer-branded PDF.

#### EP-36 · `registry` · Report grouping strategy registry
- **Edit**: `lib/timesheets-reports/reportTotals.ts:34`, `buildReportSheet.ts:72`
- **Add**: `registerReportGrouping({ id, label, groupOf(row), sort })`; built-ins
  `project_task`, `project_person`, `project_day`.
- **Unlocks**: `project_month`, `customer_project`, `tag`, `activity_type` groupings.

#### EP-37 · `registry` · Time-entry source registry
- **Edit**: `data/entities.ts` `StaffTimeEntry.source` (`@Enum({ items: [...] })`) →
  widen to a validated `text` column with a registry-backed check; add a migration.
- **Add**: `registerTimeEntrySource({ id, label, icon, editable })`; built-ins
  `manual`, `timer`, `kiosk`, `mobile`.
- **Unlocks**: `jira`, `toggl`, `badge-terminal`, `gps`, `calendar-import` sources with
  their own icons and edit rules. **Blocking today** for any import integration.

#### EP-38 · `registry` · Overlap policy provider
- **Edit**: `lib/time-tracking/overlap.ts`, `api/timesheets/time-entries/overlaps/route.ts`
- **Add**: `registerOverlapPolicy({ id, evaluate(spans, ctx): 'allow' | 'warn' | 'block' })`
- **Unlocks**: hard-blocking overlaps for payroll compliance vs. warn-only for consulting.

#### EP-39 · `registry` · Project code generator provider
- **Edit**: `lib/time-tracking/projectCode.ts:105`, `lib/time-tracking/migrateProjectCodes.ts:80`
- **Add**: `registerProjectCodeGenerator({ id, generate(name, taken, ctx) })`
- **Unlocks**: ERP-aligned codes, customer-prefixed codes, sequence-based codes.

#### EP-40 · `registry` · Capacity / target provider
- **Edit**: `lib/time-tracking-ui/timesheetTargets.ts`, `lib/time-tracking/settings.ts`
  (`targets.dailyHours`)
- **Add**: `registerCapacityProvider({ id, resolve(staffMemberId, dateRange, ctx) })`
- **Unlocks**: contract-hours-aware targets, leave-aware capacity (via the existing
  `staff_leave_requests`), part-time schedules — instead of one flat daily number.

#### EP-41 · `registry` · Report approval / lock policy provider
- **Edit**: `api/timesheets/reports/[id]/{close,unlock}/route.ts`,
  `commands/timesheets-reports.ts`
- **Add**: `registerReportApprovalPolicy({ id, canClose(ctx), canUnlock(ctx), onClosed(ctx) })`
- **Unlocks**: multi-step approval, four-eyes unlock, accounting-period freezes.

### Group 7 — Data model and settings (4)

#### EP-42 · `registry` · Settings key contribution
- **Edit**: `lib/time-tracking/settings.ts` (`TIME_TRACKING_SETTING_KEYS`,
  `normalizeTimeTrackingSettings`), `api/timesheets/settings/route.ts`
- **Add**: `registerTimeTrackingSettingKey({ key, schema, default, group, label })`;
  build the validating zod schema from the registry rather than a literal.
- **Pairs with**: EP-26 for the UI section.
- **Unlocks**: a module shipping its own time-tracking settings without patching core.

#### EP-43 · `entity` · Register TT entities in `ce.ts`
- **Edit**: `ce.ts`
- **Add**: `CustomEntitySpec` entries for `staff_time_entry`, `staff_time_project`,
  `staff_time_task`, `staff_time_report`, `staff_time_tag`.
- **Unlocks**: custom fields on every time-tracking record, automatically surfaced by
  `CrudForm` (`entityIds`), the query engine, filters, search and exports.

#### EP-44 · `entity` · Declare cross-module links
- **Add**: `packages/core/src/modules/staff/data/extensions.ts`
- **Declare**: `staff_time_entry.customer_id → customers.customer`,
  `.deal_id → customers.deal`, `.order_id → sales.order`,
  `staff_time_project.customer_id → customers.customer`
- **Unlocks**: `defineLink`-driven joins and reverse navigation from customer/deal/order
  screens, without any direct ORM relationship (AGENTS.md architecture rule).

#### EP-45 · `entity` · Translation fields
- **Edit**: `translations.ts`
- **Add**: translatable `name` / `description` for `staff_time_project`,
  `staff_time_task_status`, `staff_time_tag`.
- **Unlocks**: multi-language project and status names for international teams.

### Group 8 — Search, analytics, notifications (4)

#### EP-46 · `search` · Index the remaining TT entities
- **Edit**: `search.ts:122`
- **Add**: index sources + presenters for `staff:staff_time_task`,
  `staff:staff_time_report`, `staff:staff_time_tag`, and optionally
  `staff:staff_time_entry` (notes) behind a feature gate.
- **Unlocks**: command-palette and global search over tasks and reports; vector config
  contributions on top.

#### EP-47 · `analytics` · Extend the analytics entity set
- **Edit**: `analytics.ts`
- **Add**: `staff:staff_time_tasks`, `staff:staff_time_projects`,
  `staff:staff_time_reports` entity configs; expose the custom-field columns from EP-43
  through `fieldMappings` so contributed fields become dashboard dimensions.

#### EP-48 · `notification` · Reactive notification handlers + new types
- **Add**: `notifications.handlers.ts` exporting `notificationHandlers`
- **Edit**: `notifications.ts`
- **Add types**: `time_entry.timer_running_long`, `time_report.ready_for_approval`,
  `time_report.approved`, `timesheet.period_incomplete`
- **Unlocks**: `useNotificationEffect` reactions (auto-refresh, focus a row) and a
  documented set of TT notification ids third parties can render or override.

#### EP-49 · `ai` · Time-tracking AI tool pack and agent
- **Add**: `packages/core/src/modules/staff/ai-tools.ts`, `ai-agents.ts`
- **Tools**: `log_time`, `start_timer`, `stop_timer`, `summarize_week`,
  `draft_client_report`, `find_missing_days` — mutations routed through
  `prepareMutation` for the approval contract, ACL-gated by the `staff.timesheets.*` features.
- **Read first**: `.ai/skills/om-create-ai-agent/SKILL.md`.

### Group 9 — Portal and background work (2)

#### EP-50 · `portal` · Customer-portal report surface
- **Add**: a portal page under the `portal`/`customer_accounts` conventions rendering an
  approved `staff_time_report` for the signed-in customer, plus portal injection hosts
  `portal:staff.time_report:{before,after}` and portal nav injection.
- **Depends on**: EP-06 (`portalBroadcast`), `requireCustomerFeatures` page guards.
- **Unlocks**: clients seeing their own hours without a backoffice account.

#### EP-51 · `worker` · Recalculation hook + CLI surface
- **Edit**: `workers/timesheets-reapply-rounding.ts`, `cli.ts`
- **Add**: a `registerTimeTrackingRecalculation({ id, run(scope) })` hook the existing
  worker iterates, and matching `staff timesheets:recalculate --hook=<id>` CLI commands.
- **Unlocks**: third-party rate/cost/rollup backfills reusing the progress + queue plumbing.

---

## Part 3 — Suggested phasing

| Phase | EPs | Rationale |
|---|---|---|
| **P1 — Correctness first** | EP-02, EP-03, EP-04, EP-08, EP-10, EP-11 | Fixes the dormant-events defect, the under-firing budget subscriber and the skipped mutation guards. No new API, immediate value, needed by everything downstream. |
| **P2 — Backend seams** | EP-12, EP-13, EP-14, EP-15, EP-16, EP-05, EP-07, EP-09 | Interceptors, enrichers, sync subscribers, broadcasts, webhooks — all built on P1. |
| **P3 — UI hosts** | EP-17…EP-31 | Mostly additive props and `InjectionSpot` renders; low risk, high visible value. |
| **P4 — Domain registries** | EP-32…EP-41 | Each ships with the current behaviour as the registered default; requires a migration only for EP-37. |
| **P5 — Data model & settings** | EP-42…EP-45 | `ce.ts`, `data/extensions.ts`, `translations.ts`, settings registry — needs `yarn db:generate` review for the custom-field indexes. |
| **P6 — Reach** | EP-46…EP-51 | Search, analytics, notifications, AI, portal, workers. |
| **P0 — Runs alongside** | EP-01 | Grow `extension-points.ts` as each phase lands; it is the catalog of everything above. |

## Part 4 — Cross-cutting requirements

- **Backward compatibility.** Every EP is additive. The event ids in `events.ts`, the
  ACL feature ids in `acl.ts` and the API route paths are FROZEN/STABLE surfaces
  (`BACKWARD_COMPATIBILITY.md`) — EP-02 makes declared ids *fire*, it must not rename one.
  EP-37 is the only schema-narrowing change and needs a migration plus a snapshot update.
- **Defaults preserve behaviour.** Every registry (EP-32…EP-41) registers today's
  implementation as the built-in default at module load; with no third-party
  contribution the observable behaviour is byte-identical. Guard this with the existing
  unit tests for `roundMinutes`, `entryAmount`, `findOverlaps` and `deriveProjectCode`.
- **Scoping.** Every new host context and every registry resolver receives
  `tenantId` + `organizationId` and must fail closed when either is missing — matching
  `resolveProjectAccess` (`lib/time-tracking/access.ts:88`).
- **RBAC.** New injection hosts and registry contributions are feature-gated through the
  existing wildcard-aware `authorizeFeatures` policy; never compare the raw feature array.
- **Integration coverage.** Per `.ai/qa/AGENTS.md`, each phase ships Playwright coverage
  for the affected API and UI paths in the same change, with self-contained fixtures.
- **Docs.** Each phase updates
  `apps/docs/docs/framework/extensibility/current-surfaces.mdx` and the staff
  `AGENTS.md` host table; run `yarn generate` and `yarn agents:check-budget`.
