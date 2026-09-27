# Fleet / HR: remaining phases, and how to execute them

Companion to [`2026-09-26-app-modules-completion.md`](./2026-09-26-app-modules-completion.md).
That plan describes the module-completion programme; this file is the operational
handoff for what is left after the 2026-09-26 sessions, written so the next agent
starts executing instead of re-deriving context.

## Where it stands

| Commit | Content |
|---|---|
| `4364e8e66` | HR API surface: `api/{openapi.ts,employees,departments}`, six more entity registrations, 8 error keys in six locales |
| `0aae19276` | Fleet write paths: `VehicleForm.tsx` (create/edit, camelCase payload mapping, `updatedAt` threading), `create/` + `[id]/edit/` pages, `VehicleAssignmentDialog.tsx` (handover/return), 39 keys |
| `468666dbe` | Fleet list entry points (`actions` + `rowActions` in `VehiclesTable.tsx`) |
| `54e7a68c7` | Seven HR CRUD routes (attendance, leave-requests, driver-profiles, employee-documents, approval-workflows, approval-steps, approval-requests) |
| `eab45e053` | `vehicle-form-values.test.ts` — pins version mapping and payload shape (7 assertions) |

Fleet is **complete**: CRUD API, custody handover/return, create/edit UI, list entry
points, dictionaries in six locales. HR is **API-complete minus the approvals engine**:
nine registered paths, ten entities with commands, `lib/` service rules, `setup.ts`,
dictionaries — and **no screens**.

## Verification, exactly as run (all green at `eab45e053`)

```bash
cd apps/mercato; npx tsc -p .mercato/tsconfig-fleet.json   # expect exit=0
node apps/mercato/.mercato/ar-audit/verify.mjs apps/mercato/src/modules/fleet_management apps/mercato/src/modules/hr_management
yarn i18n:check-sync
yarn i18n:check-hardcoded
cd apps/mercato; npx jest src/modules/fleet_management/components/__tests__/vehicle-form-values.test.ts   # 7/7
yarn generate   # then assert 9 /api/hr_management/* paths in .mercato/generated/openapi.generated.json
yarn template:sync:fix
```

The narrow `tsconfig-fleet.json` project is the fast gate; it covers both app modules.
A full `npx tsc --noEmit` over `apps/mercato` needs a larger heap than the default and
is not a per-slice gate.


## Phase 3 — HR approvals engine (do this first)

Blocks the Phase 4 approvals inbox and the reserved fleet-approval hook
(`FleetVehicleAssignment.approvalRequestId` is nullable and unused today).

1. **Read `apps/mercato/src/modules/fleet_management/commands/assignments.ts` first.** It
   is the in-repo proof of the custom-command shape: one transaction, pessimistic locks,
   side effects for every entity touched, a log row. Copy that structure rather than
   inventing one.
2. **Confirm the vocabularies before writing anything.** `data/validators.ts` holds the
   enums for `HrApprovalRequest.status`, `HrApprovalStepDefinition.approverType` and
   `HrApprovalActionLog.action`. The engine writes these values, so guessing them
   produces rows the validators would reject.
3. **Split decisions from effects.** A pure module (e.g. `lib/approvalState.ts`) taking
   `{ request, steps, action, actor }` and returning `{ status, currentStepOrder, isFinal,
   logEntry }` or a domain error keeps the state machine unit-testable without a command
   bus; `commands/approvals.ts` then owns persistence, locking and side effects.
4. **Five commands** — `hr_management.approvals.{submit,approve,reject,reassign,cancel}`
   — each writing an `HrApprovalActionLog` row and going through the optimistic-lock
   command guard.
5. **Five action routes** mirroring `api/assignments/handover/route.ts`
   (`resolveActionContext`, `withScopedPayload`, `runRouteMutationGuards`, non-CRUD
   `OpenApiRouteDoc`).
6. **Side effects on final approval belong here**: leave request → approved
   (`decidedByUserId`, `decidedAt`, `decisionComment`); assignment
   `pending_approval` → `active` by invoking the handover command, never by writing the
   vehicle status directly.

**Acceptance:** approving the final step flips the request *and* its target entity in one
transaction; reject/cancel leave the target untouched; every transition writes a log row;
a stale `updatedAt` returns 409.

## Phase 4 — HR screens

