# Secure Workflow User-Task Access and Personal Inbox

## TLDR

**Key points:**

- Keep the existing `USER_TASK`, `/backend/tasks`, task APIs, `UserTask` entity/fields, ACL IDs, and widget infrastructure while adding an explicit upgrade bridge for legacy direct-assignment values.
- Add one server-authoritative human-session actor policy for personal visibility, claim, complete, and replay decisions.
- Make the existing task page discoverable as a top-level personal inbox for operators while preserving a separate permission-gated administrative `User Tasks` destination for workflow managers.

**Scope:**

- Correct `myTasks` filtering and manager-only broad inspection.
- Enforce tenant, organization, assignment, role, and claimant checks on list, detail, claim, and complete.
- Make claim single-winner and hand authorized completion to the companion durable-continuation contract.
- Emit direct-assignment notifications with the canonical `/backend/tasks/{id}` link.

**Primary risks:** task disclosure across users or organizations, unauthorized execution, claim races, and navigation that either exposes workflow administration to operators or hides it from managers.

## Overview

Open Mercato already pauses a root workflow instance or parallel branch when a `USER_TASK` is entered. The current task page and API are therefore the right foundation; a new workflow step type is unnecessary.

The missing boundary is authorization. Feature grants answer whether an actor may use task functionality, while assignment answers whether the actor may see or execute a particular task. Both checks are required. A workflow manager may inspect all tasks but does not gain execution authority solely from `workflows.manage`.

This specification is intentionally delta-first. Durable post-completion progression is defined separately in [`2026-07-15-durable-workflow-user-task-continuation.md`](2026-07-15-durable-workflow-user-task-continuation.md), and business-record placement is defined in [`2026-07-15-contextual-workflow-task-actions.md`](2026-07-15-contextual-workflow-task-actions.md).

## Current Baseline and Delta

Baseline reviewed: `open-mercato/open-mercato` `develop` at `39ab1d9e62950e84a5acfb10f2925a3ac41ec328` on 2026-07-22.

| Existing capability | Keep | Missing delta |
| --- | --- | --- |
| `USER_TASK` pauses root/branch execution | Yes | None |
| `/backend/tasks` and `/backend/tasks/{id}` | Yes | Personal navigation, access-aware actions, shared states |
| `GET /api/workflows/tasks` with `myTasks` query support | Yes | UI must send the flag; predicate must exclude peer-claimed tasks |
| Task detail, claim, and complete APIs | Yes | Shared actor policy, scoped locked writes, structured authorization errors |
| `assignedTo` UUID, email, and non-email legacy values | Field/config shapes remain readable | Canonical creation, pre-runtime audit, and explicit repair guidance |
| `workflows.view_tasks` and `workflows.tasks.*` | Every ID remains | Explicit compatibility bridge and coherent page/API grants |
| `workflows.task.assigned` notification type/subscriber | Type ID remains | Declare and emit event; fix `/backend/workflows/tasks/{id}` deep link |
| Workflow task integration coverage | Existing happy paths remain | Adversarial actor, scope, race, navigation, and notification coverage |

