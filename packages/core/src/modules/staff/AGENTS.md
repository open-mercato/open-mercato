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
`getAllMutationGuardInstances()` plus the bridged legacy DI service). The
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
