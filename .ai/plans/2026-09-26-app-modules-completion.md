# App module completion: transport / fleet / HR

Three sibling app modules landed in one commit (`c368715c0`, "feat(app): add the
fleet, HR and transport operations modules"), but only one of them was finished.
This plan tracks bringing the other two to the same standard.

Reference implementation: **`apps/mercato/src/modules/transport_operations`** — the
pattern to copy for every file below (service in `lib/`, CRUD factory in
`commands/crud.ts`, per-entity registration in `commands/<module>.ts`, action
commands for cross-entity state, `makeCrudRoute` + `api/openapi.ts`, `setup.ts`,
i18n in six locales).

## Status

| Module | Entities | lib | commands | api | setup | i18n | State |
|---|---|---|---|---|---|---|---|
| `transport_operations` | 4 | ✅ | ✅ | ✅ 7 routes | ✅ | ✅ 6 locales | complete |
| `fleet_management` | 4 | ✅ | ✅ | ✅ 6 routes | ✅ | ✅ 6 locales | **completed 2026-09-26** |
| `hr_management` | 10 | ❌ | ❌ | ❌ | ❌ | ❌ | skeleton (entities, validators, migration, DI only) |

## fleet_management — completed 2026-09-26

`lib/errors.ts`, `lib/fleetService.ts` (assignability + returnability rules, dashboard
counters), `commands/crud.ts`, `commands/fleet.ts` (vehicles, vehicle documents,
assignments, odometer logs with events + indexers), `commands/assignments.ts`
(`assignments.handover`, `assignments.return` — one transaction each, pessimistic
locks, side effects for every entity touched, and an `assignment_return` odometer log),
`api/{openapi,vehicles,assignments,assignments/handover,assignments/return,odometer-logs,dashboard-summary}`,
`setup.ts`, `i18n/*` (ar translated; de/es/ko/pl mirror English as the sibling does).

Deliberate follow-ups:

1. **Vehicle documents have no HTTP route yet.** Their CRUD commands are registered in
   `commands/fleet.ts`, so the surface is one `api/vehicle-documents/route.ts` away —
   copy `api/odometer-logs/route.ts` and swap the entity, schemas and fields.
2. **Assignment approval is reserved, not wired.** `FleetVehicleAssignment.approvalRequestId`
   is nullable and unused; `assignments.handover` creates the custody as `active`
   directly. Wiring it to the HR approvals engine means creating an
   `HrApprovalRequest` instead and letting an approve action call the handover —
   which only becomes possible once `hr_management` is finished (below).
3. **No backend UI.** Neither this module nor `transport_operations` ships `backend/`
   pages; both are API-complete and UI-less by design so far.

## hr_management — remaining work

10 entities (`HrDepartment`, `HrEmployee`, `HrDriverProfile`, `HrAttendanceRecord`,
`HrLeaveRequest`, `HrEmployeeDocument`, `HrApprovalWorkflow`,
`HrApprovalStepDefinition`, `HrApprovalRequest`, `HrApprovalActionLog`) with 19 zod
schemas already written in `data/validators.ts`.

## hr_management — progress 2026-09-26

**Backbone landed** (verify with the narrow project: `cd apps/mercato; npx tsc -p
.mercato/tsconfig-fleet.json`, which now includes both app modules):

- `lib/errors.ts` — `raiseHrError` / `hrMessage`.
- `lib/hrService.ts` — `assertEmployeeWritable` (department exists, termination not
  before hire), `assertAttendanceRecordable` (one record per employee per UTC day),
  `assertLeaveRequestBookable` (range order, no overlap with pending/approved leave),
  and `getHrDashboardSummary` (headcount, on leave, departments, pending leave,
  pending approvals, documents expiring inside 30 days).
- `commands/crud.ts` — the CRUD factory, copied from the fleet module.
- `commands/hr.ts` — events/indexers for all ten entities and CRUD registration for
  **departments** and **employees** (with the hire/termination/ID-expiry date
  coercions and the employee rule wired into `beforeCreate`).
- `di.ts` — `hrService` registered beside the entities.

**Remaining in this module** — the same shape as the fleet slice:

1. `commands/hr.ts` — register the six entities whose schemas are already mapped but
   which have no commands yet: driver profiles (license/medical expiry), attendance
   (recordedAt pair, one-per-day rule in `beforeCreate`), leave requests
   (`beforeCreate` → `assertLeaveRequestBookable`), employee documents (issue/expiry),
   approval workflows, approval step definitions.
2. `commands/approvals.ts` — the engine: `submit` (create request + first action log),
   `approve`, `reject`, `reassign`, `cancel`, each advancing `currentStepOrder` inside
   one transaction with pessimistic locks and emitting side effects for the request
   *and* the entity it approves (e.g. flipping the leave request to `approved`).
   Register the `HrApprovalRequest` / `HrApprovalActionLog` CRUD too.
3. `api/` — `openapi.ts`, one `makeCrudRoute` per entity, the five approval action
   routes (copy `fleet_management/api/assignments/handover/route.ts`), and
   `dashboard-summary`. Features: `hr.read` / `hr.write` / `hr.admin` /
   `hr.documents.manage` for CRUD, `approvals.action` / `approvals.config` for the
   engine.
4. `setup.ts` (default role features) and `i18n/` in six locales — the `hr_management.errors.*`
   keys the service raises (`department_not_found`, `employee_not_found`,
   `termination_before_hire`, `attendance_already_recorded`, `leave_overlap`,
   `invalid_leave_range`) are the minimum set to start from.

Once step 2 exists, `fleet_management`'s reserved `approvalRequestId` can be wired to
it so a custody handover can require approval instead of starting as `active`.

1. `lib/errors.ts` — `raiseHrError` / `hrMessage`, same shape as the fleet module.
2. `lib/hrService.ts` — the rules that must not live in a route: an employee cannot
   report to itself, attendance cannot exceed one record per employee per day, a leave
   request cannot overlap an approved one and cannot exceed the balance for its type,
   and the approval engine's step progression (next step order, terminal states).
3. `commands/crud.ts` — copy `fleet_management/commands/crud.ts`, swap the prefix.
4. `commands/hr.ts` — register the nine simple entities (departments, employees,
   driver profiles, attendance, leave requests, employee documents, workflows, step
   definitions, action logs).
5. `commands/approvals.ts` — the cross-entity actions: submit a request (create
   `HrApprovalRequest` + first `HrApprovalActionLog`), approve, reject, reassign and
   cancel, each advancing `currentStepOrder` inside one transaction and emitting side
   effects for the request **and** the entity it approves (e.g. the leave request).
6. `api/` — one `makeCrudRoute` per simple entity, plus
   `api/approval-requests/{submit,approve,reject,reassign,cancel}/route.ts` copying
   `fleet_management/api/assignments/handover/route.ts`, and a `dashboard-summary`
   route (headcount, open leave requests, pending approvals, expiring documents).
7. `setup.ts` — `hr.*` and `approvals.*` default role features (the ACL features
   already exist in `acl.ts`).
8. `i18n/` — six locales, Arabic translated; keep the key set identical so
   `yarn i18n:check-sync` stays green.

Validation for either module: `yarn generate` (route discovery), the app typecheck
(`cd apps/mercato; node --max-old-space-size=6144 ../../node_modules/typescript/bin/tsc
--noEmit` — the default heap runs out of memory), `yarn i18n:check-sync`,
`yarn template:sync` (app modules mirror into the create-app template).

## 2026-09-27 — HR screens finished, and two silent defects closed

**Screens.** Departments (`/backend/hr/departments`, list/create/edit, ancestor-cycle guard in the
form and in `assertDepartmentWritable`), drivers (`/backend/hr/drivers`, where the licence **and** the
medical certificate are watched together — a driver is compliant only while both are valid), employee
documents (`/backend/hr/documents`, the register an inspection asks for), and the approvals inbox from
the previous slice. Each list carries the filters an operator actually uses (employee, document type,
compliance window) and each form threads `updatedAt` for optimistic locking.

**The filter-key defect (31 keys, 12 routes).** Every `buildFilters` in these two modules emitted
camelCase keys, which the query resolves against nothing: `?departmentId=<uuid>` returned zero rows
while `?department_id=<uuid>` returned the row, same route, same session, same value. The schema's
`.passthrough()` accepted the parameter, so no gate noticed and the tables came up empty whenever a
filter was used. All 31 keys now name columns; `packages/core/src/__tests__/crud-filter-keys.test.ts`
fails the build on a recurrence; the contract is written down in
`.ai/lessons/crud-filter-keys-must-be-column-names.md`.

**Odometer log on handover (deliberate behaviour change).** `assignments.handover` now writes an
`assignment_handover` log beside the `assignment_return` one the module already wrote. A custody change
is the moment the mileage is agreed by two parties, and a vehicle held long-term otherwise had no
reading in its history until it came back — exactly the stretch a maintenance interval has to cover.
The log is created **after** the assignment is flushed, because a freshly created entity has no primary
key until then (the first attempt stored a NULL link, which the filter sweep caught).

**Adding a module to an existing tenant needs an ACL sync.** The seeded tenant predates these modules,
so every route answered `403 {"requiredFeatures":["hr.write"]}` although `setup.ts` declares the grants
— those are applied when a tenant is created. `yarn mercato auth sync-role-acls` (additive,
`ensureDefaultRoleAcls`) fixed it, and the app had to be restarted because the running process holds the
role ACL it resolved at boot.

**Phase 4–5 verification.** Live against a running app: 22/22 flow checks (department → employee →
workflow → step → leave request → submit → approve → entity flipped with decision trail + audit log;
cycle and self-parent rejected with 409, unknown parent with 400; handover → assigned → second handover
refused → return → released, with both odometer readings) and 26/26 filter checks. Committed as
`__integration__/TC-HR-001` (approval round trip), `TC-HR-002` (department integrity), `TC-HR-003`
(list filters) and `TC-FLEET-001` (custody). Playwright's static discovery of ~1.5k specs takes minutes
on a developer machine, which is why the same sequences were also driven straight over HTTP; the specs
are the CI artefact.

**Still open here:** attendance records cannot be turned into a lateness permission from the list (only
the record's own screen offers the workflow picker); `transport_operations` has no backend UI; the
Arabic rollout continues with the modules listed in the localization spec.

## 2026-09-27 (later) — approval configuration, and the lateness permission on the list

**Workflow and step configuration ships.** The engine could decide requests but nothing could define
what decides them: `/backend/hr/approval-workflows` (list, create, edit) and `/backend/hr/approval-steps`
(list across workflows, create, edit) plus a workflow's own steps screen at
`/backend/hr/approval-workflows/<id>/steps`. A workflow's `entityType` is a **select** of the two targets
the engine implements rather than free text — the string is compared at submit time, so a typo produced a
workflow that was never selected and never complained. A step's approver target follows its type
(`user` → a user, `role` → a role, `manager` → neither, resolved from the reporting line), and the
payload sends only the target the chosen type uses.

**`assertStepDefinitionWritable`** (service, wired into the step CRUD's create and update) enforces what
the form also checks: the workflow must exist in scope, and a step must name the approver its type
requires. A step without one can never be decided — the request would sit at it forever — and the
partial-update path sees through a type switch that does not touch the target. Verified live: 9/9 checks
(unknown workflow 400, user/role without a target 400, manager step accepted, type switch refused until
the target is supplied, unrelated edit keeps the stored approver).

**The lateness permission is reachable from the list.** An "Ask for permission" row action on late
attendance records opens `LatenessPermissionDialog`, which discovers an open request itself (so a second
one cannot be started), offers only active workflows declared for attendance records, and submits through
the same helper the record screen uses. Verified live: 10/10 checks including submit → approve → the
record becomes `present` with an audit entry.

**Two filter defects fixed on the way.** The workflow routes accepted `isActive`/`entityType` and applied
neither, so every picker listed inactive definitions and leave workflows; and `isActive: z.coerce.boolean()`
read `'false'` as `true`, so `?isActive=false` returned the active rows. The routes now filter
`is_active`/`entity_type`, and a boolean query parameter spells out its tokens
(`hr_management/lib/queryBoolean.ts`); the example module's todo route carried the same coercion trap.

**Still open here:** `transport_operations` has no backend UI; the Arabic rollout continues with the
modules listed in the localization spec (`wms`, `workflows`, `agent_orchestrator`, `warranty_claims`, then
the small admin surfaces, and `sales`/`customers`/`staff` in their own slices).

## 2026-10-03 — `transport_operations` gets its screens

The last UI-less sibling is finished. All four entities now have list, create and edit screens under
`/backend/transport/{vehicles,drivers,routes,trips}` (`page.meta.ts` carrying `transport.read` for the
lists and `transport.write` for the forms), one nav group, and dictionaries in six locales (163 keys;
Arabic translated, `de/es/ko/pl` mirroring English like the siblings).

**The trip screen owns the two state transitions.** Dispatch and complete are row actions that appear
only in the state that allows them (`scheduled` → dispatch, `in_progress` → complete), each behind a
confirm dialog, each wrapped in `useGuardedMutation` with the record's `updatedAt` in the mutation
payload, and each surfacing the server's translated 409 (`trip_not_scheduled`,
`assigned_driver_unavailable`, `trip_assignment_overlap`, …) instead of a generic failure. This is the
first write path in these three modules that is not a `CrudForm`, so it is also the first to exercise the
guard-context rule from `AGENTS.md` outside a form.

**Three list filters would have filtered nothing.** `vehicles` and `drivers` accepted no `search`
parameter at all and `drivers` had no expiry window, so the search boxes and the compliance dropdown
these screens now render would have answered `200` with the full page — the same silent-empty-page class
as the HR/fleet filter-key defect, which the `crud-filter-keys` guard cannot see because the key it
would flag is never built in the first place. Both routes gained a `search` that ORs across their
readable columns, `drivers` gained the `expiry=expired|within30` window computed server-side from the
shared `lib/expiry.ts`, and `lib/crudFilters.ts` carries the `$or`-merging helper so a search combined
with a status filter cannot drop one of them.

**Two decisions worth recording.** The driver form neither shows nor sends `employee_id`: the transport
module does not import HR's option hook (modules stay self-contained, and the ban on cross-module
imports is why the sibling hook exists per module), and because the update schema is partial the stored
link survives an edit rather than being nulled. And the trip form converts explicitly between the stored
UTC instant and the wall clock a `datetime-local` input speaks — `toISOString().slice(0, 16)` compiles,
passes in a UTC test runner, and shifts every trip by the operator's offset in production, so the
conversion is a pure exported function with the boundary pinned.

**Verification.** `cd apps/mercato; npx tsc -p .mercato/tsconfig-fleet.json` (now including transport)
exit 0; 41/41 unit tests in `transport_operations` (vehicle/route/driver/trip mapping and payloads,
`withOrConditions`/`expiryCutoff`, licence-state boundaries); `yarn generate` discovered all 12 backend
routes (`backend-route-shard.058.transport.generated.ts`); `yarn i18n:check-sync` and the Arabic audit
(`ar-audit/verify.mjs` → `keys=163 OK`) green; the repo-wide guards
(`crud-filter-keys`, `crud-resource-path`, `check-client-boundaries`) report nothing new;
`yarn template:sync:fix` mirrors all 69 files into the create-app template. Integration coverage ships as
`__integration__/TC-TRANSPORT-001-list-filters.spec.ts` — every transport filter asserted in both
directions against fixtures the spec creates and deletes (the trip is scheduled against the vehicle and
driver it just created, which is also the availability rule under test).

**Still open here:** the Arabic rollout continues with the modules listed in the localization spec
(`wms`, `workflows`, `agent_orchestrator`, `warranty_claims`, then the small admin surfaces, and
`sales`/`customers`/`staff` in their own slices); HR attendance records still cannot start a lateness
permission from the list's own workflow picker; and the untracked
`TRANSPORT_MODULE_STEP1_COMPLETE.md` at the repo root is stale — it stops at step 1 and points at step 2,
both long since committed, so the plan file you are reading is the tracker to trust.

## 2026-10-09 — the Arabic rollout reaches `wms`

The three app modules above are done, so the programme continued where the localization
spec pointed next: `wms` — first of `wms` / `workflows` / `agent_orchestrator` /
`warranty_claims` in that spec's value order.
`packages/core/src/modules/wms/i18n/ar.json` now carries all 1 057 keys in `en.json`
order: the warehouse/location/zone/inventory-profile configuration screens, the inventory
console (receive, adjust, move, reserve, release, cycle count), the balances, reservations
and movement-ledger lists, the operational dashboard, the location/lot/SKU detail views,
the two notification renderers and the catalog/sales widget injections.

Verified: `ar-audit/verify.mjs` → `keys=1057 OK`; `yarn i18n:check-sync` green; the 49
`wms` suites (300 tests) green; `yarn test:repo-wide-guards` shows only the pre-existing
enterprise `agent-taxonomy-rename` failure, which scans `agent_orchestrator` migration
files and is untouched by this slice. The module's UI, API, commands and tests are
unchanged — this slice is one data file plus this tracker.

`workflows` is the next module in the spec's value order.