Concurrent work must be rechecked before implementation. As of the baseline above, [PR #4019](https://github.com/open-mercato/open-mercato/pull/4019) remains an open draft for visual-editor persistence, [PR #4085](https://github.com/open-mercato/open-mercato/pull/4085) remains open for user-task form normalization, and [PR #4291](https://github.com/open-mercato/open-mercato/pull/4291) remains open for role selection in the editor. None implements this access or navigation contract. Their merged replacements, if any, become the compatibility baseline; this specification does not modify their implementation branches.

## Problem Statement

The current implementation has independent checks that do not form an authorization boundary:

- the page initializes its `My Tasks` filter but omits `myTasks=true` from API requests;
- the list role predicate still includes a role task after another member claims it;
- claim does not verify that the caller belongs to an assigned role and starts with an unscoped read;
- completion does not prove that the caller is the direct assignee or claimant;
- saved definitions and pending tasks contain a mix of canonical IDs, emails, and non-email aliases, so secure canonicalization cannot ship without a compatibility inventory/repair path;
- route-level scope checks are followed by unscoped handler lookups;
- claim is read-then-write without a database single-winner boundary;
- the legacy page feature and current API feature protect different surfaces;
- the administrative navigation entry cannot be globally removed merely because a personal entry exists;
- notification infrastructure exists, but task creation does not emit its event and stored links target a non-existent route.

## Goals

1. Give operational users a personal task queue without requiring workflow-administration navigation.
2. Enforce one human task actor policy across list, detail, claim, complete, replay, contextual widgets, and notification recipients.
3. Scope every read and write by tenant and selected organization.
4. Make role-task claim a single-winner operation.
5. Keep manager inspection distinct from assignment-based execution.
6. Preserve the current routes, entities, task configuration, ACL identifiers, and notification type.
7. Preserve an administrative `User Tasks` destination for authorized workflow managers.
8. Inventory and safely bridge every existing direct-assignment shape before canonical-only execution becomes active.

## Non-Goals

- A new workflow step type or a change to `USER_TASK` pause semantics.
- General release, unclaim, reassignment, delegation, draft form data, or SLA escalation; the narrowly scoped compatibility repair command is the only reassignment in scope.
- Role-queue notification fan-out.
- A dynamic navigation badge.
- Business-record widgets; the contextual-actions specification owns them.
- Post-completion retry mechanics; the durable-continuation specification owns them.
- A database migration.
- Machine completion through API keys; that requires a separate task type, permission, and machine-principal audit contract.

## Proposed Solution

### Design Decisions

| Decision | Rationale |
| --- | --- |
| One module-local actor/policy helper owns visibility and capabilities | Prevents route and widget rules from drifting without adding a public service abstraction |
| Direct assignments do not require claim | The assigned user is already the sole worker |
| Role queues require claim before complete | Establishes one owner and removes the task from peers |
| `workflows.manage` grants broad inspection only | Administration must not silently authorize business execution |
| Existing page and API read IDs remain distinct and bridged | Preserves frozen contracts while keeping current routes usable |
| Two explicit menu items represent two different jobs | Personal execution and administrative inspection are intentionally separate |
| `navHidden` is only a generator control, never the navigation policy | Prevents a repeat of globally hiding the manager destination |
| Assignment notifications target direct users only | Avoids noisy and expensive role fan-out |
| API-key principals cannot become human task actors | Preserves the human-in-the-loop boundary and canonical human audit identity |
| Runtime email equality never authorizes execution | Email is mutable and recyclable; direct work must bind to an immutable user ID |
| Upgrade audit classifies UUID, email, and non-email aliases before rollout | Security hardening must not silently break saved definitions or strand pending tasks |

### Alternatives Considered

| Alternative | Why rejected |
| --- | --- |
| Add a new wait/approval step | `USER_TASK` already provides the pause |
| Let the client decide `canClaim`/`canComplete` | Client checks are bypassable |
| Let managers execute every task | Conflates inspection with assignment |
| Replace frozen ACL IDs with one new permission | Breaks existing roles and integrations |
| Keep the generated admin entry visible to all task operators | Task execution dependencies would recreate the Workflows administration group |
| Set `navHidden` and keep only My Tasks | Hides the administrative destination from workflow managers |
| Notify every member of a candidate role | Produces notification storms; the inbox remains the role queue |

## User Stories

- As an operator, I can open My Tasks from the top-level navigation.
- As a direct assignee, I can complete my task without claiming it.
- As an eligible role member, I can claim a task and become its only executor.
- As another role member, I stop seeing a task after a peer claims it.
- As a workflow manager, I can inspect all tasks through the Workflows group without gaining execution authority.
- As an existing administrator, I retain the administrative `User Tasks` destination.

## Architecture

### Components

| Component | Responsibility |
| --- | --- |
| `lib/user-task-access.ts` | Actor shape, personal predicate, broad-inspection check, `canClaim`/`canComplete`/`canRetryContinuation` |
| `lib/task-handler.ts` or focused task command module | Scoped locked claim and authorized handoff to completion |
| task API routes | Parse input, resolve actor/features, call shared policy/commands, expose OpenAPI |
| task pages | Personal inbox/detail UX driven by server capabilities |
| task navigation widget | Top-level personal item and grouped administrative item |
| task event/subscriber | Direct-assignment notification and client invalidation if broadcast is enabled |
| workflows assignment audit/repair CLI | Dry-run inventory, explicit pending-task mapping, and actionable definition remediation |

No new cross-module ORM relationship, global authorization primitive, or public DI key is introduced.

### Actor Contract

```ts
type UserTaskActor = {
  principalKind: 'human-session'
  userId: string
  roles: string[]
  features: string[]
  tenantId: string
  organizationId: string
}
```

The actor is constructed from authenticated server state and one explicitly selected organization. Feature checks use the shared wildcard-aware matcher. The module-local resolver is fail-closed: if neither the validated request selection nor authenticated organization supplies exactly one in-scope organization ID, list/detail/claim/complete return `400 MISSING_ORGANIZATION_CONTEXT` before any task or definition query. It never accepts `resolveOrganizationScopeFilter(...).where === {}` as a task scope. The same resolved `{ tenantId, organizationId }` tuple is passed to every route, helper, locked command, task/step/instance lookup, and definition lookup.

The resolver rejects `auth.isApiKey` and every other non-interactive principal with `403`; it never substitutes an API key's backing `userId` or treats API-key roles as human candidate-role membership. `userId` is the canonical session user ID.

When a new task has a direct assignment, task creation resolves the configured reference to exactly one active human in tenant/organization scope and persists the canonical user ID. A canonical user ID or email may be accepted as definition configuration input for that creation-time resolution, but email is never compared to the current actor at read or mutation time. Missing, inactive, foreign-scope, ambiguous, and non-email legacy aliases fail task creation with `USER_TASK_ASSIGNEE_UNRESOLVED` instead of persisting a non-canonical assignment.

### Assignment Compatibility Classification

Before canonical-only execution is enabled, `corepack yarn mercato workflows audit-user-task-assignees` runs dry by default and scans the selected tenant/organization's active definition versions plus `PENDING`/`IN_PROGRESS` tasks. It classifies every direct value:

| Stored/configured shape | Future definition behavior | Existing task behavior |
| --- | --- | --- |
| canonical active scoped user ID | accepted and persisted unchanged | remains actionable |
| email in a definition | resolved once at new task creation; canonical ID stored | never authorized by runtime equality |
| email in an existing task | not auto-bound because address history/recycling is unknowable | pending fails closed until explicit task-ID-to-user-ID repair; an in-progress task with a canonical `claimedBy` keeps its claimant |
| non-email legacy alias such as a username/label | cannot be guessed as user or role | pending fails closed until definition update/task repair; an in-progress task with a canonical `claimedBy` keeps its claimant |
| missing/inactive/foreign/ambiguous reference | definition validation error | fail closed and report |

The report names definition/version/task IDs, classification, and remediation without logging decrypted emails in normal output. `--apply-task-map <user-owned-json>` accepts exact task-ID-to-canonical-user-ID mappings, requires tenant/organization flags, verifies the target user is active/in scope, locks an unclaimed pending task, rewrites only `assignedTo`, and appends a user-task assignment-repaired audit event. It never guesses from current email ownership, never edits completed/claimed tasks, and never rewrites versioned definitions. Definitions are corrected through their existing editor/API by selecting a canonical user ID or intentional `assignedToRoles` value.

Implementation updates repository-owned examples, seeds, and integration fixtures that currently use aliases such as `approver` or `admin`. `UPGRADE_NOTES.md` requires a dry run and two independently measured rollout gates before deployment: zero unresolved direct assignments in active definitions, and zero unresolved `PENDING`/`IN_PROGRESS` legacy tasks unless an explicitly reviewed manual-repair inventory accepts their temporary fail-closed availability impact. Unresolved production definitions fail validation/preflight before entering `USER_TASK`, not silently after creating a stranded row. Pending task repair is never inferred from the definition gate.

### Personal Visibility and Capabilities

Every predicate begins with exact tenant and organization scope.

| Task | Personal visibility | `canClaim` | `canComplete` | `canRetryContinuation` |
| --- | --- | --- | --- | --- |
| `PENDING`, canonical direct user ID matches | Yes | No | Yes when complete feature is granted | No |
| `PENDING`, unclaimed role queue overlaps actor roles | Yes | Yes when claim feature is granted | No | No |
| `IN_PROGRESS`, `claimedBy` equals actor | Yes | No | Yes when complete feature is granted | No |
| Role task claimed by another actor | No | No | No | No |
| `COMPLETED`, `completedBy` equals actor and continuation is pending | Yes in detail/history, not in the default actionable inbox | No | No | Yes when complete feature is granted |
| `COMPLETED`, `completedBy` equals actor and continuation is applied/not required | Only in explicit history view | No | No | No |
| `PENDING`, legacy email-only assignment | Manager inspection only | No | No | No |
| `PENDING`, non-email legacy alias | Manager inspection only | No | No | No |
| Any foreign assignment or scope | No | No | No | No |

Capabilities are computed server-side for list/detail responses and recomputed under the mutation lock. They are presentation hints, not authorization tokens.

### Broad Inspection

- `myTasks=true` applies the personal predicate.
- `myTasks=false` or an omitted flag requests a broad organization-scoped list and requires wildcard-aware `workflows.manage`.
- Direct detail access requires personal visibility or `workflows.manage`.
- Manager inspection does not change `canClaim` or `canComplete`.
- Foreign-scope, missing, and non-visible task IDs return the same `404` response.

### ACL and Navigation Compatibility

All existing feature IDs remain. The implementation aligns them as follows:

- the generated task page retains `requireFeatures: ['workflows.view_tasks']`;
- task APIs retain their current `workflows.tasks.view/claim/complete` feature IDs;
- `workflows.tasks.view` depends on the legacy `workflows.view_tasks` feature as a one-way compatibility bridge;
- the legacy `workflows.view_tasks` feature no longer depends on the broad `workflows.view` feature, because a personal task worker must not gain workflow-definition navigation merely to execute assigned work;
- the default employee role receives `workflows.view_tasks`, `workflows.tasks.view`, `workflows.tasks.claim`, and `workflows.tasks.complete` so the personal inbox works on new tenants;
- administrators keep `workflows.*`;
- existing tenants receive the same grants through the standard idempotent ACL sync during implementation rollout.

Navigation contains two explicit contributions to `menu:sidebar:main`:

1. `workflows-my-tasks` → `/backend/tasks`, gated by `workflows.tasks.view`, with no group, labelled My Tasks;
2. `workflows-user-tasks-admin` → `/backend/tasks`, grouped under Workflows, gated by all of `workflows.manage`, `workflows.view_tasks`, and `workflows.tasks.view`, labelled User Tasks.

The task route may be `navHidden: true` only to suppress automatic route generation. That change and both explicit menu contributions are one atomic implementation unit. Shipping `navHidden` without the grouped manager item is a navigation regression and fails this specification. An operational employee sees exactly one task destination; a workflow manager may see both because they represent personal work and administrative inspection.

## Mutations

### Claim

1. Resolve actor and require `workflows.tasks.claim`.
2. In one transaction, fetch the task with `PESSIMISTIC_WRITE` using task ID, tenant ID, organization ID, `PENDING`, and no direct assignee.
3. Re-evaluate role overlap under the lock.
4. Set `claimedBy`, `claimedAt`, `status=IN_PROGRESS`, and `updatedAt`.
5. Append the existing `USER_TASK_STARTED` workflow audit event in the same transaction.
6. Commit before any optional broadcast/notification side effect.

Concurrent eligible claimers produce one success and one `409`. No undo is added; release/unclaim requires a separate lifecycle design.

### Complete Authorization Handoff

The complete route resolves the same actor, requires `workflows.tasks.complete`, validates the form through the canonical user-task form normalizer, and re-evaluates one of these conditions under the durable completion lock:

- pending direct assignment matches the actor; or
- in-progress role task has `claimedBy === actor.userId`.

For an already-completed task, the access layer exposes a separate replay branch only when `completedBy === actor.userId` and the actor still has `workflows.tasks.complete`. It does not set `canComplete=true` and cannot change accepted input. `canRetryContinuation` is true only while continuation is pending, but an identical transport retry may still reach this replay branch after continuation was applied or was not required so the route can return the same success. The durable-continuation specification owns same-input comparison and the idempotent result; a different actor remains indistinguishable from a missing task.

Only an authorized first completion or replay may invoke the transaction and continuation contract in the durable-continuation specification. A manager who is neither assignee, claimant, nor the original completing actor receives `404`, not an execution override.

Custom claim/complete routes gain the repository mutation-guard sequence; this is new work, not existing behavior. Each route maps the action to `update`, collects registered guards plus the legacy bridge, runs guards before the command with actor features and scoped payload, applies any allowed payload modification before validation/command execution, and invokes returned after-success callbacks only after a successful commit while isolating callback failure from the committed task state.

## Events and Notifications

The existing notification type ID `workflows.task.assigned` remains. The workflows event registry declares the matching event, and task creation emits it after the task commit only when a canonical direct user ID was persisted.

Trusted tenant, organization, and recipient scope is supplied in event options/context, not taken from arbitrary payload fields. The subscriber:

- resolves one canonical direct recipient;
- creates at most one notification per task/type/recipient under the notification module's idempotency contract;
- uses `/backend/tasks/{taskId}` for both action and link;
- does nothing for role-only queues or non-canonical legacy assignments;
- logs delivery failure without rolling back task creation.

## Data Models

No schema change is required.

| Existing field | Contract |
| --- | --- |
| `UserTask.assignedTo` | Canonical user ID for new direct assignments; legacy email/alias values remain manager-readable but never authorize personal execution |
| `UserTask.assignedToRoles` | Existing role identifiers emitted by workflow configuration |
| `claimedBy` / `completedBy` | Canonical user IDs |
| tenant/organization columns | Mandatory predicates for every task query/write |

No new PII is stored. Task APIs do not return decrypted auth fields or raw feature grants.

The frozen server projection shared with optional adapters is defined structurally rather than by a route-schema alias:

```ts
type AuthorizedUserTaskProjection = {
  id: string
  taskName: string
  description: string | null
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ESCALATED'
  formSchema: unknown | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
  claimedAt: string | null
  completedAt: string | null
  canClaim: boolean
  canComplete: boolean
  canRetryContinuation: boolean
}
```

The implementation derives these base fields from the existing `userTaskSchema` names and adds only the three booleans; the structural contract above freezes the minimum adapter-safe subset. Nullable optional route values are normalized to explicit `null` for this DI projection. It intentionally excludes `workflowInstanceId`, `stepInstanceId`, `formData`, `assignedTo`, `assignedToRoles`, `claimedBy`, `completedBy`, tenant/organization IDs, actor roles/features, workflow context/metadata, and business-source identifiers. `canRetryContinuation` is introduced only in the atomic delivery group that lands the durable continuation state that makes it computable.

## API Contracts

All current URLs and methods remain, and every route keeps an `openApi` export.

### `GET /api/workflows/tasks`

- Align runtime parsing with the existing OpenAPI `limit` contract (`1..100`) instead of the current raw `parseInt` divergence; reject non-numeric/out-of-range values with `400` and preserve valid `offset` behavior.
- `myTasks=true` defaults to active `PENDING,IN_PROGRESS` states when status is omitted.
- `myTasks=false`/omitted is manager-only broad inspection.
- Existing filters remain.
- Add `canClaim`, `canComplete`, and `canRetryContinuation` to each task projection.
- Errors: `400` invalid query/scope, `401` unauthenticated, `403` missing coarse feature or broad-inspection grant.

### `GET /api/workflows/tasks/{id}`

Return the current task projection plus `canClaim`/`canComplete`/`canRetryContinuation`. Personal visibility or manager inspection is required; invisible and foreign-scope IDs return `404`.

### `POST /api/workflows/tasks/{id}/claim`

No body. Return the updated projection. Errors: `400`, `401`, `403` missing claim feature, `404` invisible/ineligible task, `409` stale lifecycle or lost race.

### `POST /api/workflows/tasks/{id}/complete`

The existing `{ formData, comments? }` body remains. Access and error semantics follow the authorization handoff above; durable response/idempotency semantics are defined by the continuation specification.

## UI/UX

### Personal Inbox

- The page initializes and sends `myTasks=true` on initial load, filter changes, and pagination.
- Clearing filters restores personal active-task mode rather than broad mode.
- The All Tasks option is present only for wildcard-aware `workflows.manage`.
- Claim/Complete/Retry controls come only from server `canClaim`/`canComplete`/`canRetryContinuation`.
- Reuse the existing DataTable and task detail form; replace touched bespoke status/loading/error markup with shared semantic components.
- Every write uses `useGuardedMutation`; reads use `apiCall`/`apiCallOrThrow`.
- All visible strings use workflows locale keys for every supported locale.

### Navigation Acceptance Matrix

| Actor grants | Top-level My Tasks | Workflows → User Tasks | Administrative group introduced by task-only rights |
| --- | --- | --- | --- |
| operational defaults | Yes | No | No |
| workflow manager with all three admin-item grants | Yes | Yes | N/A |
| `workflows.*` | Yes | Yes | N/A |
| no task read grant | No | No | No |

Desktop and narrow headed tests must assert stable item IDs and route destinations, not localized text alone.

## Frontend Architecture Contract

| Surface | Server root after implementation | Client island | Data owner | Guardrail |
| --- | --- | --- | --- | --- |
| `/backend/tasks` | `backend/tasks/page.tsx` server wrapper plus generated route metadata | `UserTaskInboxClient` | workflows task API | extract the existing 300+ LOC page-root client; preserve DataTable extension IDs |
| `/backend/tasks/{id}` | `backend/tasks/[id]/page.tsx` server wrapper plus generated route metadata | `UserTaskDetailClient` and focused form/action leaves | workflows task API/form normalizer | extract the existing 500+ LOC page-root client; no duplicate schema logic |
| sidebar | existing AppShell/menu injection | existing injected-menu consumer | static widget metadata | static items only; stable IDs and wildcard-aware features |

`"use client"` ledger:

| File | Exact browser capability | Imported by | Heavy dependency / cleanup risk | Alternative rejected |
| --- | --- | --- | --- | --- |
| `backend/tasks/UserTaskInboxClient.tsx` | DataTable state, filters, pagination, router links, guarded Claim | server inbox page | existing table dependency only; target below 300 LOC | server-only table cannot own interactive filters/actions |
| `backend/tasks/[id]/UserTaskDetailClient.tsx` | task form state, canonical validation, guarded Claim/Complete/Retry | server detail page | existing form dependencies; split focused leaves before 300 LOC | server action would duplicate the existing task API/form contract |

Budgets: zero page-root `"use client"` directives after extraction, zero touched client leaves over 300 LOC, zero new heavy browser libraries, zero global providers, and the existing one-list-query/one-detail-query behavior. No provider/bootstrap registry changes. Implementation must pass `yarn check:client-boundaries`, hydration smokes for both routes, DataTable/filter/pagination interaction coverage, task form/action tests, and one build/runtime signal showing no new route-level heavy dependency.

## Internationalization

Add or update keys for top-level My Tasks, administrative User Tasks, personal/history filters, access-aware actions, empty states, and structured errors in every supported workflows locale. Existing notification type keys remain stable.

## Migration and Backward Compatibility

- No database schema migration or automatic identity backfill.
- No route, entity, notification type, or ACL ID is removed or renamed.
- The legacy task-view feature's dependency on broad workflow view is relaxed, not replaced by a new ID; existing grants keep working while task-only roles stop inheriting workflow-definition navigation through ACL dependency repair.
- Response capability fields are additive.
- Existing broad callers without `workflows.manage` begin receiving `403`; this intentional security hardening must appear in release notes.
- Existing canonical `assignedTo` IDs remain actionable. Legacy email/alias tasks become manager-readable but fail closed for personal access/execution until an explicit scoped task mapping is applied.
- Active definition versions and unresolved pending/in-progress tasks are inventoried as separate rollout gates. Canonical IDs remain unchanged; emails resolve only for future task creation; non-email aliases must be replaced explicitly with a canonical user or `assignedToRoles` configuration.
- The compatibility CLI is dry-run by default, never infers historical identity, never changes versioned definitions, and applies only exact operator-provided pending-task mappings under lock with an audit event.
- `UPGRADE_NOTES.md` documents classification, command examples, repository example changes, rollout order, and rollback (restore the previous application version; repair writes remain canonical and safe).
- New default employee grants require `yarn mercato auth sync-role-acls` for existing tenants during implementation rollout.
- Structural navigation cache refresh is required only if implementation changes discovered page/widget metadata; it is not a substitute for ACL sync.

## Performance and Cache

- Personal task reads are not server-cached.
- List queries apply tenant, organization, active status, then assignment/claim predicates before ordering and pagination.
- Actor identity/features are resolved once per request, not per row.
- Query count remains one paginated read plus one count.
- Implementation evidence includes representative direct-assignee and role-queue query plans at 10,000 scoped active tasks; p95 target is below 250 ms.
- If the existing indexes cannot meet the target, implementation stops for a separately reviewed additive-index design rather than weakening authorization.

## Implementation Plan

### Cross-Spec Implementation Order and Atomic Delivery Groups

1. Land this access/inbox capability as one release unit: required organization scope, actor policy, assignment audit/repair gate, secure projections, inbox `myTasks=true` requests, ACL/default grants, dual navigation, scoped Claim/Complete authorization, mutation guards, and direct-assignment notification/link repair. Do not activate broad-list gating while the inbox can omit `myTasks=true`, and never ship `navHidden` without both operator and manager entries.
2. Land the durable continuation capability as one release unit: journal, canonical digest, new locks, atomic completion, resume/reconcile paths, additive response, and `canRetryContinuation` UI. Do not expose a continuation capability before durable state exists.
3. Land contextual source binding, source-authorized routes, and widgets only after both companion contracts exist. If #4019, #4085, or #4291 merges first, rebase and preserve its editor/form-schema semantics rather than duplicating them.

The phases below are implementation sequencing inside the single access/inbox release, not independently deployable product capabilities. Across all three specs, every release unit must be independently green and deployable; commits within a unit must not create an intermediate deploy that broadens visibility, hides both task destinations, advertises an unavailable capability, or strands an accepted completion.

### Phase 1: Actor Policy and Secure Reads

1. Add the module-local actor/access helper and focused unit tests.
2. Add canonical assignment resolution plus the dry-run audit/explicit task-map repair command.
3. Update repository aliases and publish the required upgrade notes/preflight.
4. Apply the policy to list/detail projections and broad-inspection gating.
5. Send `myTasks=true` from the UI and hide broad mode from non-managers.

### Phase 2: ACL, Navigation, and Claim

1. Add the dependency/default-grant bridge and required ACL sync instructions.
2. Deliver `navHidden` suppression and both explicit navigation entries together.
3. Make claim scoped, locked, role-authorized, and single-winner.

### Phase 3: Completion Handoff and Notifications

1. Apply the access helper to complete before the durable continuation command.
2. Declare/emit direct assignment events and correct notification links.
3. Add self-contained API and headed UI coverage.

## Expected File Manifest

| Path | Action |
| --- | --- |
| `packages/core/src/modules/workflows/lib/user-task-access.ts` | Create focused internal policy helper |
| `packages/core/src/modules/workflows/lib/task-handler.ts` | Modify scoped claim and authorized completion handoff |
| workflows task-creation/definition validation paths | Modify canonical direct-assignee resolution and structured preflight error |
| `packages/core/src/modules/workflows/cli.ts` and focused command | Modify/Add dry-run assignment audit and explicit task-map repair |
| `packages/core/src/modules/workflows/workflows.ts` and affected fixtures/examples | Modify remove repository-owned non-canonical aliases |
| `packages/core/src/modules/workflows/api/tasks/route.ts` and `api/tasks/[id]/route.ts` | Modify required scope, runtime query validation, access, projections, OpenAPI |
| `packages/core/src/modules/workflows/api/tasks/[id]/claim/route.ts` and `complete/route.ts` | Modify required scope, new mutation guards, access, projections, OpenAPI |
| `packages/core/src/modules/workflows/acl.ts` / `setup.ts` | Modify compatibility dependency/default grants |
| `packages/core/src/modules/workflows/backend/tasks/**` | Modify personal inbox/detail UX and metadata; extract server page roots plus bounded client islands required by the frontend contract |
| `packages/core/src/modules/workflows/widgets/injection/**` | Add two static navigation items |
| `packages/core/src/modules/workflows/events.ts` / `subscribers/**` | Declare/emit notification event and fix subscriber |
| `packages/core/src/modules/workflows/notifications.ts` | Fix canonical deep link |
| `packages/core/src/modules/workflows/i18n/*.json` | Update copy |
| `packages/core/src/modules/workflows/__tests__/acl-dependencies.test.ts` | Modify pinned legacy/current dependency expectations |
| workflow unit/integration tests | Add actor, missing-organization, race, navigation, notification coverage |
| `UPGRADE_NOTES.md` | Modify direct-assignment inventory, repair, rollout, and rollback guidance |

## Testing Strategy

Fixtures create users, roles, workflow definitions, instances, and tasks through public APIs where practical and clean up in `finally`.

| Area | Required proof |
| --- | --- |
| Identity | canonical ID succeeds; definition email resolves only at creation; legacy/recycled email and non-email task aliases fail closed |
| Upgrade compatibility | audit classifies UUID/email/alias definitions and tasks; dry run writes nothing; explicit map repairs one locked pending task/audit; claimed/completed/foreign mappings rejected; existing canonical claimant can finish |
| Definition preflight | repository examples migrated; unresolved active alias reported before runtime; canonical user and role queue paths remain valid |
| Principal type | human session succeeds; API key with matching role/features receives `403` and writes no audit/task state |
| Personal list/detail | direct, candidate role, claimant, peer disappearance, completed history, original completer can view/retry pending continuation |
| Features | legacy/current read bridge, claim/complete independently, manager inspect without execute, wildcards |
| Scope | missing selected/auth organization fails before querying; foreign tenant/organization is absent on list and `404` on detail/mutations; no path receives an empty organization predicate |
| Claim race | two eligible users, one success, one `409`, one audit event |
| Navigation | operator exactly one item; manager grouped item; wildcard admin; no global-hide regression |
| Notification | one direct recipient, valid `/backend/tasks/{id}` link, no role fan-out |
| UI | personal query actually contains `myTasks=true`; desktop/narrow loading, empty, error, claim, complete |
| Optional integration | contextual widgets consume capabilities but cannot bypass mutations |

## Risks and Impact Review

### Cross-Scope Disclosure

- **Scenario:** a handler repeats an unscoped lookup after a scoped route check.
- **Severity:** Critical.
- **Affected area:** task/form/workflow data.
- **Mitigation:** one actor scope flows to every query and locked write; foreign/missing IDs share `404`; adversarial API tests.
- **Residual risk:** future bypass routes must import the same helper; route inventory tests remain necessary.

### Unauthorized Claim or Completion

- **Scenario:** an actor has a coarse feature but is not the assignee, claimant, or candidate-role member.
- **Severity:** Critical.
- **Affected area:** workflow decisions and downstream business state.
- **Mitigation:** assignment policy is recomputed under lock; manager inspection is not an override.
- **Residual risk:** role identifier semantics must stay aligned with auth/editor output.

### Claim Race

- **Scenario:** two role members claim the same pending task.
- **Severity:** High.
- **Affected area:** ownership and subsequent completion.
- **Mitigation:** scoped pessimistic lock and single transaction.
- **Residual risk:** losing client must handle `409` and refetch.

### Navigation Regression

- **Scenario:** automatic route navigation is hidden and no manager replacement is registered, or task grants recreate the admin group for operators.
- **Severity:** High.
- **Affected area:** task discoverability and least-privilege UX.
- **Mitigation:** two stable injected entries, all-of manager gate, atomic metadata/widget delivery, role-separated tests.
- **Residual risk:** custom sidebar preferences can still reorder/hide items by design.

### Mutable or Recycled Email Assignment

- **Scenario:** a pending legacy task is authorized by comparing its email with a changed, deleted, or recycled account address.
- **Severity:** High.
- **Affected area:** visibility and notification recipient.
- **Mitigation:** new tasks persist canonical user IDs at creation; runtime email equality never grants visibility or execution; all legacy email-only tasks fail closed.
- **Residual risk:** historical tasks require explicit administrator correction or workflow restart.

### Legacy Alias Upgrade Regression

- **Scenario:** an existing definition or pending task contains `assignedTo='admin'`, `approver`, or another non-email label and canonical-only execution activates without warning.
- **Severity:** High.
- **Affected area:** workflow availability and pending human work.
- **Mitigation:** exhaustive pre-runtime audit, repository fixture migration, zero-unresolved rollout gate, structured definition validation, and exact scoped task-map repair with audit.
- **Residual risk:** an operator can map an alias to the wrong human; dry-run review, exact task IDs, active-user validation, and audit evidence make that decision explicit rather than inferred.

### Machine Principal Executes Human Task

- **Scenario:** an API key inherits employee task features and a candidate role, then claims or completes a human task.
- **Severity:** Critical.
- **Affected area:** human approval boundary and audit attribution.
- **Mitigation:** actor resolution rejects API keys/non-interactive principals before personal predicates or mutations; no backing-user substitution.
- **Residual risk:** future machine-completable work requires a separate explicit contract and audit identity.

### Notification Failure

- **Scenario:** persistent delivery or notification service is unavailable.
- **Severity:** Low.
- **Affected area:** awareness only.
- **Mitigation:** task commits first; inbox is source of truth; subscriber retry/idempotency.
- **Residual risk:** notification can arrive late.

## Final Compliance Report

| Requirement | Planned compliance |
| --- | --- |
| Tenant/organization isolation | One required scope resolver fails closed; the exact tuple is mandatory in all reads, definition lookups, and locks |
| Wildcard-aware RBAC | Shared feature matcher only |
| Human principal boundary | API keys/non-interactive principals rejected; canonical session user IDs only |
| Assignment backward compatibility | UUID/email/alias inventory, explicit repair, preflight, examples, and upgrade notes required |
| Frozen route/ACL/notification contracts | Existing identifiers retained |
| Operator/manager navigation separation | Task-only grants do not imply broad workflow view; explicit stable menu items preserve both destinations |
| Cross-module independence | Auth used through scoped helpers; no ORM relation |
| Mutation guards and command boundary | Required for claim/complete |
| UI helpers, i18n, accessibility | Existing DataTable/forms plus shared states and localized copy |
| Self-contained integration coverage | Fixtures and cleanup explicitly required |
| Scope simplicity | One internal access helper; no global auth or navigation framework change |

Implementation remains blocked until this specification is merged and the public feature-claim admission gate is satisfied.

## Changelog

### 2026-07-22

- Rebased the specification baseline onto current `develop`, preserving the merged stable-activity-output specification.
- Made organization resolution fail closed, separated definition and pending-task upgrade gates, and defined the frozen authorized task projection.
- Corrected mutation-guard and query-validation descriptions to match the current implementation delta and named the ACL dependency test.
- Added security-preserving cross-spec delivery ordering and current overlap handling for #4019, #4085, and #4291.

### 2026-07-21

- Refreshed the delta against current `develop` and concurrent PRs.
- Split durable continuation into its own specification.
- Corrected the navigation contract: `navHidden` alone is explicitly non-compliant, operators retain top-level My Tasks, and workflow managers retain a grouped User Tasks destination.
- Simplified the architecture to one module-local access helper and existing task handlers rather than a new public DI service.
- Added an exhaustive UUID/email/non-email assignment upgrade bridge and required `UPGRADE_NOTES.md` guidance.

### 2026-07-16

- Expanded the approved skeleton into a complete access, inbox, and notification design.

### 2026-07-15

- Initial skeleton.
