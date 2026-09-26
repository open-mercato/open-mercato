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

To finish it, in this order:

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