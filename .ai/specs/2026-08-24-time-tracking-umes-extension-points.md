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
| G-10 Only one CrudForm host, undeclared | Project create/edit pass `entityIds={[E.staff.staff_time_project]}`, so `crud-form:staff.staff_time_project:*` spots exist implicitly (**dot** form — `CrudForm.tsx:840` normalises the colon away; this row originally spelled it with a colon, corrected in P3) — but are not declared anywhere. `TimeEntryDialog`, `NewTaskDialog`, `TaskDrawer` and report creation are hand-rolled and expose nothing. |
| G-11 Closed business rules | `lib/time-tracking/rounding.ts` (union `0\|5\|10\|15` × `up\|nearest`), `lib/time-tracking/cost.ts:applicableRate` (override → project rate, nothing else), `lib/timesheets-reports/reportExport.ts:21` (`'pdf'\|'csv'\|'xlsx'`), `lib/timesheets-reports/reportTotals.ts:34` (`'project_task'\|'project_person'\|'project_day'`), `data/entities.ts` `@Enum({ items: ['manual','timer','kiosk','mobile'] })`, `lib/time-tracking/overlap.ts`, `lib/time-tracking/projectCode.ts`, `lib/time-tracking-ui/timesheetTargets.ts`. All pure functions or DB enums with no registry, provider or DI seam. **Closed in P4** — every one of the eight is now a registry with the original implementation as its built-in default; see Group 6. |
| G-12 TT entities absent from `ce.ts` | `ce.ts` declares only `staff_team_member`. **Partly retracted in P5**: the second clause was wrong — custom fields were *definable* on all five all along, because `entities/api/entities.ts` lists every generated entity id in the Data designer. What is genuinely absent is the *value* path, and `ce.ts` is not what provides it. EP-43 closes the declaration; the write/read path is still open. |
| G-13 No `data/extensions.ts` | `customer_id`, `deal_id`, `order_id` on `StaffTimeEntry` are raw FK ids with no declared link. **Closed in P5** (EP-44), with the caveat that a declared link is traversed by nothing today — see the EP entry. |
| G-14 Search covers 1 of 5 TT entities | `search.ts:195` indexes only `staff:staff_time_project`. **Closed in P6** (EP-46), with a caveat the audit did not anticipate: the search layer has no row-level authorization, so the gate on each new entity had to be the feature set that already grants unrestricted access on the REST route. See the EP-46 entry. |
| G-15 Enrichers not query-engine enabled | `data/enrichers.ts` has no `queryEngine: { enabled: true }`; enrichment is invisible to dashboards, exports and AI. |
| G-16 No AI surface | No `ai-tools.ts` / `ai-agents.ts` in `staff` (`catalog`, `customers`, `eudr`, `warranty_claims` have them). **Closed in P6** (EP-49). |
| G-17 No reactive notification handlers | No `notifications.handlers.ts`. **Closed in P6** (EP-48). |
| G-18 Settings schema is closed | `TIME_TRACKING_SETTING_KEYS` is a frozen array; the settings route validates against a closed zod schema; the settings page renders a fixed form. **Closed in P5** (EP-42): all three read the key registry, and the settings page's `sections` spot can now read and write a contributed key through the draft. |
| G-19 No portal surface | No portal page, no portal injection host, no `portalBroadcast: true` on any TT event. **Closed in P6** (EP-50), and the last clause was still true at the start of P6 — EP-06 had not been implemented in P2 as the phasing table claimed. See the EP-06 entry for why the fix is a separate event id rather than the flag the spec asked for. |
| G-20 Events not webhook-exposed | No webhook registration for `staff.timesheets.*` (blocked by G-2 anyway). **Retracted in P2** — declaring the event IS its registration; see EP-09. |

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
- **Implemented in P3** with 33 declarations covering every host EP-17…EP-31 added. The CLI
  build expands them into **110 emitted host facts** with `unresolved: []` — every
  declaration is `bound`, i.e. its `source` file really references
  `extensionPoints.hosts.<key>`. Documented in the staff `AGENTS.md` → "Host extension
  points"; pinned by `__tests__/timeTrackingExtensionHosts.test.ts`.
- **Correction the spec did not anticipate.** `CrudForm` derives its own spot id from
  `entityIds` by replacing every colon with a dot (`CrudForm.tsx:839-845`), so the
  already-implicit project-form host is `crud-form:staff.staff_time_project`, **not**
  `crud-form:staff:staff_time_project` as G-10 and EP-28…EP-30 spell it. All four
  crud-form hosts therefore use the dot form — the colon form would name a spot no
  widget is ever loaded for. `detail:` spots keep the colon form the spec froze, because
  nothing derives those. Both conventions are pinned by the catalog test.
- **Facts-budget side effect**: `packages/cli/.../module-facts.bc-guard.test.ts` caps the
  generated facts JSON; the 110 new host facts measure 4,289,542 bytes against a 4,250,000
  cap (0.9% over) and 1,900,068 against a 1,900,000 v2-over-legacy delta. Both caps raised
  from the measurement with bounded headroom, per the precedent in that file.

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
- **Payload narrowing (done in P2)**: the DOM Event Bridge filters only by tenant +
  organization and applies **no feature check**, so a broadcast payload must not carry
  money. `time_report.closed` now spells its payload out instead of spreading the close
  result, dropping `totalAmount`; `time_project.budget_threshold_reached` carries
  `budgetValue`/`usedValue` only for an `hours` budget. The other six payloads were
  audited and carry no rate, cost or amount.

#### EP-06 · `event` · `portalBroadcast: true` for the client-facing subset
- ~~**Edit**: `events.ts` — `time_report.closed`, `time_report.exported`~~
- **Pairs with**: EP-50.
- **Not implemented in P2, despite the phasing table listing it there.** Verified in
  P6: `grep -rn portalBroadcast packages/core/src/modules/staff` returned nothing, and
  neither the module `AGENTS.md` nor the EP-05 note mentions it. P2 shipped the
  payload-narrowing half of the broadcast work and left this one alone.
- **Implemented in P6 — and the spec's instruction was wrong, so it was not
  followed.** Setting `portalBroadcast: true` on `time_report.closed` would have been
  a cross-customer disclosure. `customer_accounts/api/portal/events/stream.ts`
  filters a portal broadcast by tenant + organization and narrows to named people
  **only** when the payload carries `recipientUserId(s)`; one organization serves many
  customers, and the `closed` payload carries `reference`, `customerId` and the minute
  totals. Every client of the tenant would have received a live feed of every other
  client's reports. `closed` is also `clientBroadcast: true` with a published webhook
  payload, so it could not be narrowed without breaking its backoffice consumers.
