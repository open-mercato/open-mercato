# Staff Module — Agent Guidelines

The `staff` module is **optional** and slated for extraction into a standalone `@open-mercato/staff` package published from the [official-modules](https://github.com/open-mercato/official-modules) repository. Core modules MUST NOT take direct dependencies on staff entities, helpers, or services — cross-module contact happens through the public surfaces listed below.

See [`.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md`](../../../../../.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md) for the decoupling plan, and [`BACKWARD_COMPATIBILITY.md`](../../../../../BACKWARD_COMPATIBILITY.md) for the contract-surface taxonomy referenced below.

## MUST Rules

1. **MUST NOT import staff entities (`StaffTeam`, `StaffTeamMember`, etc.) from non-staff core modules.** Use the public surfaces below.
2. **MUST treat the entity classes in `data/entities.ts` as module-internal.** They are not part of the public contract.
3. **MUST follow the `BACKWARD_COMPATIBILITY.md` deprecation protocol** before renaming or removing any of the public surfaces listed here — same as any other public contract surface in the platform.

## Public Contract Surfaces

### DI services (BC surface #9 — STABLE)

| Key | Contract |
|-----|----------|
| `availabilityAccessResolver` | Resolves an `AvailabilityWriteAccess` shape for the authenticated request, including whether the caller may edit availability for all members vs only themselves. Consumed by `planner/api/access.ts` via `container.resolve(..., { allowUnregistered: true })` — planner gracefully degrades to `403 staff_module_not_loaded` when staff is absent. |
| `timeRoundingResolver` | Server entry point to the rounding registry (EP-32). `resolveStrategy(ctx?)` returns the strategy a scoped call site should run; `roundMinutes(raw, settings, ctx?)` is the module function. See § Time-tracking strategy registries. |
| `timeRateResolver` | Server entry point to the rate resolver chain (EP-33). `resolveRate(ctx)`. |
| `timeBillabilityResolver` | Server entry point to the billability chain (EP-34). `resolveBillability(ctx)`. |
| `timeCapacityResolver` | Server entry point to the capacity provider (EP-40). `resolveCapacity(staffMemberId, dateRange, ctx)`. |
| `timeOverlapPolicyResolver` | Server entry point to the overlap policy (EP-38). `evaluate(spans, ctx)`. |
| `timeProjectCodeResolver` | Server entry point to the project code generator (EP-39). `generate(name, taken, ctx?)`. |
| `timeTrackingAccessResolver` | The single project-access resolver every time-tracking route consults (board, tasks, entries, timesheets, reports). Returns `{ canManageAll, projectIds, staffMemberId }`. `canManageAll: true` (holder of `staff.timesheets.projects.manage`, wildcard-aware) means **unrestricted** — `projectIds` is then empty and MUST NOT be read as "no projects". Otherwise `projectIds` lists the projects with an active, non-deleted `staff_time_project_members` row for the caller. A caller with no staff profile is a normal outcome (`staffMemberId: null`, empty `projectIds`) that drives the no-access screen, never an error. Every query is scoped by `tenantId` + `organizationId`; a request missing either fails closed. |

Resolver shapes (from `lib/availabilityAccess.ts` and `lib/time-tracking/access.ts`):

```ts
type AvailabilityAccessResolver = {
  resolveAvailabilityWriteAccess(
    ctx: AvailabilityAccessContext,
  ): Promise<AvailabilityWriteAccess>
}

type TimeTrackingAccessResolver = {
  resolveProjectAccess(ctx: {
    em: EntityManager
    userId?: string | null
    tenantId?: string | null
    organizationId?: string | null
    userFeatures?: readonly string[]
    /** The manage-all decision, resolved by the caller through `resolveFeatureAccess`. Preferred over `userFeatures`. */
    canManageAll?: boolean
    /** Resolved `access.assignmentGraceDays`; omitted/null falls back to the documented default (14). */
    assignmentGraceDays?: number | null
    /** Injectable clock for the assignment window; defaults to now. */
    now?: Date
  }): Promise<{ canManageAll: boolean; projectIds: string[]; staffMemberId: string | null }>
}
```

**Assignment window (spec D-12).** Membership alone is not access: a non-manager reaches a project only while `assigned_start_date <= today <= assigned_end_date + assignmentGraceDays` (a null end date is open-ended). Pass `assignmentGraceDays` from `readTimeTrackingSettings(...).access.assignmentGraceDays` — the resolver deliberately does not read `ModuleConfigService` itself, so it stays testable and a caller that already loaded settings avoids a second lookup. Both extra fields are optional and default safely; existing callers are unaffected. An unparseable date bound or an unusable clock fails **closed**.

`AvailabilityWriteAccess.unregistered?: boolean` is an additive sentinel field (BC surface #2 — STABLE) set to `true` only when staff DI is missing. Existing required fields MUST NOT be removed.

Route-side, gate a project id with `assertProjectAccess(access, projectId)` from `lib/time-tracking/access.ts` instead of re-implementing the `canManageAll` / `projectIds` check. `userFeatures` is matched with the shared `authorizeFeatures` policy, so `staff.*` and `staff.timesheets.*` grants are honoured — MUST NOT compare the raw feature array with exact string equality.

**One RBAC authority (time tracking).** Every time-tracking feature question MUST go through `resolveFeatureAccess(container, userId, features, scope)` in [`lib/time-tracking/featureAccess.ts`](./lib/time-tracking/featureAccess.ts) — the module MUST NOT hand-roll a `rbacService.getGrantedFeatures` / `userHasAllFeatures` read at a call site. It asks `userHasAllFeatures` (the call that carries `isSuperAdmin`), fails closed on every path, and logs the failure. It returns `{ allowed, grantedFeatures }`:

- `allowed` is the decision. Authorize on this, and pass it to `resolveProjectAccess` as `canManageAll` rather than letting the resolver re-derive it from an array.
- `grantedFeatures` is plumbing for the surfaces that take a list — approval policies, the interceptor context, `runRouteMutationGuards`. It is **always an array, never `null`**: a nullable grant list cannot say whether an empty answer means "no grants" or "could not ask", and every consumer treats an empty one the same fail-closed way. MUST NOT gate money, or anything else, on it.

### API routes (BC surface #7 — STABLE)

| Route | Owner | Notes |
|-------|-------|-------|
| `GET /api/staff/team-members/assignable` | staff | Canonical URL for listing assignable staff candidates from customer flows. RBAC is customer-driven (`customers.roles.view` page guard + `customers.roles.manage` OR `customers.activities.manage` handler check) — see the route file for details. |

Replaces the deprecated `GET /api/customers/assignable-staff`, which now returns `308 Permanent Redirect` and will be removed no earlier than the next major release.

#### Time tracking (`/api/staff/timesheets/*`)

The consulting suite added the routes below. The URL namespace stays `staff/timesheets` even though the pages moved to `/backend/staff/time-tracking/*` — the routes are a STABLE surface and were not renamed.

| Route | Features | Notes |
|-------|----------|-------|
| `GET/POST/PUT/DELETE /tasks`, `PATCH /tasks/[id]/status`, `GET/POST/PUT/DELETE /tasks/[id]/comments` | `tasks.view` / `tasks.manage` | Tasks are depth-1 (a subtask is a child task, D-2). Every query is intersected with `resolveProjectAccess`. `?tagIds=` narrows to tasks carrying **every** listed tag. |
| `GET/POST/PUT/DELETE /task-statuses` | `tasks.view` / `tasks.manage` | Per-project Kanban columns (D-1), seeded when a project is created. |
| `GET/POST/PUT/DELETE /tags`, `POST/DELETE /tags/{task,entry}-assignments` | `tasks.view` / `tasks.manage` | Refuses to tag an entry locked in a closed report. |
| `POST /time-entries/[id]/duplicate`, `POST /time-entries/copy-day`, `GET /time-entries/overlaps` | `manage_own` / `view` | Overlaps is advisory and midnight-aware (D-8); copy-day refuses a non-empty target unless `allowDuplicates`. |
| `GET/POST/PUT/DELETE /reports`, `POST /reports/preview`, `GET /reports/[id]/sheet`, `POST /reports/[id]/{close,unlock}`, `GET /reports/[id]/export` | `reports.view` / `reports.manage` / `reports.unlock` | Close freezes per-entry values and locks the entries; unlock requires a reason. Export never locks. |
| `GET /my-work` | `view` | Screen 1 aggregate; always the caller's own, no `staffMemberId` parameter exists. |
| `POST /access-requests` | `view` | Raises a notification instead of disclosing that a project exists. |
| `GET/PUT /settings` | `view` / `settings.manage` | Tenant-global (§10). Response groups: `rounding`, `defaults`, `targets`, `warnings`, `access`. |
| `GET /settings/rounding-impact` | `settings.manage` | Projects a candidate rounding rule over a recent window (default 90 days). Locked entries are excluded from the projection and counted separately. |
| `POST /settings/reapply-rounding` | `settings.manage` | Enqueues the retro-rounding `ProgressJob`; `202` with `progressJobId`, or `200` with a null id when nothing is eligible. **Never touches a locked entry.** |

Retro-rounding runs as worker `staff:timesheets-reapply-rounding` on queue `staff-time-reapply-rounding` (`workers/timesheets-reapply-rounding.ts`), driving the `staff.timesheets.time_entries.reapply_rounding` command in batches with `bulkImport.skipEvents`/`skipNotifications` so a tenant-wide restatement refreshes the query index without emitting an event per entry. That command is reachable only by a system actor or a super-admin.

### ACL feature IDs (BC surface #10 — FROZEN)

The following feature IDs are stored in role configurations and MUST NOT be renamed or removed:

- `staff.my_availability.manage`
- `staff.my_availability.unavailability`
- Time tracking: `staff.timesheets.view`, `staff.timesheets.manage_own`, `staff.timesheets.manage_all`, `staff.timesheets.projects.view`, `staff.timesheets.projects.manage`, `staff.timesheets.approve`, `staff.timesheets.lock`, `staff.timesheets.tasks.view`, `staff.timesheets.tasks.manage`, `staff.timesheets.reports.view`, `staff.timesheets.reports.manage`, `staff.timesheets.reports.unlock`, `staff.timesheets.settings.manage`, `staff.timesheets.rates.view`
- Other `staff.*` features declared in [`acl.ts`](./acl.ts)

Money is gated on `staff.timesheets.rates.view` and is **absent** from payloads for anyone else, not blanked — never re-add a rate or cost field to a response for a caller without it.

### Time-tracking mutation-guard `resourceKind` taxonomy (BC surface #2 — STABLE)

Every hand-rolled `/api/staff/timesheets/*` write route runs the same guard set as
`makeCrudRoute` (`api/guards.ts` → `runStaffMutationGuards`, which collects
`getAllMutationGuardInstances()` plus the bridged legacy DI service). It resolves the
caller's granted features itself, through `resolveFeatureAccess` — **do not pass a
grant list**. `runMutationGuards` drops any guard whose declared `features` the caller
does not hold, so supplying an empty list silently disables every feature-gated guard;
the deprecated `resolveUserFeatures(auth)` did exactly that, because `AuthContext` has
no `features` field. The
`resourceKind` a guard matches on is published as
`STAFF_TIME_TRACKING_RESOURCE_KINDS` in [`api/guards.ts`](./api/guards.ts) — import it
rather than re-typing a string:

| Key | `resourceKind` | Routes |
|-----|----------------|--------|
| `timeEntry` | `staff.timesheets.time_entry` | `time-entries/{bulk,copy-day,start-timer}`, `time-entries/[id]/{duplicate,timer-start,timer-stop}` |
| `timeEntrySegment` | `staff.timesheets.time_entry_segment` | `time-entries/[id]/segments`, `time-entries/[id]/segments/[segmentId]` |
| `timeTask` | `staff.timesheets.time_task` | `tasks/[id]/status` |
| `timeTaskComment` | `staff.timesheets.task_comment` | `tasks/[id]/comments` |
| `timeProject` | `staff.timesheets.time_project` | `time-projects/[id]/change-currency` |
| `timeProjectMember` | `staff.timesheets.time_project_member` | `my-projects/[projectId]` |
| `timeReport` | `staff.timesheets.time_report` | `reports/[id]/close`, `reports/[id]/unlock` |
| `entryTag` | `staff.timesheets.entry_tag` | `tags/entry-assignments` |
| `taskTag` | `staff.timesheets.task_tag` | `tags/task-assignments` |
| `settings` | `staff.timesheets.settings` | `settings`, `settings/reapply-rounding` |
| `accessRequest` | `staff.timesheets.access_request` | `access-requests` |

These are the **guard** resource kinds. The eight `makeCrudRoute` time-tracking
resources derive their own tag from the `events` config the factory reads
(`resolveResourceAliasesList`), so a guard targeting a factory route matches that
derived tag instead — for example `staff.timesheets.time.entry` for
`/api/staff/timesheets/time-entries`. `packages/core/src/modules/staff/__tests__/time-tracking-write-path-contracts.test.ts`
fails if a route re-types a literal or an entry above stops being used.

### Time-tracking API interceptors (BC surface #7 — STABLE)

Every hand-rolled `/api/staff/timesheets/*` route runs the same `before` and `after`
API interceptor passes the CRUD factory runs, through
[`api/timesheets/_shared/withTimesheetInterceptors.ts`](./api/timesheets/_shared/withTimesheetInterceptors.ts).

- `targetRoute` is the pathname **without** the `/api/` prefix — `staff/timesheets/time-entries/bulk`,
  `staff/timesheets/my-work` — matching `normalizeInterceptorRoutePath` in the factory.
- A route with a dynamic segment carries the **concrete id** in that path, so target it
  with the registry's prefix wildcard: `staff/timesheets/time-entries/*`, never a literal
  containing `[id]`.
- The before pass can rewrite the body (mutations) or the query (read aggregates) and can
  deny with its own status; the after pass shapes the JSON body. `reports/[id]/export`
  answers with bytes, so its after pass shapes a **descriptor** instead —
  `filename` and `contentType` are read back and applied to the download headers.
- The interceptor context always carries `tenantId` + `organizationId` and fails closed
  with `400` when either is missing. `/settings` and `/settings/reapply-rounding` are
  tenant-global and opt in with `tenantGlobal: true`.

`__tests__/time-tracking-write-path-contracts.test.ts` fails if one of the routes drops
the wiring.

### Time-tracking response enricher hosts (BC surface #2 — STABLE)

Declared in [`data/enrichers.ts`](./data/enrichers.ts). Register your own enricher against
the same `targetEntity` and it composes with these rather than replacing them.

| `targetEntity` | Enricher id | Adds |
|-----|-----|-----|
| `staff:staff_time_project` | `staff.timesheets-projects-portfolio` | `_staff`: hours trend, financials, member preview, customer name |
| `staff:staff_time_task` | `staff.timesheets-tasks-rollup` | `ownMinutes`, `loggedMinutes`, `childCount`, `doneChildCount` (top level, by spec) |
| `staff:staff_time_task` | `staff.timesheets-tasks-tags` | `tagIds`, `tags` |
| `staff:staff_time_task` | `staff.timesheets-tasks-context` | `_staff`: project name/code/colour, status, assignee |
| `staff:staff_time_entry` | `staff.timesheets-time-entries` | `description` alias, `roundedMinutes`, `isLocked`, `lockedReportId`, `tags`, plus `cost`/`currencyCode` |
| `staff:staff_time_report` | `staff.timesheets-reports` | `_staff`: freeze state, frozen entry count, export history, totals |

Money (`hourlyRate`, `cost`, `currencyCode`, `totalAmount`) is **added** for a holder of
`staff.timesheets.rates.view` and absent for everyone else — never blanked.

Each of the six is also published under a `<id>.query-engine` alias whose `targetEntity`
is the **dot** form (`staff.staff_time_entry`) with `queryEngine: { enabled: true }`. The
CRUD factory looks an enricher up by the colon form a route declares; the query engine
looks it up by `entityIdToEventEntity(entity)`, which is the dot form — so an enricher
published only under the colon form never runs in a query pipeline. The two lookups never
both match, so nothing runs twice.

### Time-tracking events: browser and webhooks (BC surface #5 — FROZEN ids)

- **Browser.** `clientBroadcast: true` is set on `time_entry.{created,updated,deleted,timer_started,timer_stopped}`,
  `time_report.{closed,unlocked}`, `time_project.budget_threshold_reached` and
  `time_task.status_changed`. The DOM Event Bridge filters only by tenant + organization —
  **no feature check** — so a broadcast payload MUST NOT carry a rate, a cost or an amount.
  `time_report.closed` therefore carries minute totals but no `totalAmount`, and
  `time_project.budget_threshold_reached` carries `budgetValue`/`usedValue` only for an
  `hours` budget. **Money is not the only thing that audience rules out.** A broadcast
  payload also carries no operator free text and no customer identity:
  `time_report.unlocked` omits its mandatory `reason` (2000 characters of prose about a
  client's billing, kept on the `StaffTimeReportEvent` audit row instead) and
  `time_report.closed` omits `customerId`. `reference` and the minute totals stay —
  stable identifiers and non-money aggregates the published webhook contract and the
  live reports screen both need, and the DOM bridge can narrow an audience only by user
  or role id, which this module deliberately does not gate on.
  `__tests__/timeTrackingEventPayloads.test.ts` fails if a forbidden field reappears.
- **Webhooks.** There is no per-event registration: `packages/webhooks` subscribes with
  `event: '*'` and matches each id against a webhook's subscribed patterns, so declaring
  the event in `events.ts` IS its registration. Delivery needs `tenantId` in the payload —
  the dispatcher drops anything without one. The payload contract every subscriber codes
  against is [`events.payloads.ts`](./events.payloads.ts); `__tests__/timeTrackingEventPayloads.test.ts`
  fails if a declared `staff.timesheets.*` id has no schema or a schema without `tenantId`.

### Customer-portal time reports (EP-50 — BC surface #7, STABLE)

| Route / page | Guard | Notes |
|---|---|---|
| `GET /api/staff/portal/time-reports` | portal session + `portal.time_reports.view` | Closed reports of the signed-in customer only |
| `GET /api/staff/portal/time-reports/{id}` | same | A report of another customer answers `404`, never `403` |
| `/{orgSlug}/portal/time-reports` | `requireCustomerAuth` + `requireCustomerFeatures: ['portal.time_reports.view']` | Listed in the portal sidebar (`nav.group: 'main'`) |
| `/{orgSlug}/portal/time-reports/{id}` | same | Hosts `portal:staff.time_report:{before,after}` |

**The ownership check is four predicates in one WHERE clause, and all four come
from the session:**

```
tenant_id       = auth.tenantId
organization_id = auth.orgId
customer_id     = auth.customerEntityId     -- customer_users.customer_entity_id
status          = 'closed' AND deleted_at IS NULL
```

`customerEntityId` is the FK into `customers:customer_entity`, the same id
`staff_time_reports.customer_id` holds (the link EP-44 declares). A portal session
without one is refused with `403` rather than shown an unscoped list. The detail
route loads the row **with** the predicates rather than loading it and checking
afterwards, so a foreign id is never read even momentarily. The clause is written
once, in [`lib/time-tracking/portalReports.ts`](./lib/time-tracking/portalReports.ts),
and pinned by `api/portal/time-reports/__tests__/route.test.ts`.

**Money is structurally absent on this surface, not conditionally hidden.**
`staff.timesheets.rates.view` is a *staff* feature graded by `rbacService`; a
portal identity is graded by `CustomerRbacService` against the disjoint `portal.*`
namespace and can never hold it. So the portal response schemas carry no rate,
cost, amount or currency field at all — the SQL does not select
`frozen_rate_amount` or `frozen_amount`, and a test fails if a money-shaped key
appears in a response body.

`portal.time_reports.view` is granted to the `buyer` and `viewer` customer roles
through `setup.defaultCustomerRoleFeatures`. It is deliberately **not** in
[`acl.ts`](./acl.ts) — that file is the staff feature catalog.

**Staff takes no static dependency on `customer_accounts`.** The routes resolve
the portal identity with a dynamic `import()` and answer `401` if it fails, and
`lib/time-tracking/portalRecipients.ts` reads `customer_users` by table name
through Kysely rather than importing an entity. `requires` in
[`index.ts`](./index.ts) is unchanged.

### The portal event mirror (EP-06 — BC surface #5, FROZEN id)

`staff.timesheets.time_report.portal_published` is `portalBroadcast: true` and
`excludeFromTriggers: true`. `time_report.closed` and `.exported` are **not**
portal-broadcast, and that is a security decision rather than an omission: the
portal SSE stream (`customer_accounts/api/portal/events/stream.ts`) filters a
broadcast by tenant + organization and narrows to named people only when the
payload carries `recipientUserIds`. One organization serves many customers, so
flagging `time_report.closed` — which carries `reference` and the minute totals —
would give every client a feed of every other client's reports.
That event is also `clientBroadcast: true` with a published webhook payload, so it
cannot be narrowed without breaking its backoffice consumers.

[`subscribers/time-report-portal-broadcast.ts`](./subscribers/time-report-portal-broadcast.ts)
is the only emitter. It resolves the portal users of the report's own customer and
**does not emit at all** when that list is empty — the same rule
`warranty_claims/AGENTS.md` states for its portal event. The payload carries the
reference and the period; no money, because SSE applies no feature check.
Subscribe on the portal with `usePortalAppEvent`.

### Time-tracking sync lifecycle subscribers (BC surface #5 — STABLE)

The seven `makeCrudRoute` time-tracking resources declare an `events:` config, which is
the only thing `deriveLifecycleEventIds` (`shared/lib/crud/factory.ts`) needs to resolve —
so `runSyncBeforeEvent` / `runSyncAfterEvent` dispatch on every create, update and delete
they serve. A sync subscriber runs **inside** the write pipeline: it can veto the write
before the command executes, and rewrite the payload the command receives.

The ids are `<events.module>.<events.entity>.<phase>`, with phases `creating|created`,
`updating|updated`, `deleting|deleted` (`LIFECYCLE_ACTION_MAP`, `factory.ts:631`):

| Route | Entity | `before` phases | `after` phases |
|-------|--------|-----------------|----------------|
| `/time-entries` | `staff.timesheets.time_entry` | `.creating` `.updating` `.deleting` | `.created` `.updated` `.deleted` |
| `/time-projects` | `staff.timesheets.time_project` | same three | same three |
| `/time-projects/[id]/employees` | `staff.timesheets.time_project_member` | same three | same three |
| `/tasks` | `staff.timesheets.time_task` | same three | same three |
| `/task-statuses` | `staff.timesheets.time_task_status` | same three | same three |
| `/tags` | `staff.timesheets.time_tag` | same three | same three |
| `/reports` | `staff.timesheets.time_report` | same three | same three |

`/tasks/[id]/comments` declares no `events:` config and therefore dispatches no sync
lifecycle event. `__tests__/time-tracking-write-path-contracts.test.ts` derives this table
from the `events` configs and fails if the two disagree.

**Declaring one.** A subscriber file under `subscribers/` exporting
`metadata = { event, sync: true, priority?, id? }` plus a default handler. `event` accepts
the wildcards `matchWildcardPattern` supports, so `staff.timesheets.*.creating` covers the
whole family. `priority` sorts **ascending** and defaults to `50` — a lower number runs
earlier, and an earlier subscriber's `modifiedPayload` is visible to the next one.

**What a handler may return** (`SyncCrudEventResult`):

- `undefined` — allow, change nothing.
- `{ ok: false, status?, message?, body? }` — **veto**. The route answers with that status
  (default `422`, body defaults to `{ error: message, subscriberId }`) and the command
  never runs. Before-phase only.
- `{ modifiedPayload }` — shallow-merged into the mutation payload.

**Four things the types do not tell you.**

1. On these routes the payload is the **mapped command input**, not the request body:
   `mapInput` (`parseScopedCommandInput`) has already run, so field names are the
   validator's camelCase, dates are coerced, and `tenantId` / `organizationId` are present.
2. `modifiedPayload` is merged into that input and handed straight to the command — it is
   **not** re-validated against the create/update schema. A subscriber can therefore write
   a field the schema would have rejected; validate your own contribution.
3. The **delete** phase is narrower: its payload carries no mutation data at all
   (`payload` is `undefined`) and a `modifiedPayload` is ignored. Delete subscribers can
   veto, not rewrite.
4. The `after` ids are the same strings as the async CRUD events in `events.ts`, and
   bootstrap registers a `sync: true` subscriber in **both** registries
   (`bootstrap.ts` → `registerModuleSubscribers` and `registerSyncSubscribers`), so an
   after-phase handler is invoked twice: once in-pipeline, once from the event bus. Put
   in-pipeline work on the `before` phase and plain reactions on an ordinary async
   subscriber. The `before` ids are never emitted on the bus and need no `events.ts` entry.

Proved end to end in `__tests__/time-tracking-sync-subscribers.test.ts`.

## Host extension points

Declared in [`extension-points.ts`](./extension-points.ts) and emitted into the generated
extension-point catalog and module-facts by `yarn generate` + the CLI build. Every id below
is a **FROZEN** contract surface (BC surface #6): a third-party widget names it verbatim, so
renaming one silently unbinds every contribution aimed at it. `__tests__/timeTrackingExtensionHosts.test.ts`
pins the whole list, verifies each declaration's `source` file exists and references
`extensionPoints.hosts.<key>` (an unreferenced declaration is emitted as an
`unbound-declaration` diagnostic, not a usable host).

**Two id conventions meet here and neither is negotiable.** `crud-form:` hosts carry the
**dot** form of the entity id (`staff.staff_time_project`) because `CrudForm` derives its
own spot id from `entityIds` by replacing every colon with a dot — the colon form would
name a spot no widget is ever loaded for. `detail:` hosts carry the **colon** form
(`detail:staff:staff_time_task:header`); nothing derives those, the host picks them.

### DataTable hosts

| Table id | Screen |
|---|---|
| `staff.time_entries.list` | `backend/staff/time-tracking/entries/page.tsx` |
| `staff.time_projects.list` | `backend/staff/time-tracking/projects/page.tsx` |
| `staff.time_reports.list` | `backend/staff/time-tracking/reports/page.tsx` |

Each derives the nine standard surfaces — `data-table:<id>:{columns,row-actions,bulk-actions,filters,toolbar,search-trailing,header,footer,empty-state}`.

### CrudForm hosts

| Spot id | Host |
|---|---|
| `crud-form:staff.staff_time_project` | `backend/staff/time-tracking/projects/{create,[id]/edit}/page.tsx` (real `CrudForm`) |
| `crud-form:staff.staff_time_entry` | `lib/time-tracking-ui/TimeEntryDialog.tsx` (hand-rolled host) |
| `crud-form:staff.staff_time_task` | `lib/time-tracking-ui/NewTaskDialog.tsx` (hand-rolled host) |
| `crud-form:staff.staff_time_report` | `backend/staff/time-tracking/reports/create/page.tsx` (hand-rolled host) |

Each carries the standard child spots (`:before-fields`, `:fields`, `:after-fields`,
`:footer`, `:group:<groupId>`, `:field:<fieldId>:{before,after}`, …).

The project form's group ids are a published contract — `PROJECT_FORM_GROUP_IDS` in
[`backend/staff/time-tracking/projects/projectFormConfig.ts`](./backend/staff/time-tracking/projects/projectFormConfig.ts):
`basics`, `billing`, `budget`, `status`, `team`, `rounding`, `details` (a `compact` host
renders `basics` + `billing` only). Address one with `CrudFormInjectionSpots.group(...)`.

The three hand-rolled hosts are not `CrudForm`s; they replay its contract by hand. What
they support and what they do not:

| Lifecycle | TimeEntryDialog | NewTaskDialog | Report create |
|---|---|---|---|
| `onFieldChange` (value + `sideEffects` + messages written back) | yes | no | no |
| `onBeforeSave` (`ok: false` blocks the write, `message` is flashed, `fieldErrors` map onto the task/duration fields, `requestHeaders` are merged into the request **under** the optimistic-lock header) | yes | `ok`/`message` only | no |
| `onAfterSave` | yes | yes | no |
| `transformFormData` / delete lifecycle | no | no | no |

Pinned by `lib/time-tracking-ui/__tests__/TimeEntryDialog.test.tsx` →
"crud-form host lifecycle".

### Injection spots

| Spot id | Host | Context |
|---|---|---|
| `portal:staff.time_report:{before,after}` | `frontend/[orgSlug]/portal/time-reports/[id]/page.tsx` | `{ orgSlug, reportId, reference, periodFrom, periodTo, resolvedFeatures }` — a **customer** session, never a staff one, and no money |
| `detail:staff:staff_time_project:{header,status-badges,tabs,sidebar,footer}` | `backend/staff/time-tracking/projects/[id]/page.tsx` | `{ entityId, recordId, projectId, path, retryLastMutation }` |
| `detail:staff:staff_time_task:{header,status-badges,tabs,sidebar,footer}` | `lib/time-tracking-ui/TaskDrawer.tsx` | `{ entityId, recordId, taskId, timeProjectId, retryLastMutation }` |
| `detail:staff:staff_time_report:{header,status-badges,footer}` | `backend/staff/time-tracking/reports/[id]/page.tsx` | `{ entityId, recordId, reportId, reference, isClosed, periodFrom, periodTo, retryLastMutation }` |
| `staff.time_report.sheet:{before-lines,after-totals}` | `lib/time-tracking-ui/ReportSheet.tsx` | `{ entityId, recordId, reportId, reference, periodLabel, currencyCode }` |
| `staff.timesheet:toolbar` | `backend/staff/time-tracking/timesheet/page.tsx` | `{ staffMemberId, periodKind, periodFrom, periodTo, view, readOnly, retryLastMutation }` |
| `staff.timesheet:period-footer` | `lib/time-tracking-ui/TimesheetPeriodFooter.tsx` | `{ workingDays, dailyHours }` |
| `staff.timesheet:day-cell-actions` | `lib/time-tracking-ui/TimesheetCalendar.tsx` | `{ date, isToday, isWeekend, totalMinutes }` |
| `staff.time_task.board:toolbar` | `lib/time-tracking-ui/KanbanBoard.tsx` | `{ timeProjectId, projectName, statusIds }` |
| `staff.time_task.board:column-header` | `lib/time-tracking-ui/KanbanColumn.tsx` | `{ statusId, statusName, isDone, total, loggedMinutes }` |
| `staff.time_task.board:{card-badges,card-footer}` | `lib/time-tracking-ui/KanbanCard.tsx` | `{ entityId, recordId, taskId, timeProjectId, taskStatusId, timerRunning }` |
| `staff.my_work:{before-sections,after-sections}` | `backend/staff/time-tracking/page.tsx` | `{ staffMemberId, today, projectIds, retryLastMutation }` |
| `staff.time_tracking.settings:sections` | `backend/staff/time-tracking/settings/page.tsx` | `{ moduleId, canManage }` |
| `staff.timesheets.timer-bar:actions` | `lib/timesheets-ui/TimerBar.tsx` | `{ staffMemberId, retryLastMutation }` |

No context carries a rate, cost or amount; contributions that need money must ask for it
behind `staff.timesheets.rates.view` themselves. An empty spot renders nothing and changes
no DOM — pinned by `__tests__/timeTrackingInjectionSpots.test.ts`.

**Tabs.** `detail:staff:staff_time_project:tabs` is a real tab host: a widget mapped to it
with `placement: { kind: 'tab', groupId, groupLabel, priority }` gets its own
`TabsTrigger` and its own `TabsContent` in the page's `<Tabs>` (higher `priority` first,
`metadata.title` as the label fallback). `detail:staff:staff_time_task:tabs` is **not** —
the task drawer is a single-column stack with no tab strip, so the spot renders a
contributed widget as an additional panel at the end of the drawer body.

**Server-side "my work" sections (deferred).** `staff.my_work:{before,after}-sections` are
client render spots only. The spec's server-side section-contribution contract — a module
adding its own section to `api/timesheets/my-work/myWorkAggregate.ts` — is **not**
implemented: the aggregate returns one closed, zod-validated shape that the page's KPI
strip, quick-entry targets and totals all read positionally, so a contributed section
needs its own registry, its own per-section scoping and its own response slot before it can
be added without loosening that contract. A client spot fetching its own data covers the
same use case today.

### Replaceable components

`replace` / `wrapper` / `props` targets, registered by each component's own module through
`registerComponent` and resolved with `useRegisteredComponent`. Every one publishes a zod
`propsSchema`, which `useRegisteredComponent` parses in development — a replacement that
does not satisfy it falls back to the original component. Catalogued in
[`widgets/components.ts`](./widgets/components.ts).

| Handle | Component |
|---|---|
| `staff.time_entry_dialog` | `lib/time-tracking-ui/TimeEntryDialog.tsx` |
| `staff.timer_bar` | `lib/timesheets-ui/TimerBar.tsx` |
| `staff.kanban_card` | `lib/time-tracking-ui/KanbanCard.tsx` |
| `staff.kanban_column` | `lib/time-tracking-ui/KanbanColumn.tsx` |
| `staff.timesheet_grid` | `backend/staff/time-tracking/timesheet/GridView.tsx` |
| `staff.timesheet_list` | `lib/timesheets-ui/ListView.tsx` |
| `staff.timesheet_calendar` | `lib/time-tracking-ui/TimesheetCalendar.tsx` |
| `staff.report_sheet` | `lib/time-tracking-ui/ReportSheet.tsx` |
| `staff.project_card` | `lib/timesheets-projects-ui/ProjectCard.tsx` |
| `staff.entries_summary_footer` | `lib/time-tracking-ui/TimeEntriesSummaryFooter.tsx` |

## Time-tracking strategy registries

EP-32…EP-41. Ten closed pure functions and DB enums are now registries. **Every one
registers the module's existing implementation as its built-in default at module load,
so with no contribution the observable behaviour is the one the module shipped.** The
built-in ids below are the `runtimeContract` of the matching `specialized-registry` host
in [`extension-points.ts`](./extension-points.ts).

| EP | Registry id / host | Register with | Built-in default | Resolution |
|---|---|---|---|---|
| 32 | `staff.time_tracking.rounding` | `registerTimeRoundingStrategy({ id, labelKey, priority?, round(raw, ctx) })` — [`lib/time-tracking/rounding.ts`](./lib/time-tracking/rounding.ts) | `staff.time_tracking.rounding.unit` (`up`/`nearest` × `0\|5\|10\|15`) | single winner |
| 33 | `staff.time_tracking.rate` | `registerTimeRateResolver({ id, priority?, resolve(ctx): number \| null })` — [`lib/time-tracking/cost.ts`](./lib/time-tracking/cost.ts) | `staff.time_tracking.rate.entry_override_then_project` | chain, first non-null |
| 34 | `staff.time_tracking.billability` | `registerBillabilityResolver({ id, priority?, resolve(ctx): boolean \| null })` — [`lib/time-tracking/billability.ts`](./lib/time-tracking/billability.ts) | `staff.time_tracking.billability.project_then_tenant` | chain, first non-null |
| 35 | `staff.time_tracking.report_export_format` | `registerReportExportFormat({ id, labelKey, mimeType, extension, serialize(input) })` — [`lib/timesheets-reports/reportExportFormats.ts`](./lib/timesheets-reports/reportExportFormats.ts) | `pdf`, `csv`, `xlsx` | keyed by id |
| 36 | `staff.time_tracking.report_grouping` | `registerReportGrouping({ id, labelKey, groupOf(entry), labelOf(key, ctx), sort })` — [`lib/timesheets-reports/reportGroupings.ts`](./lib/timesheets-reports/reportGroupings.ts) | `project_task`, `project_person`, `project_day` | keyed by id |
| 37 | `staff.time_tracking.time_entry_source` | `registerTimeEntrySource({ id, labelKey, icon, editable })` — [`lib/time-tracking/timeEntrySources.ts`](./lib/time-tracking/timeEntrySources.ts) | `manual`, `timer`, `kiosk`, `mobile` | keyed by id |
| 38 | `staff.time_tracking.overlap_policy` | `registerOverlapPolicy({ id, priority?, evaluate(spans, ctx) })` — [`lib/time-tracking/overlap.ts`](./lib/time-tracking/overlap.ts) | `staff.time_tracking.overlap.warn_when_enabled` | max severity |
| 39 | `staff.time_tracking.project_code_generator` | `registerProjectCodeGenerator({ id, priority?, generate(name, taken, ctx) })` — [`lib/time-tracking/projectCode.ts`](./lib/time-tracking/projectCode.ts) | `staff.time_tracking.project_code.initials` | single winner |
| 40 | `staff.time_tracking.capacity_provider` | `registerCapacityProvider({ id, priority?, resolve(staffMemberId, dateRange, ctx) })` — [`lib/time-tracking/capacity.ts`](./lib/time-tracking/capacity.ts) | `staff.time_tracking.capacity.flat_daily_hours` | single winner |
| 41 | `staff.time_tracking.report_approval_policy` | `registerReportApprovalPolicy({ id, priority?, canClose?, canUnlock?, onClosed? })` — [`lib/timesheets-reports/reportApprovalPolicies.ts`](./lib/timesheets-reports/reportApprovalPolicies.ts) | `staff.time_tracking.report_approval.acl_only` | conjunction, first refusal |
| 42 | `staff.time_tracking.setting_key` | `registerTimeTrackingSettingKey({ group, key, schema, default, labelKey, priority? })` — [`lib/time-tracking/settingKeys.ts`](./lib/time-tracking/settingKeys.ts) | the eight frozen keys | keyed by `<group>.<key>` |
| 51 | `staff.time_tracking.recalculation` | `registerTimeTrackingRecalculation({ id, labelKey, priority?, run(ctx) })` — [`lib/time-tracking/recalculations.ts`](./lib/time-tracking/recalculations.ts) | `staff.time_tracking.recalculation.rounding` | keyed by id, run in order |

### The four resolution orders

All four order candidates by **descending `priority` (default `0`), ties by registration
order**, and every built-in registers at `BUILT_IN_STRATEGY_PRIORITY` (`-1000`) so it is
always the last candidate. They differ only in what they do with that order:

- **single winner** — the first candidate runs; nothing else is consulted.
- **chain, first non-null** — candidates are asked in order and the first non-`null`
  answer wins. Returning `null` is an abstention, not a "no", so an unopinionated
  contribution cannot change an entry.
- **max severity** (`block` > `warn` > `allow`) — a contributed overlap policy can only
  ESCALATE. Nothing can suppress a warning the tenant asked for.
- **conjunction, first refusal** — every approval policy must agree. `canClose`/`canUnlock`
  return a refusal or nothing, **never a grant**, so no policy can open a door the ACL
  closed. The ACL check in the close/unlock routes runs first and unconditionally.

### A built-in is a separate slot, and a contribution's answer is not trusted

Two rules the registry itself enforces, so a call site cannot get them wrong:

- **`register()` refuses a built-in id and no disposer can remove a built-in.** The
  eleven built-in ids are published above, and the map used to be last-writer-wins:
  registering `{ id: 'staff.time_tracking.rounding.unit', … }` made you the built-in,
  put you on the unscoped path the fail-closed gate exists to keep byte-identical,
  and let your disposer delete the real built-in for the life of the process. Built-ins
  now live in a map `register()` cannot reach (`registerBuiltIn`, module-load only),
  and `selectScopedStrategy` takes the built-in **by reference** rather than looking
  its id up among the candidates.
- **Every strategy invocation is wrapped, and every numeric answer is clamped.**
  `registries/invoke.ts` publishes `runStrategy` (single-winner: fall back to the
  built-in), `tryStrategy` (chain: skip this candidate, ask the next) and
  `clampToStoredMinutes`. `roundMinutes` clamps to `Math.max(0, Math.round(v))` or
  falls back — `rounded_minutes` is an `integer` column and the sole input to cost, and
  the obvious contributed strategy (`Math.floor(raw / ctx.settings.unitMinutes) * …`)
  is `NaN` under the shipped default `unitMinutes: 0`, which stores garbage and then
  bills 0.00 in silence. `CapacityProvider.resolve` and `ProjectCodeGenerator.generate`
  validate their answers the same way. Two deliberate exceptions: a failing export
  `serialize` re-raises as an internal error naming the format (falling back would
  answer with another format's bytes under the requested MIME type), and a throwing
  `canClose`/`canUnlock` becomes a **refusal** — those are gates, and the built-in
  grants, so falling back to it would turn a broken policy into permission.

### Scoping — fail closed to the built-in

EP-42 is the one exception to the paragraph below: settings are tenant-global by spec
§10, so its host declares `scopeContract: 'tenant'` and a contributed key is stored with
`{ tenantId }` and nothing else.

Every resolver context carries `tenantId` + `organizationId`
([`lib/time-tracking/registries/scope.ts`](./lib/time-tracking/registries/scope.ts)). A
**contributed** strategy is consulted only when both are present; with either missing the
built-in is the only candidate. Failing closed lands on the built-in rather than on an
error, because the built-in is the same pure code that ran before the registries existed.

### Client-side call sites

The registries are plain module-scope `Map`s (the `registerPaymentProvider` idiom), not DI
singletons, so the browser bundle reaches them by importing the `register*` function
directly — no container. The DI keys in the table above are the *server* entry point and
exist so an app can replace a resolver through `entry.overrides` DI; resolving one and
calling the module function are equivalent.

Four call sites run in the browser and none of them has a tenant id to hand, so all four
resolve the built-in today, byte-identically to before:
`lib/time-tracking-ui/TimeEntryDialog.tsx` (rate + cost preview),
`lib/time-tracking-ui/timeTrackingSettingsForm.ts` (`buildRoundingExamples`),
`lib/time-tracking-ui/ProjectCodeField.tsx` (`deriveProjectCode`), and
`lib/time-tracking/roundingImpact.ts`. A client host that wants a contribution to apply
must pass the scope explicitly.

### Schema

EP-37 and EP-36 replaced two database enums with registry-backed validation:
`staff_time_entries.source` and `staff_time_reports.grouping` are plain `text` columns
(`Migration20260824143357_staff.ts` drops `staff_time_entries_source_check` and
`staff_time_reports_grouping_check`). The write-side guard moved into
`data/validators.ts`, which asks the registries rather than a literal `z.enum`, and
`normalizeTimeEntrySource` / `normalizeReportGrouping` coerce a stored value whose
contributing module has since been removed back to `manual` / `project_task`.

Pinned by [`lib/time-tracking/__tests__/strategyRegistries.test.ts`](./lib/time-tracking/__tests__/strategyRegistries.test.ts).

## Time-tracking data model and settings

EP-42…EP-45. Four declaration surfaces. Read the "does not" column of each before
building on one — three of the four are contracts that a later phase still has to make
load-bearing, and pretending otherwise is how a third-party module ships a broken screen.

### Contributed settings keys (EP-42 — BC surface #2, STABLE)

`TIME_TRACKING_SETTING_KEYS`, `normalizeTimeTrackingSettings` and
`staffTimeTrackingSettingsSchema` all read
[`lib/time-tracking/settingKeys.ts`](./lib/time-tracking/settingKeys.ts) now. The eight
keys the module shipped are registered there as built-ins, so with no contribution the
defaults, the validating schema, the read and the eight `ModuleConfigService` rows are
what they always were.

```ts
registerTimeTrackingSettingKey({
  group: 'jira',            // top-level group in the settings object
  key: 'projectKey',        // leaf inside it; the config row is named `jira.projectKey`
  schema: z.string().min(1).max(20),
  default: 'OPS',           // must satisfy `schema`, or registration throws
  labelKey: 'jira.settings.projectKey',
  priority: 0,
})
```

- **Storage and scope.** One `ModuleConfigService` row per key under module id
  `staff.time_tracking`, named `<group>.<key>`, written with `{ tenantId }` only.
  A contributed value is therefore **tenant-global**, with `organization_id` null —
  there is no per-organization, per-project or per-customer override, and a contribution
  cannot opt into one. `GET`/`PUT /api/staff/timesheets/settings` carry it in the group
  it declared.
- **Validation.** `buildTimeTrackingSettingsSchema()` composes
  `schema.optional().default(default)` per key and one `.optional().default({...})` per
  group. The settings route builds it **per request**, and publishes it through OpenAPI
  getters, so a key registered after the route module first loaded still validates and
  still appears in the published schema. The exported `staffTimeTrackingSettingsSchema`
  const is the load-time snapshot and stays for backward compatibility.
- **A stored value that no longer validates falls back to the registered default**, the
  same way a stored rounding unit the schema stopped accepting always did. Registering a
  key whose id collides with one of the eight built-ins throws.
- **Rendering it.** Pair the key with a widget on `staff.time_tracking.settings:sections`
  (EP-26). The spot context carries `{ moduleId, canManage, keys, values, setValue }`:
  `keys` is `contributedTimeTrackingSettingKeys()`, `values` is keyed by `<group>.<key>`
  and holds contributed keys only, and `setValue(id, value)` writes into the page draft
  so the page's own Save round-trips a key it knows nothing about. The eight built-ins
  are absent from `values` — the page renders those itself.

### Time-tracking custom fields (EP-43)

[`ce.ts`](./ce.ts) declares `staff_time_entry`, `staff_time_project`, `staff_time_task`,
`staff_time_report` and `staff_time_tag` next to `staff_team_member`, each with
`showInSidebar: false` and no default fields.

**What the declaration does.** All five are *system* entities, so
`entities/lib/install-from-ce.ts` seeds only their `fields` and never writes a
`custom_entities` row — `label`, `description` and `showInSidebar` are metadata for code,
not for the installer. The one runtime behaviour it changes today is `labelField`, read by
`attachments/lib/assignmentDetails.ts` to label an attached record. It also marks the
entity `customFields: true` in the generated module facts.

**What it does NOT do, and what each surface still needs:**

| Surface | State |
|---|---|
| Defining a custom field on these entities | Already worked before EP-43. `entities/api/entities.ts` lists every generated entity id, so the Data designer always offered them. |
| Storing a value through the CRUD routes | **Does not work.** All five `makeCrudRoute` resources are command-backed, and `factory.ts` honours `actions.create.customFields` / `update.customFields` only on its ORM write path (`factory.ts:2403`, `:2741`). A `cf_*` key posted to `/api/staff/timesheets/*` is dropped in silence. Closing it means threading `splitCustomFieldPayload` through each route's `mapInput` and calling `setCustomFieldsIfAny` in the command, the way `commands/team-members.ts` already does. |
| Reading values back on a list | **Does not work.** None of the five declares `list.decorateCustomFields`, so no `customFields` / `customValues` reaches a list item. |
| `CrudForm` rendering the inputs | Works for the project form only — it is the one real `CrudForm` and it passes `entityIds={[E.staff.staff_time_project]}`. Its `onSubmit` builds the body with `buildProjectPayload`, which copies named fields, so the rendered values are dropped before the request. `TimeEntryDialog`, `NewTaskDialog` and the report create page are hand-rolled hosts and render no custom fields at all. |
| Filtering/sorting by a custom field | Not reachable: each list route validates its query with a closed zod schema and builds filters itself, so a `cf:` filter never survives parsing. |

Treat EP-43 as the *declaration* half of custom-field support. Do not tell a customer the
fields are usable end to end until the write path lands.

### Cross-module links (EP-44 — BC surface #2, STABLE)

[`data/extensions.ts`](./data/extensions.ts) declares four links over the foreign-key
columns time tracking already carried:

| Base | Extension | Join |
|---|---|---|
| `customers:customer_entity` | `staff:staff_time_entry` | `id` → `customer_id` |
| `customers:customer_deal` | `staff:staff_time_entry` | `id` → `deal_id` |
| `sales:sales_order` | `staff:staff_time_entry` | `id` → `order_id` |
| `customers:customer_entity` | `staff:staff_time_project` | `id` → `customer_id` |

`base` is the other module's entity, `extension` is the staff entity holding the FK —
the query engine only ever looks a link up by `base`. **These are strings, never
imports.** Staff is slated for extraction into a standalone package, so
`data/extensions.ts` may not import a `customers` or `sales` symbol and
`requires: ['planner', 'resources']` in [`index.ts`](./index.ts) must not grow;
`__tests__/entityExtensions.test.ts` fails if either happens, and pins every table and
column against the migration snapshots.

**Declaration-only, exactly as in `apps/mercato/src/modules/example/data/extensions.ts`.**
Nothing in the platform passes `includeExtensions` to a query, the basic engine's
extension join adds no projection and exposes no filterable or sortable alias, and the
hybrid engine DI registers ignores the flag outside its basic-engine fallback. What the
declaration *is* today is the traversal contract `yarn generate` emits as
`entityExtensions` in the module registry.

The matching catalog entry is not in [`extension-points.ts`](./extension-points.ts) on
purpose: `module-extension-facts.ts` already emits an `entity`-family fact host with the
`entity-extension` capability for every entity a module owns, so a hand-written
declaration would duplicate it and, having no source that references
`extensionPoints.hosts.<key>`, would be emitted as an `unbound-declaration` diagnostic
rather than a usable host.

### Translatable fields (EP-45)

[`translations.ts`](./translations.ts) adds `staff_time_project` (`name`, `description`),
`staff_time_task_status` (`name`) and `staff_time_tag` (`label`). Values are **database
column** names. Only columns that exist are listed — task statuses have no description and
a tag's human-readable column is `label`.

Registration is via the generator: `translations-fields.generated.ts` imports every
module's `translations.ts` and calls `registerTranslatableFields`. The hard-coded list in
`translations/di.ts` covers four core modules and deliberately does not include staff — a
core module importing staff would violate MUST rule 1.

One rendered change: `translations/widgets/injection-table.ts` derives
`crud-form:<module>.<entity>:header` spots from the registry, so the project **edit** form
now shows the translation-manager affordance. It is gated on `translations.view` and on a
record id, so create forms and callers without the feature see nothing. No list or detail
output changes until a tenant actually writes a translation — the overlay substitutes a
value only when a row exists for the request locale.

## Time-tracking search, analytics, notifications and AI

EP-46…EP-49 and EP-51. Four contribution surfaces plus the recalculation hook.

### Search (EP-46) — and the one thing it cannot do

[`search.ts`](./search.ts) indexes all five time-tracking entities. **Read this
before adding a sixth.** An entity's `aclFeatures` is the *only* authorization the
search pipeline applies. It is enforced twice per query — `resolveReadableEntityTypes`
narrows the entity list before the query, `filterSearchResultsByEntityAccess`
filters the results after it — but both decide **per entity type**.
`SearchEntityConfig` has no row-level hook and `SearchOptions` has no record-id
allowlist, so a search gate cannot reproduce the per-project membership
intersection `resolveProjectAccess` applies on every time-tracking route.

So each gate names the feature set whose holder already sees **every** record of
that entity through the API:

| Entity | `aclFeatures` | Why |
|---|---|---|
| `staff:staff_time_project` | `staff.timesheets.projects.view` | Unchanged; the projects list is not membership-narrowed |
| `staff:staff_time_task` | `tasks.view` **+** `projects.manage` | `projects.manage` is what makes `resolveProjectAccess` answer `canManageAll` |
| `staff:staff_time_report` | `reports.view` **+** `projects.manage` | Same; the reports list intersects with project membership otherwise |
| `staff:staff_time_tag` | `staff.timesheets.view` | Tags are organization-global on their own route; exact match |
| `staff:staff_time_entry` | `staff.timesheets.view` **+** `projects.manage` | Entry notes are the most sensitive text the module holds |

A project member without `projects.manage` therefore gets **no** task, report or
entry hits — including for their own records. That is deliberate: the gate cannot
express "own", and half a gate would disclose other clients' work. Money columns
are `fieldPolicy.excluded`, not merely left out of `searchable`. The tag entity
resolves no URL — there is no tag detail screen and the entries list deep-links
only `taskId` and `ids`, so an unlinked hit is more honest than a wrong link.

### Analytics (EP-47)

[`analytics.ts`](./analytics.ts) declares `staff:staff_time_entries`,
`staff:staff_time_tasks`, `staff:staff_time_projects` and `staff:staff_time_reports`.

- **No money column is mapped.** An `AnalyticsEntityConfig` carries one
  `requiredFeatures` list for the whole entity, so there is no shape in which
  `total_amount` or `hourly_rate` is gated on `staff.timesheets.rates.view` while
  the rest stays readable. Minutes carry the same analysis without the disclosure.
- **Custom fields are not dimensions and cannot be made into dimensions.**
  `AnalyticsFieldMapping` is `{ dbColumn, type }` and the aggregation builder emits
  `dbColumn` as a bare identifier against the one `tableName`, so a mapping can only
  ever name a real column on that table. The EP-43 custom fields are EAV rows in the
  `entities` module's tables — no join, and the jsonb-path form needs the values on
  the row itself. The point is moot anyway while the write path drops `cf_*`.
- `is_billable` / `billable_by_default` are typed `text` because
  `AnalyticsFieldType` has no boolean; the type is read only to decide whether a
  group-by column gets a `date_trunc`.

### Notification types and reactive handlers (EP-48)

[`notifications.ts`](./notifications.ts) adds four ids;
[`notifications.handlers.ts`](./notifications.handlers.ts) is the module's browser
reaction to them, one handler per type with a stable override key
(`notifications.handlers.<id>`).

| Type | Raised by |
|---|---|
| `staff.timesheets.time_report.approved` | **Core.** [`subscribers/time-report-approved-notification.ts`](./subscribers/time-report-approved-notification.ts) on `time_report.closed` — closing IS the approval; the recipient is the report's author, never the closer |
| `staff.timesheets.time_report.ready_for_approval` | Contributable only — pairs with a `registerReportApprovalPolicy` (EP-41) that adds a review step. The module has one transition, draft → closed, so core has nothing to announce |
| `staff.timesheets.time_entry.timer_running_long` | Contributable only — needs a scheduled sweep over open timers, which the module does not ship |
| `staff.timesheets.timesheet.period_incomplete` | Contributable only — "incomplete" is the capacity provider's question (EP-40), and the built-in provider has no schedule and no opinion about when to complain |

A contributable-only type is not a dormant id: the renderer, the delivery
preferences and the browser handler are all in place, so a contributed raiser gets
a working notification on day one without patching core.

### AI tool pack and agent (EP-49)

[`ai-tools.ts`](./ai-tools.ts) publishes six tools and
[`ai-agents.ts`](./ai-agents.ts) one agent, `staff.time_tracking_assistant`
(`mutationPolicy: 'confirm-required'`).

| Tool | Kind | Gate | Backing route |
|---|---|---|---|
| `staff.log_time` | mutation | `manage_own` | `POST /staff/timesheets/time-entries` |
| `staff.start_timer` | mutation | `manage_own` | `POST /staff/timesheets/time-entries/start-timer` |
| `staff.stop_timer` | mutation | `manage_own` | `POST /staff/timesheets/time-entries/{id}/timer-stop` |
| `staff.summarize_week` | read | `view` | `GET /staff/timesheets/time-entries` |
| `staff.find_missing_days` | read | `view` | same |
| `staff.draft_client_report` | read | `reports.view` | `POST /staff/timesheets/reports/preview` |

**A module tool never calls `prepareMutation`.** That function is framework code:
its only call site is `agent-tools.ts`, which intercepts the model's call,
short-circuits the handler, persists an `AiPendingAction` and returns the preview
card. A tool opts in by declaring `isMutation: true` plus a `loadBeforeRecord`
resolver that renders the diff; the handler runs later, once, from the confirm
route, with the stored input. Calling `prepareMutation` from a tool would be
calling the interceptor from inside the thing it intercepts.

Every tool is API-backed through `createAiApiOperationRunner`, which refuses a
route whose `requiredFeatures` the tool does not itself declare. The gate is
therefore checked twice, and the route still applies the project-access
intersection, the mutation guards, the interceptors and the commands. Nothing in
the pack writes a time entry itself. The tools act as the caller's own staff member
and none accepts a `staffMemberId`. `staff.draft_client_report` asks for a preview
with `showRates: false` and projects only minute columns, so an agent transcript
never becomes a second, ungated copy of a customer's rate card.

### Recalculation hooks and the CLI (EP-51)

```ts
registerTimeTrackingRecalculation({
  id: 'billing.recalculate_rates',
  labelKey: 'billing.recalculations.rates',
  async run({ container, scope, report }) {
    await report.setTotal(total)
    // …batch, then `await report.advance(n)` and check `report.isCancellationRequested()`
    return { totalCount, processedCount, updatedCount, unchangedCount, skippedCount, cancelled }
  },
})
```

- A hook does **not** own the `ProgressJob`. `runTimeTrackingRecalculations`
  ([`lib/time-tracking/recalculationRunner.ts`](./lib/time-tracking/recalculationRunner.ts))
  owns start / totals / cancel / complete, so several hooks share one progress bar;
  marking a job failed is the worker's job. Hooks run **sequentially** in registry
  order — they write the same rows.
- `run` must carry `scope.tenantId` into every query, honour `organizationIds` when
  it is not `null`, and never touch an entry locked into a closed report.
- **A job with no `hookIds` runs the built-in rounding pass alone.** That is what
  `POST /api/staff/timesheets/settings/reapply-rounding` enqueues, so a contributed
  hook cannot attach itself to the retro-rounding button a tenant pressed. An
  explicit list comes only from the CLI.

```bash
yarn mercato staff timesheets:recalculate --list
yarn mercato staff timesheets:recalculate --tenant <id> [--org <id>] [--hook <id>[,<id>]]
```

The CLI enqueues onto the same queue with the same `ProgressJob` the settings
screen uses; it does not do the work in process. An unknown `--hook` id refuses to
start rather than silently doing nothing.

## Internal-Only Surfaces (NOT public contract)

These are subject to change without deprecation; do not import them from non-staff code:

- Entity classes in [`data/entities.ts`](./data/entities.ts) (`StaffTeam`, `StaffTeamMember`, `StaffTeamRole`, etc.)
- Lib helpers in [`lib/`](./lib/) — internal utilities consumed by staff routes/commands
- Migration files under [`migrations/`](./migrations/)
- Backend pages, widgets, and notifications

If you need data from staff in another core module, the correct path is:
1. Add a new DI-registered service in `di.ts` exposing the narrow contract you need
2. Document it in the table above as a public surface
3. Apply the BC deprecation protocol before changing it later

## Dependencies

Staff currently declares `requires: ['planner', 'resources']` in [`index.ts`](./index.ts). The dependency direction is intentional and asymmetric:

- Staff depends on planner + resources (hard requirement at load time).
- Planner soft-resolves `availabilityAccessResolver` via DI with `allowUnregistered: true` (graceful degradation when staff is absent).

This asymmetry will be reconciled in the Phase 2/3 follow-up when staff becomes its own npm package; for now, planner is the only consumer that must work without staff registered.

## When You Need an Import

| Topic | Where |
|-------|-------|
| DI registrar pattern | [`di.ts`](./di.ts) — call `register(container)` from bootstrap; never call directly from another module |
| Availability access types | `import type { AvailabilityWriteAccess, AvailabilityAccessContext } from '@open-mercato/core/modules/planner/api/access'` (planner re-exports the same shape it consumes; do not import from staff directly) |
| Anything else | Go through a public API route — never import entity classes |