Employee directory, driver directory (licence + medical expiry alerts), employee
documents, approvals inbox. `VehicleForm.tsx` + `VehiclesTable.tsx` are the templates;
`CrudForm` derives the optimistic-lock header automatically as long as the row mapper
threads `updatedAt`. The inbox depends on Phase 3.

**Progress 2026-09-27 — the approvals inbox is done** (`/backend/hr/approvals`), the surface that
makes the Phase 3 engine reachable at all:

- `components/ApprovalsTable.tsx` — the pending queue (the status filter defaults to `pending`),
  showing the workflow's current step, the record the request is about (deep-linked through
  `lib/approvalInbox.ts`), the requester and how long it has waited. Approve / reject / reassign /
  cancel all run through `useGuardedMutation` with the row's version header; rejecting or cancelling
  requires a reason, because that comment is all the requester ever sees.
- `components/ApprovalDecisionDialog.tsx` + `ApprovalHistoryDialog.tsx` — the decision form
  (including the reassignment picker) and the audit trail the engine writes.
- `api/approval-logs/route.ts` — GET-only, because the engine is the only writer: the log had been
  written but was unreachable over HTTP.
- `commands/approvals.ts` — the four decision commands now enforce the command-level optimistic lock
  (`enforceCommandOptimisticLock`), closing the quorum-of-two race in which approver B's stale page
  would record an approval at a step B never saw.
- 20 unit tests in `lib/__tests__/approvalInbox.test.ts` pin the entity-type → screen map, the step
  progress, `isAwaitingActor`, the reassignment marker the engine appends to a comment, and the
  pending age. One of them caught a real bug in the fallback path (`index` was computed from the
  unmatched step order, so a request whose stored step no longer exists would show "step 0").

### The defect this phase uncovered

`metadata.path` **is** the URL: the router matches it verbatim (`matchRoutePattern`), while the
OpenAPI generator composes `/api/<moduleId>/<route directories>` and the client helpers build
`<moduleId>/<resource>`. Those three disagreed in `fleet_management`, `hr_management`,
`transport_operations` and `saudi_localization` — the routes declared `/hr/…`, the screens asked for
`hr_management/…`, and several resources were spelled `leave_requests` against route directories
named `leave-requests`. Every API call in those modules 404'd, which is why their screens could only
ever render empty tables, and no check in the toolchain could see it.

Fixed here: 62 route files now declare `/<moduleId>/…`, the client strings match them, and
`packages/core/src/__tests__/crud-resource-path.test.ts` fails when either side drifts, verified
against the generated route shards. Lesson: `api-url-prefix-must-match-the-module-id.md`.

Still open in Phase 4: driver directory (licence + medical expiry alerts) and employee documents.
Also worth adding: the attendance form has no workflow picker, so a lateness permission can only be
submitted through the API even though the engine already decides it (and the inbox can now act on
it) — the leave form is the only screen that starts an approval today.

## Phase 5 — tests

One pinned unit test exists. Still required by `.ai/qa/AGENTS.md` (same-PR rule):
integration coverage for fleet handover/return, HR approvals, and entity creation.
Invariants worth pinning as unit tests first:

- one attendance record per employee per UTC day;
- no leave overlapping pending/approved leave for the same employee;
- termination date not before hire date (and handover refusing a non-active employee);
- the return payload requiring the *open* assignment id, not just a vehicle id;
- HR dictionary parity, currently only 8 keys and certain to grow with the screens.

## Pitfalls already paid for — do not repeat

- **Editor inserts into an existing file landed mid-block twice** (`VehicleForm.tsx`,
  `VehicleAssignmentDialog.tsx`). Use the EOF boundary the tool reports, and re-read the
  seam after appending.
- **Never chain mutate → test → restore in one shell command.** Completion was lost and
  for several minutes it was unclear whether a source file had been left mutated. Verify
  a revert with `git status`, not with a grep.
- **Grep checks need a unique sentinel.** `updatedAt: null,` matched an unrelated line in
  the same file and produced a false "was neutered" positive.
- Helper/generator scripts under `apps/mercato/.mercato/` stay **untracked**
  (local-ops-file rule). Generated *module source* is ordinary hand-editable code and is
  committed.
- `de/es/ko/pl` locales mirror English by design (as the sibling modules do); Arabic is
  the real translation.