- **What shipped instead** is the `warranty_claims` precedent
  (`warranty_claims.claim.portal_status_changed`, and the rule in that module's
  `AGENTS.md`: "never emit a portal-broadcast event without pinned customer-user
  recipients"): a separate id, `staff.timesheets.time_report.portal_published`, with
  `portalBroadcast: true` + `excludeFromTriggers: true`, emitted only by
  `subscribers/time-report-portal-broadcast.ts`, only for a report that is closed,
  only with `recipientUserIds` resolved from `customer_users.customer_entity_id`, and
  **not at all** when that list is empty. The payload carries the reference and the
  period — no money, because SSE applies no feature check.
- `time_report.exported` is deliberately **not** mirrored: an export changes nothing
  the portal renders; the portal reads the report, not the file.

#### EP-07 · `event` · Sync lifecycle subscriber host for the write pipeline
- **Depends on**: EP-02 (sync dispatch needs `events:`)
- **Add**: `subscribers/README` entry + declared host in EP-01 documenting the
  `metadata: { sync: true, priority }` contract for
  `staff.timesheets.time_entry.creating|created|updating|updated|deleting|deleted`
- **Unlocks**: in-pipeline veto and payload modification (e.g. "block billable time on
  a closed client", "stamp a cost centre from an HR system").
- **Implemented in P2** (unblocked once the module owner accepted the EP-02 resource-tag
  change). The host is documented in the staff `AGENTS.md`; the ids are derived from the
  `events` configs rather than hand-written, and a test fails if the doc and the configs
  disagree. Dispatch is proved end to end against the real time-entries handlers in
  `__tests__/time-tracking-sync-subscribers.test.ts` (veto with the subscriber's own
  status before the command runs, `modifiedPayload` reaching the command input, ascending
  `priority` ordering, wildcard matching).
- **Three findings the spec did not anticipate**, now documented:
  (a) on a command-backed action the payload a subscriber sees is the **mapped command
  input** (post-`mapInput` / `parseScopedCommandInput`), not the request body;
  (b) `modifiedPayload` IS honoured on that path — the re-parse through the action schema
  happens *before* the sync event, for the interceptor body, and nothing re-validates the
  merged input, so a subscriber can write a field the schema would have rejected;
  (c) the **delete** branch builds its sync payload with no mutation data and never merges
  a `modifiedPayload`, so delete subscribers can veto but not rewrite.
- **One gotcha worth a follow-up**: bootstrap registers a `sync: true` subscriber in both
  the event bus and the sync store, so an `after`-phase handler runs twice — once
  in-pipeline, once from the bus, since the after ids are the same strings as the async
  CRUD events. Documented; not changed, because fixing it means touching bootstrap's
  subscriber split for every module.

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
- **Corrected during P2**: there is no per-event webhook registration to add.
  `packages/webhooks/subscribers/outbound-dispatch.ts` subscribes with `event: '*'` and
  matches each emitted id against a webhook's subscribed patterns, so **declaring the
  event in `events.ts` IS its registration** (`packages/webhooks/AGENTS.md` → "When You
  Need Outbound Webhooks", step 1) — it already appears in `GET /api/webhooks/events`.
  Delivery needs `tenantId` in the payload; the dispatcher drops anything without one.
  The package has no payload-schema registry, so P2 published the contract as
  `staff/events.payloads.ts` (zod, one schema per declared id) and pinned coverage plus
  the tenant-scope requirement in `__tests__/timeTrackingEventPayloads.test.ts`.

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
- **Implemented in P2** as `api/timesheets/_shared/withTimesheetInterceptors.ts`, wired
  into 25 routes. `targetRoute` is the pathname without `/api/`; a route with a dynamic
  segment carries the concrete id, so those are targeted with the registry's prefix
  wildcard (`staff/timesheets/time-entries/*`). The helper short-circuits when no
  interceptor targets the route, so an unextended request pays neither the RBAC grant
  read nor the context assembly.

#### EP-13 · `interceptor` · Run `after` interceptors on custom TT routes
- **Use**: `runCustomRouteAfterInterceptors` from
  `@open-mercato/shared/lib/crud/custom-route-interceptor`
- **Wire into**: the same routes as EP-12, plus `reports/[id]/export`.
- **Unlocks**: response shaping for aggregates and exports.
- **Implemented in P2** through the same helper: `session.respond(status, body)` on every
  JSON route. `reports/[id]/export` answers with bytes, which an after-interceptor cannot
  rewrite, so it shapes a **descriptor** — `filename` and `contentType` are read back and
  applied to the download headers.

### Group 4 — Enrichers (3)

#### EP-14 · `enricher` · Time-entry response enricher host
- **Edit**: `data/enrichers.ts`, `api/timesheets/time-entries/route.ts:555`
- **Change**: move the `hooks.afterList: decorateTimeEntryList` logic behind a declared
  enricher for `staff:staff_time_entry`, so third-party enrichers compose with it
  instead of being invisible behind a route-private hook.
- **Implemented in P2**: the decoration moved to `lib/timesheets/timeEntryDecoration.ts`
  and is now the `staff.timesheets-time-entries` enricher. `decorateTimeEntryList` stays
  exported from the route as a deprecated wrapper (it is a public symbol of that module).
  Two knock-on effects, both improvements: the CRUD list cache now stores the
  pre-enrichment rows instead of one caller's decorated copy, and the list response gains
  the standard additive `_meta.enrichedBy` every other enriched list already carries.

#### EP-15 · `enricher` · Task and report enricher hosts
- **Edit**: `data/enrichers.ts`
- **Add**: enrichers for `staff:staff_time_task` (beyond the current rollups) and
  `staff:staff_time_report` (totals, freeze state, export history).
- **Implemented in P2** as `staff.timesheets-tasks-context` (`_staff`: project
  name/code/colour, status name and done flag, assignee name, plus the project rate behind
  `staff.timesheets.rates.view`) and `staff.timesheets-reports` (`_staff`: freeze state,
  frozen entry count, export count / last export date and format, minute totals, plus
  `totalAmount` behind the same feature). The reports CRUD route had no `enrichers`
  config at all and now declares one.

#### EP-16 · `enricher` · Enable query-engine enrichment
- **Edit**: `data/enrichers.ts`
- **Change**: add `queryEngine: { enabled: true }` to the project/task/entry/report
  enrichers so enriched fields reach dashboards, exports, the query engine and AI tools.
- **Read first**: `apps/docs/docs/framework/extensibility/query-engine-extensibility.mdx`.
- **Corrected during P2**: the flag alone is inert for these enrichers. The CRUD factory
  looks an enricher up by the `enrichers.entityId` its route declares — the **colon**
  form, `staff:staff_time_entry` — while the query pipeline looks it up by
  `entityIdToEventEntity(entity)`, the **dot** form (`query-extension-runner.ts:41`). So
  P2 publishes each of the six staff enrichers twice: the colon-form entry for the API
  surface and a `<id>.query-engine` alias on the dot form carrying the opt-in. The two
  lookups never both match, so nothing runs twice. Every one is batched (`enrichMany`
  with `$in`), so none introduces an N+1; the query-engine pipeline only runs at all when
  a caller passes `QueryOptions.extensions`, so the cost is opt-in per call site.
  Residual caveat: a query-engine caller that supplies no DI `container` cannot answer the
  `rates.view` / `projects.manage` checks, so the money and member fields fail **closed**
  there and the enrichment is a subset of what the REST response carries.

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
- **Implemented in P3, tab spot included.** The raw `<Tabs>` did not need a rewrite: the page
  now loads the tab spot with `useInjectionWidgets` and renders a `TabsTrigger` +
  `TabsContent` per contributed widget, exactly the way `companies-v2/[id]/page.tsx` feeds
  `CompanyDetailTabs`. `placement: { kind: 'tab', groupId, groupLabel, priority }` names the
  tab; higher `priority` sorts first; `metadata.title` is the label fallback. The only
  behaviour change is `activeTab` widening from `'team'|'time'|'tasks'` to `string`.
  Proved end to end in `projects/[id]/__tests__/page.injectionSpots.test.tsx`.

#### EP-21 · `injection` · Task drawer / task detail spots
- **Edit**: `lib/time-tracking-ui/TaskDrawer.tsx`, `lib/time-tracking-ui/TaskBoardScreen.tsx`
- **Add**: `detail:staff:staff_time_task:{header,status-badges,tabs,sidebar,footer}`
- **Implemented in P3** in `TaskDrawer.tsx` alone — the drawer is rendered by both
  `TaskBoardScreen` and `KanbanBoard`, so hosting the spots inside it covers both without
  duplicating them. The drawer has no tab strip and no rail, so `tabs` renders a
  contributed widget as an extra panel at the end of the body stack and `sidebar` renders
  at the end of the Properties section; documented as such in the module `AGENTS.md`
  rather than faked as tabs.

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
- **Partially implemented in P3.** The two render spots shipped. The **server-side section
  contribution contract is deferred**: `myWorkAggregate` returns one closed, zod-validated
  shape whose KPI strip, quick-entry targets and totals are all read positionally by the
  page, so a contributed section needs its own registry, its own per-section tenant/org
  scoping and its own response slot before it can be added without loosening that contract
  — more than a UI phase can carry honestly. A client-side spot that fetches its own data
  covers the same use case today; the server contract belongs with the domain-registry work
  in P4.

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
- **Implemented in P3.** The audit was wrong about the group ids: `createProjectFormGroups`
  already emitted stable named ids (`basics`, `billing`, `budget`, `status`, `team`,
  `rounding`, `details`). What was missing was their being a *published* contract, so they
  are now exported as `PROJECT_FORM_GROUP_IDS` / `PROJECT_FORM_COMPACT_GROUP_IDS`,
  documented in the module `AGENTS.md` and pinned by
  `projects/__tests__/projectFormGroupIds.test.ts`. Both pages now pass
  `injectionSpotId={extensionPoints.hosts.projectForm.spotId}` — the same string `CrudForm`
  already derived, so the wire behaviour is unchanged and the declaration becomes `bound`.

#### EP-29 · `crud-form` · Expose a form host for the time-entry dialog
- **Edit**: `lib/time-tracking-ui/TimeEntryDialog.tsx`, `lib/time-tracking-ui/EntryDetailsFields.tsx`
- **Change**: render `InjectionSpot`s for `crud-form:staff:staff_time_entry:{before-fields,fields,after-fields,footer}`
  and run the `onFieldChange` / `onBeforeSave` / `onAfterSave` lifecycle handlers, so the
  hand-rolled dialog behaves like a `CrudForm` host without being rewritten.
- **Implemented in P3** in `TimeEntryDialog.tsx` (the four spots plus the lifecycle);
  `EntryDetailsFields.tsx` needed no change — it is a controlled field group with no save
  path of its own. `onBeforeSave` mirrors `CrudForm`: `ok: false` blocks the write, the
  message is flashed, `fieldErrors` for `taskId`/`durationMinutes` land under those fields,
  and `requestHeaders` merge into the request **under** the optimistic-lock header so a
  widget cannot displace it. `onFieldChange` diffs the ten-field form snapshot and writes
  `value` / `sideEffects` back through the dialog's own setters, with a
  `injectedFieldWritesRef` guard so a handler rewriting its own field is not re-dispatched.
  Pinned by four cases in `__tests__/TimeEntryDialog.test.tsx`.

#### EP-30 · `crud-form` · Form hosts for task and report creation
- **Edit**: `lib/time-tracking-ui/NewTaskDialog.tsx`,
  `backend/staff/time-tracking/reports/create/page.tsx`
- **Add**: `crud-form:staff:staff_time_task:*` and `crud-form:staff:staff_time_report:*`
- **Implemented in P3** as `crud-form:staff.staff_time_task:*` and
  `crud-form:staff.staff_time_report:*` (dot form — see EP-01). `NewTaskDialog` also runs
  `onBeforeSave` (block + message) and `onAfterSave`; the report create page ships the four
  render spots only — it has no per-field state worth diffing and its submit is a preview
  handoff, not the report write.

#### EP-31 · `component` · Register replaceable time-tracking components
- **Add**: `packages/core/src/modules/staff/widgets/components.ts` exporting
  `componentOverrides`, and `registerComponent` calls for:
  `staff.time_entry_dialog`, `staff.timer_bar`, `staff.kanban_card`,
  `staff.kanban_column`, `staff.timesheet_grid` (`GridView`),
  `staff.timesheet_list` (`ListView`), `staff.timesheet_calendar`,
  `staff.report_sheet`, `staff.project_card`, `staff.entries_summary_footer`
- **Unlocks**: `replace` / `wrapper` / `props` overrides per
  `apps/docs/docs/framework/widget-injection.md`.
- **Implemented in P3.** `widgets/components.ts` exports `componentOverrides` (empty — the
  module overrides nobody else's components) and catalogues the ten handles. Each component
  registers itself with `registerComponent` and resolves through `useRegisteredComponent`
  in its own module, following the `customers` idiom, and each publishes an accurate zod
  `propsSchema` built from the shared helpers in `lib/time-tracking/componentContracts.ts`
  — `useRegisteredComponent` parses it in development and falls back to the original
  component when a replacement does not satisfy it.

### Group 6 — Domain strategy registries (10) ✅

Each of these replaces a closed pure function or DB enum with a
`specialized-registry` style contract registered at module load and resolved through DI,
with the current behaviour registered as the built-in default (no behaviour change).

**Implemented in P4.** All ten shipped. What is common to every one of them:

- The registry is a plain module-scope `Map` built by
  `lib/time-tracking/registries/registry.ts`, following the
  `registerPaymentProvider` / `registerShippingProvider` idiom in
  `modules/sales/lib/providers/registry.ts`. `register*` returns its own disposer.
  Module scope rather than DI because four of these strategies back **client**
  previews that cannot resolve a container.
- Six matching DI keys (`timeRoundingResolver`, `timeRateResolver`,
  `timeBillabilityResolver`, `timeCapacityResolver`, `timeOverlapPolicyResolver`,
  `timeProjectCodeResolver`) are the **server** entry point to the same registries, so
  server code never `new`s a resolver and an app can replace one through
  `entry.overrides` DI. The three keyed registries (export format, grouping, entry
  source) are lookups by id and need no resolver service.
- Candidates are ordered by descending `priority` (default `0`), ties by registration
  order, and every built-in registers at `BUILT_IN_STRATEGY_PRIORITY` (`-1000`), so a
  built-in is always the last candidate considered.
- Every resolver context carries `tenantId` + `organizationId`
  (`lib/time-tracking/registries/scope.ts`). A **contributed** strategy is consulted only
  when both are present; failing closed lands on the built-in rather than on an error,
  which is what keeps an unscoped client preview byte-identical.
- Behaviour preservation is pinned by
  `lib/time-tracking/__tests__/strategyRegistries.test.ts` on top of the existing
  `rounding`, `cost`, `overlap`, `projectCode`, `reportTotals` and `reportExport` suites,
  which pass unmodified.

#### EP-32 · `registry` · Rounding strategy registry
- **Edit**: `lib/time-tracking/rounding.ts`; call sites
  `commands/timesheets-entries.ts:386`, `lib/time-tracking/roundingImpact.ts:66`,
  `lib/time-tracking-ui/TimeEntryDialog.tsx:764`, `lib/time-tracking-ui/timeTrackingSettingsForm.ts:38`
- **Add**: `registerTimeRoundingStrategy({ id, label, round(rawMinutes, ctx) })` +
  `timeRoundingResolver` DI key; keep `up`/`nearest` × `0|5|10|15` as built-ins.
- **Unlocks**: per-client billing increments, "round down", "minimum 15m per entry",
  "first 15m free" rules.
- **Shipped**: `registerTimeRoundingStrategy({ id, labelKey, priority?, round(raw, ctx) })`
  in `lib/time-tracking/rounding.ts`; built-in `staff.time_tracking.rounding.unit`; DI key
  `timeRoundingResolver`. `roundMinutes(raw, settings, ctx?)` keeps its signature and
  gained an optional scope; `roundedMinutesFor` / `resolveRoundedMinutes` gained one too
  and every server write path now passes it. `label` shipped as `labelKey` — the module
  may not hold user-facing literals.

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
- **Shipped**: `registerTimeRateResolver({ id, priority?, resolve(ctx): number | null })`
  in `lib/time-tracking/cost.ts`; built-in
  `staff.time_tracking.rate.entry_override_then_project`; DI key `timeRateResolver`.
  `applicableRate` / `entryAmount` keep their signatures and gained an optional third
  context argument. `reportTotals.resolveEntryValues` stopped restating the chain inline
  and calls `applicableRate`. The route call site the spec named moved into
  `lib/timesheets/timeEntryDecoration.ts` in P2 and reaches the registry through
  `entryAmount`.

#### EP-34 · `registry` · Billability resolver
- **Edit**: `commands/timesheets-entries.ts` (project default → tenant default chain)
- **Add**: `registerBillabilityResolver({ id, priority, resolve(ctx): boolean | null })`
- **Unlocks**: "internal projects are never billable", "travel is billable at 50%",
  activity-type-driven billability.
- **Shipped**: `lib/time-tracking/billability.ts`; built-in
  `staff.time_tracking.billability.project_then_tenant`; DI key `timeBillabilityResolver`.
  `resolveTimeEntryBillable` in `commands/timesheets-entries.ts` forwards to it and gained
  an optional `scope`; the entries command and the grid bulk save both pass it. `null` is
  an abstention, so an unopinionated contribution cannot change an entry.

#### EP-35 · `registry` · Report export format registry
- **Edit**: `lib/timesheets-reports/reportExport.ts:21,272`,
  `api/timesheets/reports/[id]/export/route.ts:121,164`
- **Add**: `registerReportExportFormat({ id, label, mimeType, extension, serialize(input) })`;
  register `pdf`, `csv`, `xlsx` as built-ins and drive `normalizeReportExportFormat`
  and the OpenAPI enum off the registry.
- **Unlocks**: `invoice-xml`, `datev`, `json`, customer-branded PDF.
- **Shipped**: `registerReportExportFormat({ id, labelKey, mimeType, extension, serialize })`
  in `lib/timesheets-reports/reportExportFormats.ts` — its own file so `reportExport.ts`,
  which owns the three serializers, can register into it without an import cycle.
  `normalizeReportExportFormat` now asks the registry, the 400 body lists
  `supportedFormats`, and the route's OpenAPI `query` is a **getter** returning
  `z.enum(supportedReportExportFormats())` so a format registered after the route module
  first loads still appears in the published schema.

#### EP-36 · `registry` · Report grouping strategy registry
- **Edit**: `lib/timesheets-reports/reportTotals.ts:34`, `buildReportSheet.ts:72`
- **Add**: `registerReportGrouping({ id, label, groupOf(row), sort })`; built-ins
  `project_task`, `project_person`, `project_day`.
- **Unlocks**: `project_month`, `customer_project`, `tag`, `activity_type` groupings.
- **Shipped**: `registerReportGrouping({ id, labelKey, groupOf(entry), labelOf(key, ctx), sort })`
  in `lib/timesheets-reports/reportGroupings.ts`. `groupOf` returns `{ key, parentKey }`
  so D-2's inclusive task rollup stays expressible; `labelOf` is the strategy's because
  only it knows which directory to look a key up in. `computeReportTotals` resolves the
  strategy once and uses `grouping.sort` for both the billable and non-billable line
  lists. **Round-trip**: the value is persisted on `staff_time_reports.grouping`, which
  was a DB enum with a check constraint AND a literal `z.enum` in `data/validators.ts` —
  both were the real blocker, so the EP-37 migration drops
  `staff_time_reports_grouping_check` too and the validator asks the registry.
  `normalizeReportGrouping` coerces a stored id whose module has been removed back to
  `project_task`. The export and sheet routes read `?grouping=` through the registry.

#### EP-37 · `registry` · Time-entry source registry
- **Edit**: `data/entities.ts` `StaffTimeEntry.source` (`@Enum({ items: [...] })`) →
  widen to a validated `text` column with a registry-backed check; add a migration.
- **Add**: `registerTimeEntrySource({ id, label, icon, editable })`; built-ins
  `manual`, `timer`, `kiosk`, `mobile`.
- **Unlocks**: `jira`, `toggl`, `badge-terminal`, `gps`, `calendar-import` sources with
  their own icons and edit rules. **Blocking today** for any import integration.
- **Shipped**: `registerTimeEntrySource({ id, labelKey, icon, editable })` in
  `lib/time-tracking/timeEntrySources.ts`; built-ins `manual`, `timer`, `kiosk`, `mobile`
  (`kiosk` is the one that is not `editable`). `StaffTimeEntry.source` is now
  `@Property({ type: 'text' })` and `data/validators.ts` validates against the registry
  instead of `z.enum`. `Migration20260824143357_staff.ts` drops
  `staff_time_entries_source_check` (and the EP-36 grouping check); the snapshot diff is
  scoped to those two columns. `normalizeTimeEntrySource` replaces the guarantee the
  dropped constraint gave. **Not run**: `yarn db:migrate`.

#### EP-38 · `registry` · Overlap policy provider
- **Edit**: `lib/time-tracking/overlap.ts`, `api/timesheets/time-entries/overlaps/route.ts`
- **Add**: `registerOverlapPolicy({ id, evaluate(spans, ctx): 'allow' | 'warn' | 'block' })`
- **Unlocks**: hard-blocking overlaps for payroll compliance vs. warn-only for consulting.
- **Shipped**: in `lib/time-tracking/overlap.ts`; built-in
  `staff.time_tracking.overlap.warn_when_enabled` returns `warn` when the tenant's
  `warnings.overlap` setting is on and something intersects, `allow` otherwise — which is
  exactly today's behaviour including the setting's off state. Policies combine by **max
  severity**, so a contribution can only escalate; nothing can suppress a warning the
  tenant asked for. The route reads the setting itself now (it previously read only the
  grace window) and publishes the verdict as an additive `decision` field. The **item
  list is deliberately unchanged** by the policy: the endpoint answers "what intersects",
  `decision` answers "and what should happen".

#### EP-39 · `registry` · Project code generator provider
- **Edit**: `lib/time-tracking/projectCode.ts:105`, `lib/time-tracking/migrateProjectCodes.ts:80`
- **Add**: `registerProjectCodeGenerator({ id, generate(name, taken, ctx) })`
- **Unlocks**: ERP-aligned codes, customer-prefixed codes, sequence-based codes.
- **Shipped**: in `lib/time-tracking/projectCode.ts`; built-in
  `staff.time_tracking.project_code.initials`; DI key `timeProjectCodeResolver`.
  **Correction to the audit**: `deriveProjectCode` DOES have a runtime call site — two,
  both client-side, in `lib/time-tracking-ui/ProjectCodeField.tsx` (the live suggestion
  as a project name is typed, and the reset-to-derived action). It is therefore reachable
  from project creation and editing, not only from tests. The migration helper
  `lib/time-tracking/migrateProjectCodes.ts` uses `deriveProjectCodeBase`, a different
  function, which is why the audit read it as unwired. Because both call sites are
  unscoped, both resolve the built-in today.

#### EP-40 · `registry` · Capacity / target provider
- **Edit**: `lib/time-tracking-ui/timesheetTargets.ts`, `lib/time-tracking/settings.ts`
  (`targets.dailyHours`)
- **Add**: `registerCapacityProvider({ id, resolve(staffMemberId, dateRange, ctx) })`
- **Unlocks**: contract-hours-aware targets, leave-aware capacity (via the existing
  `staff_leave_requests`), part-time schedules — instead of one flat daily number.
- **Shipped**: `lib/time-tracking/capacity.ts`; built-in
  `staff.time_tracking.capacity.flat_daily_hours`; DI key `timeCapacityResolver`.
  `resolve` answers `{ targetMinutesByDate, totalTargetMinutes }` so a contributed
  provider can vary per day; the built-in spreads `targets.dailyHours` over the caller's
  working days and answers `totalTargetMinutes: null` when the tenant set no target.

#### EP-41 · `registry` · Report approval / lock policy provider
- **Edit**: `api/timesheets/reports/[id]/{close,unlock}/route.ts`,
  `commands/timesheets-reports.ts`
- **Add**: `registerReportApprovalPolicy({ id, canClose(ctx), canUnlock(ctx), onClosed(ctx) })`
- **Unlocks**: multi-step approval, four-eyes unlock, accounting-period freezes.
- **Shipped**: `lib/timesheets-reports/reportApprovalPolicies.ts`; built-in
  `staff.time_tracking.report_approval.acl_only`, which refuses nothing. **A policy can
  only refuse, never grant** — `canClose` / `canUnlock` return a refusal
  (`{ code, messageKey }`) or nothing, so there is no shape in which a policy opens a
  door the ACL closed, and the `staff.timesheets.lock` /
  `staff.timesheets.reports.unlock` checks still run first and unconditionally in the
  routes. Every policy must agree; the first refusal becomes a 403. `onClosed` fires
  after the freeze has committed and a throwing hook is logged, never unwound.

### Group 7 — Data model and settings (4) ✅

**Implemented in P5.** One of the four (EP-42) is a working runtime feature; the other
three are *declaration* surfaces, and the audit under-stated how much of what they were
supposed to "unlock" is still missing. Each entry below says which it is.

#### EP-42 · `registry` · Settings key contribution ✅
- **Edit**: `lib/time-tracking/settings.ts` (`TIME_TRACKING_SETTING_KEYS`,
  `normalizeTimeTrackingSettings`), `api/timesheets/settings/route.ts`
- **Add**: `registerTimeTrackingSettingKey({ key, schema, default, group, label })`;
  build the validating zod schema from the registry rather than a literal.
- **Pairs with**: EP-26 for the UI section.
- **Unlocks**: a module shipping its own time-tracking settings without patching core.
- **Shipped** as `lib/time-tracking/settingKeys.ts`, an 11th registry on P4's
  `createStrategyRegistry`, registry id `staff.time_tracking.setting_key`.
  `registerTimeTrackingSettingKey({ group, key, schema, default, labelKey, priority? })`
  — `group` + `key` because the config row name has always been the dotted
  `<group>.<key>`, and `labelKey` rather than `label` for the same reason P4's registries
  use one: the module holds no user-facing literals. The eight frozen keys are the
  built-ins; `api/timesheets/settings/__tests__/route.test.ts` passes **unmodified**,
  including its `setValueSpy` count of exactly 8.
- **Schema**: `buildTimeTrackingSettingsSchema()` composes the shape per group; the route
  builds it per request and publishes it through OpenAPI getters, so a late registration
  still validates and still appears in the published schema (the EP-35 precedent).
  `staffTimeTrackingSettingsSchema` stays exported as the load-time snapshot.
- **Scope, made explicit**: one `ModuleConfigService` row per key under module id
  `staff.time_tracking`, written with `{ tenantId }` and nothing else. A contributed value
  is tenant-global with `organization_id` null; a contribution cannot opt into
  per-organization storage. Pinned by a test.
- **Rendering**: `staff.time_tracking.settings:sections` (EP-26) now carries
  `{ moduleId, canManage, keys, values, setValue }`. `values` holds contributed keys only,
  and `setValue(id, value)` writes into the page draft, which required threading a
  `contributed` bag through `TimeTrackingSettingsDraft` / `toSettingsDraft` /
  `toSettingsPayload` / `isSettingsDraftDirty` — without it the page's Save rebuilds the
  body from named fields and would have dropped every contributed value, the same defect
  `buildProjectPayload` has for custom fields (EP-43).
- **Types**: `TimeTrackingSettings` is now
  `TimeTrackingBuiltInSettings & Record<string, Record<string, unknown>>`, so the five
  built-in groups stay statically typed and a contributed group is read with the new
  `readTimeTrackingSettingValue(settings, '<group>.<key>')`.

#### EP-43 · `entity` · Register TT entities in `ce.ts` ⚠️ declaration only
- **Edit**: `ce.ts`
- **Add**: `CustomEntitySpec` entries for `staff_time_entry`, `staff_time_project`,
  `staff_time_task`, `staff_time_report`, `staff_time_tag`.
- ~~**Unlocks**: custom fields on every time-tracking record, automatically surfaced by
  `CrudForm` (`entityIds`), the query engine, filters, search and exports.~~
- **Shipped**, with `showInSidebar: false` and no default fields, and the "unlocks" line
  above **corrected**. All five are *system* entity ids, which changes what a declaration
  means:
  - `entities/lib/install-from-ce.ts` sets `registerEntity = false` for a system id, so
    the installer seeds only `fields` and never writes a `custom_entities` row —
    `label`, `description` and `showInSidebar` are metadata for code, not the installer.
  - **Defining** custom fields on these entities already worked: `entities/api/entities.ts`
    lists every generated entity id, so the Data designer always offered them. EP-43 is not
    what turns that on.
  - The one runtime behaviour the declaration adds is `labelField`, read by
    `attachments/lib/assignmentDetails.ts` to label an attached record. It also flips
    `customFields: true` in the generated module facts.
  - **Storing a value does not work.** All five `makeCrudRoute` resources are
    command-backed, and the factory honours `actions.*.customFields` only on its ORM write
    path (`factory.ts:2403`, `:2741`), so a `cf_*` key posted to `/api/staff/timesheets/*`
    is dropped in silence. Reading does not work either — none declares
    `list.decorateCustomFields`.
  - The project form is the only real `CrudForm` and does pass
    `entityIds={[E.staff.staff_time_project]}`, so it renders custom-field inputs — and
    `buildProjectPayload` copies named fields, so it drops them before the request. That
    defect pre-dates P5 and is unchanged by it.
  - Closing the gap means threading `splitCustomFieldPayload` through each route's
    `mapInput` and calling `setCustomFieldsIfAny` in the command (the
    `commands/team-members.ts` idiom), plus `list.decorateCustomFields` on the five list
    routes. That is a phase of its own; it was **not** done here.
- **No migration.** Custom fields are EAV rows in the `entities` module's tables;
  `yarn db:generate` reports `staff: no changes`.

#### EP-44 · `entity` · Declare cross-module links ⚠️ declaration only
- **Add**: `packages/core/src/modules/staff/data/extensions.ts`
- **Declare**: `staff_time_entry.customer_id → customers.customer`,
  `.deal_id → customers.deal`, `.order_id → sales.order`,
  `staff_time_project.customer_id → customers.customer`
- **Unlocks**: `defineLink`-driven joins and reverse navigation from customer/deal/order
  screens, without any direct ORM relationship (AGENTS.md architecture rule).
- **Shipped** as four `EntityExtension` literals — the house idiom every other
  `data/extensions.ts` in the repo uses; `defineLink` is the same object with the fields
  spread, and the literal form is what the existing files spell. `base` is the other
  module's entity (`customers:customer_entity`, `customers:customer_deal`,
  `sales:sales_order`) and `extension` is the staff entity holding the FK, because the
  query engine only ever looks a link up by `base`.
- **No hard dependency, by construction**: the file contains string ids and imports only
  `EntityExtension` from `@open-mercato/shared`. `requires: ['planner', 'resources']` is
  unchanged. `__tests__/entityExtensions.test.ts` fails if an import to customers or sales
  appears or if `requires` grows — the extraction of staff into its own package stays
  possible.
- **Correction to the "unlocks" line**: nothing traverses these today. The query engine
  joins an extension only when a caller passes `QueryOptions.includeExtensions`, which no
  call site in the repo does; the join adds **no projection** and exposes no filterable or
  sortable alias (`engine.ts:1060` — "no selection yet"); and the hybrid engine DI
  registers ignores the flag outside its basic-engine fallback. This is the same
  declaration-only status already documented on
  `apps/mercato/src/modules/example/data/extensions.ts`.
- **Not added to `extension-points.ts`**: `module-extension-facts.ts` already emits an
  `entity`-family host with the `entity-extension` capability for every entity a module
  owns, so a declaration here would duplicate it and would be emitted as an
  `unbound-declaration` diagnostic (nothing could reference
  `extensionPoints.hosts.<key>` from `data/extensions.ts` without inventing a fake use).

#### EP-45 · `entity` · Translation fields ✅
- **Edit**: `translations.ts`
- **Add**: translatable `name` / `description` for `staff_time_project`,
  `staff_time_task_status`, `staff_time_tag`.
- **Unlocks**: multi-language project and status names for international teams.
- **Shipped** as `staff_time_project: ['name', 'description']`,
  `staff_time_task_status: ['name']`, `staff_time_tag: ['label']` — column names, and only
  columns that exist: task statuses have no description column and a tag's human-readable
  column is `label`, so the spec's "name / description" reads as "the human-readable
  columns of each".
- **Registration path, corrected**: `translations/di.ts` hard-codes four core modules and
  does **not** include staff, so that is not what registers these. The generator does:
  `translations-fields.generated.ts` imports every module's `translations.ts` and calls
  `registerTranslatableFields`. A core module importing staff would violate the module's
  MUST rule 1, so the di.ts list is deliberately left alone.
- **One rendered change today**: `translations/widgets/injection-table.ts` derives
  `crud-form:<module>.<entity>:header` spots from that registry, so the project **edit**
  form gains the translation-manager affordance. It is gated on `translations.view` and on
  a record id, so create forms and callers without the feature see nothing. No list or
  detail output changes until a tenant writes a translation — the overlay substitutes only
  when a row exists for the request locale.

### Group 8 — Search, analytics, notifications (4) ✅

**Implemented in P6.** Two of the four came with a correction; both are written into
the entries below rather than into the implementation.

#### EP-46 · `search` · Index the remaining TT entities ✅
- **Edit**: `search.ts:122`
- **Add**: index sources + presenters for `staff:staff_time_task`,
  `staff:staff_time_report`, `staff:staff_time_tag`, and optionally
  `staff:staff_time_entry` (notes) behind a feature gate.
- **Unlocks**: command-palette and global search over tasks and reports; vector config
  contributions on top.
- **Shipped**: all four, following the existing `buildTeamPresenter` idiom, with money
  columns in `fieldPolicy.excluded` and no rate, cost or amount in any presenter.
- **The question the spec did not ask, answered: yes, an indexed task or report WOULD
  leak to a caller without project access — under the gate the spec implied.** The
  search layer has **no row-level authorization**. `aclFeatures` is the only
  authorization it applies, enforced twice per query (`resolveReadableEntityTypes`
  narrows the entity list before, `filterSearchResultsByEntityAccess` filters results
  after) but **per entity type** both times; `SearchEntityConfig` has no `filter` /
  `authorize` hook and `SearchOptions` has no record-id allowlist. So a gate of
  `tasks.view` alone would have handed every task title, reference and deep link in
  the tenant to any holder of that feature, while `/api/staff/timesheets/tasks`
  intersects the same query with `resolveProjectAccess`.
- **What shipped instead**: each gate names the feature set whose holder already sees
  every record of that entity through the API — `tasks.view` **+**
  `projects.manage` for tasks, `reports.view` **+** `projects.manage` for reports,
  `staff.timesheets.view` **+** `projects.manage` for entries (`projects.manage` is
  what makes `resolveProjectAccess` answer `canManageAll`, the only state in which the
  membership intersection stops). Tags are organization-global on their own route and
  correctly carry only `staff.timesheets.view`. The consequence, documented in the
  module `AGENTS.md`: a project member without `projects.manage` gets no task, report
  or entry hits at all — including their own. The gate cannot express "own", and half
  a gate discloses other clients' work.
- **Tags resolve no URL.** There is no tag detail screen and the entries list
  deep-links only `taskId` and `ids`, so `url` is left undefined (it is optional in
  the result contract) rather than pointed somewhere wrong.

#### EP-47 · `analytics` · Extend the analytics entity set ✅
- **Edit**: `analytics.ts`
- **Add**: `staff:staff_time_tasks`, `staff:staff_time_projects`,
  `staff:staff_time_reports` entity configs; ~~expose the custom-field columns from
  EP-43 through `fieldMappings` so contributed fields become dashboard dimensions~~.
- **Shipped**: the three new configs plus additive mappings on the existing
  `staff:staff_time_entries` (rounded minutes, task, customer, billability, lock),
  each with `requiredFeatures` and `labelResolvers` pinned against the migration
  snapshot by a test.
- **The custom-field clause is struck, and the honest answer is no.**
  `AnalyticsFieldMapping` is `{ dbColumn, type }`, and `dashboards/lib/aggregations.ts`
  emits `dbColumn` as a bare identifier against the single `entityConfig.tableName`
  (guarded by `isSafeIdentifier`). A mapping can therefore only ever name a real
  column on that one table. The EP-43 custom fields are EAV rows in the `entities`
  module's tables: there is no join facility, `labelResolvers` only resolves an
  id → label from another table, and the jsonb-path form needs the values to live in a
  jsonb column on the row itself. Even if the read path existed, P5 already
  established the write path does not — a `cf_*` key posted to these command-backed
  routes is dropped in silence.
- **No money column is mapped**, deliberately: an `AnalyticsEntityConfig` carries one
  `requiredFeatures` list for the whole entity, so there is no shape in which
  `total_amount` or `hourly_rate` is gated on `staff.timesheets.rates.view` while the
  rest of the entity stays readable by a plain viewer.

#### EP-48 · `notification` · Reactive notification handlers + new types ✅
- **Add**: `notifications.handlers.ts` exporting `notificationHandlers`
- **Edit**: `notifications.ts`
- **Add types**: `time_entry.timer_running_long`, `time_report.ready_for_approval`,
  `time_report.approved`, `timesheet.period_incomplete`
- **Shipped** as `staff.timesheets.time_entry.timer_running_long`,
  `staff.timesheets.time_report.{ready_for_approval,approved}` and
  `staff.timesheets.timesheet.period_incomplete` — the module's existing namespace —
  each with actions, a `linkHref` and a browser handler carrying a stable override key.
- **One of the four has a core raiser; three ship contributable-only, on purpose.**
  `time_report.approved` is raised by `subscribers/time-report-approved-notification.ts`
  on `time_report.closed`: closing IS the approval in this module (it freezes every
  per-entry value, locks the entries and is gated on `staff.timesheets.lock`), and the
  recipient is the report's author, never the closer. The other three would each need
  machinery the module does not have and that inventing to justify an id would be the
  tail wagging the dog — `ready_for_approval` needs a second approval step, which is
  precisely what a `registerReportApprovalPolicy` contribution (EP-41) adds;
  `timer_running_long` needs a scheduled sweep over open timers; `period_incomplete`
  needs a capacity provider (EP-40) with an opinion about when to complain. Each ships
  with its renderer, delivery preferences and browser handler in place, so a
  contributed raiser gets a working notification without patching core. That is the
  opposite of the dormant-id defect P1 removed: a dormant id was one core *claimed* to
  emit and did not.

#### EP-49 · `ai` · Time-tracking AI tool pack and agent ✅
- **Add**: `packages/core/src/modules/staff/ai-tools.ts`, `ai-agents.ts`
- **Tools**: `log_time`, `start_timer`, `stop_timer`, `summarize_week`,
  `draft_client_report`, `find_missing_days` — ~~mutations routed through
  `prepareMutation` for the approval contract~~, ACL-gated by the `staff.timesheets.*`
  features.
- **Shipped**: six tools in `ai-tools/time-tracking-pack.ts` plus the
  `staff.time_tracking_assistant` agent (`readOnly: false`,
  `mutationPolicy: 'confirm-required'`).
- **Correction: a module tool cannot route through `prepareMutation`, and none does.**
  `prepareMutation` is framework code — its only production call site is
  `agent-tools.ts` in `@open-mercato/ai-assistant`, which *intercepts* the model's tool
  call, short-circuits the handler, persists an `AiPendingAction` and returns the
  preview card. A tool opts into that contract by declaring `isMutation: true` and a
  `loadBeforeRecord` resolver that renders the diff; the agent opts in with
  `mutationPolicy: 'confirm-required'`. The handler then runs later, once, from the
  confirm route, with the stored input. Calling `prepareMutation` from a tool would be
  calling the interceptor from inside the thing it intercepts. (`.ai/skills/om-create-ai-agent/SKILL.md`
  §5 and `packages/ai-assistant/AGENTS.md` line 170 both show the wrong skeleton; the
  spec inherited it from them.)
- **No time-entry write is reimplemented.** Every tool is API-backed through
  `createAiApiOperationRunner`, which resolves the documented route from the generated
  manifest and refuses a route whose `requiredFeatures` the tool does not itself
  declare — so the gate is checked twice, and the route still applies the
  project-access intersection, the mutation guards, the interceptors and the commands.
- The pack acts as the caller's own staff member and no tool accepts a
  `staffMemberId`. `draft_client_report` asks the preview route for `showRates: false`
  and projects only minute columns, so an agent transcript never becomes a second,
  ungated copy of a customer's rate card.

### Group 9 — Portal and background work (2) ✅

#### EP-50 · `portal` · Customer-portal report surface ✅
- **Add**: a portal page under the `portal`/`customer_accounts` conventions rendering an
  approved `staff_time_report` for the signed-in customer, plus portal injection hosts
  `portal:staff.time_report:{before,after}` and portal nav injection.
- **Depends on**: EP-06 (`portalBroadcast`), `requireCustomerFeatures` page guards.
- **Unlocks**: clients seeing their own hours without a backoffice account.
- **Shipped**: `frontend/[orgSlug]/portal/time-reports/{page,[id]/page}.tsx` with
  `requireCustomerAuth` + `requireCustomerFeatures: ['portal.time_reports.view']` in
  `page.meta.ts`, a `nav` block so the sidebar lists it, the two injection hosts on the
  detail page, and `GET /api/staff/portal/time-reports{,/[id]}`.
- **The ownership check, in full.** Four predicates in one WHERE clause, all four from
  the customer session and none from the request:
  `tenant_id = auth.tenantId`, `organization_id = auth.orgId`,
  `customer_id = auth.customerEntityId`, `status = 'closed' AND deleted_at IS NULL`.
  `customerEntityId` is `customer_users.customer_entity_id`, the FK into
  `customers:customer_entity` — the same id `staff_time_reports.customer_id` holds, per
  the link EP-44 declares. A session without one is refused `403` rather than shown an
  unscoped list. The detail route loads the row **with** the predicates rather than
  loading it and checking afterwards, so another customer's id is a `404` (never a
  `403`, which would confirm it exists) and is never read even momentarily. The clause
  lives once in `lib/time-tracking/portalReports.ts`.
- **Money is structurally absent, not conditionally hidden.**
  `staff.timesheets.rates.view` is a *staff* feature graded by `rbacService`; a portal
  identity is graded by `CustomerRbacService` against the disjoint `portal.*` namespace
  and can never hold it, so the module's "absent, not blanked" rule resolves to
  "absent, always". The response schemas carry no rate, cost, amount or currency field
  at all, the SQL does not select `frozen_rate_amount` / `frozen_amount`, and a test
  fails if a money-shaped key appears in a response body.
- **Staff takes no static dependency on `customer_accounts`**, so the extraction into
  `@open-mercato/staff` stays possible: the routes resolve the portal identity with a
  dynamic `import()` and answer `401` if it fails, and `portalRecipients.ts` reads
  `customer_users` by table name through Kysely. `requires` is unchanged.
- `portal.time_reports.view` is granted to `buyer` and `viewer` through
  `setup.defaultCustomerRoleFeatures`, not `acl.ts` — that file is the staff catalog.
- Portal broadcast is wired to the **new** EP-06 event, not to `time_report.closed`;
  see the EP-06 entry for why.

#### EP-51 · `worker` · Recalculation hook + CLI surface ✅
- **Edit**: `workers/timesheets-reapply-rounding.ts`, `cli.ts`
- **Add**: a `registerTimeTrackingRecalculation({ id, run(scope) })` hook the existing
  worker iterates, and matching `staff timesheets:recalculate --hook=<id>` CLI commands.
- **Unlocks**: third-party rate/cost/rollup backfills reusing the progress + queue plumbing.
- **Shipped** as `registerTimeTrackingRecalculation({ id, labelKey, priority?, run(ctx) })`
  on P4's `createStrategyRegistry`, registry id `staff.time_tracking.recalculation`,
  with the retro-rounding pass registered as the built-in
  `staff.time_tracking.recalculation.rounding`. `run` receives `{ container, scope, report }`
  and answers a count summary; it does **not** own the `ProgressJob`, because several
  hooks share one when the CLI runs them together and a hook that started or completed
  the job would fight the next one. `runTimeTrackingRecalculations` owns start / totals
  / cancel / complete; marking a job failed stays the worker's, so the failure is never
  written twice. Hooks run sequentially in registry order — they write the same rows.
- **The settings route is byte-identical.** `ReapplyRoundingJobPayload` gained an
  optional `hookIds`; absent — which is every job that route enqueues — resolves to the
  built-in alone, so a contribution cannot attach itself to the retro-rounding button a
  tenant pressed. `reapplyRoundingWithProgress` keeps its signature and behaviour (its
  existing suite passes unmodified); the batching moved into `reapplyRoundingBatches`
  so the runner and the wrapper share one copy of the candidate query and the
  locked-entry exclusion.
- **CLI**: `mercato staff timesheets:recalculate --tenant <id> [--org <id>] [--hook <id>[,<id>]]`
  and `--list`. It enqueues onto the same queue with the same `ProgressJob` the
  settings screen uses rather than doing the work in process — a CLI that wrote billing
  data itself would be a second implementation of that write. An unknown `--hook` id
  refuses to start rather than silently doing nothing.

---

## Part 3 — Suggested phasing

| Phase | EPs | Rationale |
|---|---|---|
| **P1 — Correctness first** | EP-02, EP-03, EP-04, EP-08, EP-10, EP-11 | Fixes the dormant-events defect, the under-firing budget subscriber and the skipped mutation guards. No new API, immediate value, needed by everything downstream. |
| **P2 — Backend seams** | EP-12, EP-13, EP-14, EP-15, EP-16, EP-05, EP-07, EP-09 | Interceptors, enrichers, sync subscribers, broadcasts, webhooks — all built on P1. |
| **P3 — UI hosts** ✅ | EP-17…EP-31 | Mostly additive props and `InjectionSpot` renders; low risk, high visible value. **Shipped**, except the server-side "my work" section contract (EP-25), deferred to P4 with reasoning above. |
| **P4 — Domain registries** ✅ | EP-32…EP-41 | Each ships with the current behaviour as the registered default. **Shipped.** One migration (`Migration20260824143357_staff.ts`) covers EP-37 **and** EP-36: the grouping check constraint was as much a blocker to a contributed grouping round-tripping as the source constraint was to a contributed source, so both were dropped together. |
| **P5 — Data model & settings** ✅ | EP-42…EP-45 | `ce.ts`, `data/extensions.ts`, `translations.ts`, settings registry. **Shipped**, with the honest scope written into each EP: EP-42 is a working registry, EP-43 and EP-44 are declaration surfaces whose consumers do not exist yet. **No migration** — `yarn db:generate` reports `staff: no changes`, because custom fields are EAV rows in the `entities` module's tables, not columns on the staff ones. Follow-up worth its own phase: the custom-field write/read path for the five command-backed time-tracking CRUD routes. |
| **P6 — Reach** ✅ | EP-46…EP-51, **and EP-06** | Search, analytics, notifications, AI, portal, workers. **Shipped.** EP-06 was **omitted from this phase table entirely** — it appears in no P1–P6 row, so no phase brief ever assigned it and it went unimplemented until P6 caught it. Closed here, though not the way the spec spelled it: the flag it asked for on `time_report.closed` would have broadcast one customer's report metadata to every other customer of the organization, so a separate pinned-recipient event id shipped instead. Two more spec claims corrected: search has no row-level authorization (EP-46), and a module tool cannot call `prepareMutation` (EP-49). Custom fields still cannot be analytics dimensions (EP-47). **No migration** — `yarn db:generate` reports no schema change; the phase adds no column. |
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
