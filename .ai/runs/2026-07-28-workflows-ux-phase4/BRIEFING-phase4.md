# Phase 4 — Human tasks: implementation briefing

Spec: `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6 + roadmap L448–450. Base: `feat/agent-orchestrator-mvp` @ `426704a5c` (Phases 0, 1, 2a, 2b, 3a, 3b landed). Closes: #4238, #4240 (dynamic half), #4241, #4242, #4243, #4247; #4246 phase 1. All paths below are relative to the repo root `/Users/pat-lewczuk/projects/open-mercato/2/open-mercato/`.

> **Read §0 and §A first.** The permission change is the riskiest item in the redesign, and Phase 4
> sits on top of **nine pre-existing defects** in code nobody has unit-tested. Several are hard
> prerequisites: the feature does not work today in ways the story catalog claims it does.

---

## A. Pre-existing defects found during research (all verified, none in scope going in)

| # | Defect | Anchor | Impact on Phase 4 |
|---|---|---|---|
| A1 | **`userTaskConfigSchema` has no `assignedToRoles` key.** `graph-utils.ts:95-97` writes it, `step-handler.ts:666` reads it, but zod 4 strips unknown keys and `api/definitions/[id]/route.ts:396` persists the *parsed* value. ⇒ **role assignment authored in the Studio is silently dropped on save.** Same for `formKey`, `allowedActions`. | `data/validators.ts:145-177`, `:446` | **Hard prerequisite.** Claim/role-queue work is meaningless until this is fixed. |
| A2 | **`claimUserTask` has no tenant/org filter** — `em.findOne(UserTask, { id, status:'PENDING' })`, mutates + flushes + logs an event *before* the route's tenant check (`claim/route.ts:61` then `:65-69`). A foreign-tenant id gets claimed, then 500s. Also **never checks the caller holds one of `assignedToRoles`**, and read-then-write is non-atomic (two concurrent claims both pass). | `lib/task-handler.ts:268-328` | Cross-tenant write. Must be fixed in the same PR as §0. |
| A3 | **`completeUserTask` has no assignee check and no tenant filter** in the lib (`{ id, status: {$in:[…]} }`). The route pre-checks tenant/org but not assignment ⇒ anyone with `workflows.tasks.complete` completes anyone's task. | `lib/task-handler.ts:70-113`, `complete/route.ts:95-115` | The whole point of #4238. |
| A4 | **`workflows.task.assigned` is dead.** Declared in `notifications.ts:5` and subscribed in `subscribers/task-assigned-notification.ts:10`, but **not declared in `events.ts` and emitted nowhere**. Assignment notifications never fire. The subscriber also returns early when `assignedUserId` is absent ⇒ **role-assigned tasks notify nobody**. | `events.ts` (24 events, none task-related) | E6-06 "✅ subscriber exists" is false. All notification delivery is greenfield. |
| A5 | **Notification deep links are broken** — `/backend/workflows/tasks/{id}`; the real route is `/backend/tasks/{id}`. | `notifications.ts:15,19`; `subscribers/task-assigned-notification.ts:46` | One-line fix, ship it. |
| A6 | **`myTasks` filter is never sent to the API.** The inbox defaults the filter to `'true'` (`page.tsx:64-66`) but only forwards `status`/`overdue`/`workflowInstanceId` (`:76-78`) ⇒ the "My Tasks" default view returns **all** tasks in scope. | `backend/tasks/page.tsx` | Users already believe they see only their tasks. Silent. |
| A7 | **Enterprise disposition `UserTask` rows are orphaned and unassigned.** `assignedTo` and `assignedToRoles` both null; `stepInstanceId: stepInstance?.id ?? ctx.processId` writes an *instance* uuid into `step_instance_id`; and **nothing ever closes the row** — grep for `UserTask` across `packages/enterprise/src` hits only this file, so after a Caseload dispose the task stays `PENDING` forever. | `packages/enterprise/.../lib/disposition/dispositionService.ts:117-156` | Under a naive "assigned OR role" rule these become **invisible to everyone**, stalling every parked `INVOKE_AGENT`. |
| A8 | **The "Review proposal" row action is a no-op.** The widget reads `row.proposalId` but `api/tasks/route.ts:121` returns `{ data: tasks }` — a raw entity dump; `proposalId` lives nested at `formSchema.proposalId`. No serializer, no enricher. | `packages/enterprise/.../widgets/injection/task-proposal-link/widget.ts:22-24` | Blocks §2.3's "Caseload and Work Inbox are the same record". |
| A9 | **`calculateDueDate` is a naive regex** (`P(\d+)D`, `PT(\d+)H`, `P(\d+)W`) that silently defaults to **+1 day** for anything unparsed — `PT30M` becomes 1 day. And nothing sweeps overdue tasks: `dueDate` is display-only; `escalationRules`, `assignmentRule`, `escalated_at`, `escalated_to`, status `ESCALATED` are **all authored-but-dead**. | `lib/step-handler.ts:1265-1290` | #4241 is entirely greenfield runtime work, not a "surface the existing schema" task. |

Also: **two live, parallel task ACL features** — pages gate on `workflows.view_tasks` (`acl.ts:18`, `backend/tasks/page.meta.ts:3`), APIs gate on `workflows.tasks.view` (`acl.ts:98`). Both are FROZEN ids; keep both.

---

## 0. THE FLAGGED SECURITY CHANGE (§6.4)

### 0a. Requirement, verbatim

§6.4:

> **Rule:** a user (backoffice or portal) can see and act on a task iff (assigned, or holds an
> assigned role, or claims from a role queue) **AND** passes access checks on the task's bound
> entities. `workflows.tasks.*` features gate *administration* (viewing others', reassigning) —
> never one's own assigned work.

> **Portal is new API surface, not a rule tweak:** existing task routes hard-gate on backoffice
> features and portal principals never pass backoffice auth. Phase 4 therefore ships **portal task
> routes** under the portal convention (`requireCustomerAuth` + customer RBAC + entity-access checks
> against customer-scoped records), rendering via the external-form renderer registry with the portal
> DS. Relaxing feature checks on the existing backoffice routes is a **security-semantics change to a
> STABLE API surface** and gets its own review line in the BC section (§11).

Spec BC section, L423:

> **One flagged security-semantics change:** task visibility moving from `workflows.tasks.view` to
> assignment+entity-access (§6.4) alters who can see existing task rows — **decision (2026-07-26):
> default-ON at release for all tenants**, with a tenant-setting opt-out escape hatch, an explicit
> UPGRADE_NOTES entry, and a dedicated security review as a release precondition (the entity-access
> AND-gate means the new model only ever *narrows* visibility relative to bare
> `workflows.tasks.view`, except for the intended assignment-based grants such as portal assignees).

Risk table L496: severity **High**, residual **Medium — needs review sign-off before release**. Resolved question #3 (L511): default-ON *"fixes the portal-approval bug (#4247) for existing tenants without requiring action."*

### 0b. What gates task visibility today

| Surface | File:line | Gate |
|---|---|---|
| Inbox page | `backend/tasks/page.meta.ts:3` | `requireFeatures: ['workflows.view_tasks']` |
| Detail page | `backend/tasks/[id]/page.meta.ts:3` | `requireFeatures: ['workflows.view_tasks']` |
| `GET /api/workflows/tasks` | `api/tasks/route.ts:25-28` | `requireFeatures: ['workflows.tasks.view']` |
| `GET /api/workflows/tasks/[id]` | `api/tasks/[id]/route.ts:25-28` | `requireFeatures: ['workflows.tasks.view']` |
| `POST …/[id]/claim` | `api/tasks/[id]/claim/route.ts:23-26` | `requireFeatures: ['workflows.tasks.claim']` |
| `POST …/[id]/complete` | `api/tasks/[id]/complete/route.ts:25-28` | `requireFeatures: ['workflows.tasks.complete']` |

Enforcement is inline in the two catch-alls, not a shared helper: API `apps/mercato/src/app/api/[...slug]/route.ts:161,215,249` (`rbac.userHasAllFeatures`, 403 body carries `requiredFeatures`); backend pages `apps/mercato/src/app/(backend)/backend/[...slug]/page.tsx:79-100`; portal pages `apps/mercato/src/app/(frontend)/[...slug]/page.tsx:118`.

Scoping in the list handler (`api/tasks/route.ts:54-119`): `resolveOrganizationScopeForRequest` → `resolveOrganizationScopeFilter` → `where = { tenantId, ...orgFilter.where }`. Assignment narrowing is an **opt-in query param**:

```ts
// api/tasks/route.ts:103-109
if (myTasks) {
  where.$or = [
    { assignedTo: auth.sub },
    { assignedToRoles: { $overlap: auth.roles || [] } },
  ]
}
```

⇒ **anyone holding `workflows.tasks.view` sees every task in the org today**, including other people's and agent-disposition rows carrying proposal payloads. Claim/complete use the single-org `scope?.selectedId ?? auth.orgId` while GET uses the multi-org `orgFilter` — inconsistent. Note also that `myTasks` matches on **`auth.roles` (role names)**, which the root AGENTS.md calls mutable and spoofable; the new model should key on role ids or features, not names.

### 0c. What "entity access" can concretely mean

**There is no record-level ACL layer in the platform.** Authorization = feature flags × tenant scope × org-visibility list. What exists:

- Wildcard matcher — `packages/shared/src/lib/auth/featureMatch.ts:25-32 matchFeature`, `:37 hasAllFeatures`. Canonical import surface (reversed arg order): `packages/shared/src/security/features.ts:4 hasFeature(granted, required)`, `:9 hasAllFeatures`. **Never `includes()` on a raw grant array** — seeded roles hold literal `portal.*`, `*`.
- `packages/core/src/modules/auth/services/rbacService.ts` — `:253 loadAcl`, `:383 getGrantedFeatures`, `:457 userHasAllFeatures`, `:397 tenantHasFeature`. DI key `rbacService`.
- Entity-**type** ACL (not record-level) — `packages/core/src/modules/entities/lib/entityAcl.ts:12-64` `ENTITY_ACL_REQUIREMENTS` map (`'customers:customer_deal' → { view:[…], manage:[…] }`), `:99 assertEntityAclForRequest({ auth, entityId, action, isCustomEntity, isRestricted, rbac })`. **This is the closest reusable primitive for "can this user see this entity type".**
- Synthesized per-entity features for restricted custom entities — `packages/core/src/modules/entities/lib/recordFeatures.ts:29 deriveCustomEntityRecordFeature`.
- The only real per-record rule in the repo — `packages/core/src/modules/communication_channels/lib/access-control.ts:36 assertCanAccessChannel(channel, currentUserId, userFeatures)` (owner-only, no admin bypass). **This is the pattern to copy.**
- Org predicate — `packages/shared/src/lib/auth/organizationAccess.ts:18 isOrganizationAccessAllowed` (fail-closed). Query-engine scoping — `packages/shared/src/lib/query/engine.ts:270` (tenantId required), `:1415 resolveOrganizationScope`, `:1428 applyOrganizationScope` (empty ids ⇒ `1 = 0`).
- Portal: `CustomerAuthContext` carries `customerEntityId` / `personEntityId` (`customer_accounts/lib/customerAuth.ts:7-18`) — the only record-shaped handles that exist.

⇒ **Phase 4 must define the check.** Realistic definition: `canAccessBoundEntity(auth, binding)` = `assertEntityAclForRequest`-style **entity-type** view feature (wildcard-aware) **AND** the record resolves inside the caller's tenant/org scope **AND**, on the portal, reachable from `customerEntityId`/`personEntityId`. Per-record ACL is **out of scope** — say so explicitly in the spec and PR.

### 0d. BC status of this change — state it plainly

`BACKWARD_COMPATIBILITY.md` was grepped exhaustively: **there is no rule covering tightening or loosening the auth/ACL requirement of an already-shipped route.** No section, no bullet, no classification-table row. Do not invent one. The nearest applicable rules:

- `:3` — *"Every surface listed below is a **public contract**. Changes to these surfaces MUST follow the deprecation protocol or they are **breaking changes** that block merge."*
- `:9` — *"keep the old behavior alongside the new one for at least one minor version."*
- §10 `:185-191` (ACL FROZEN) — *"MUST NOT rename an existing feature ID · MUST NOT remove an existing feature ID without a data migration that updates all stored role configs · MAY add new feature IDs freely."* Re-gating a route onto a *new* id functionally revokes access without removing an id.
- §7 `:150-159` (API STABLE) — URL/method/response fields unchanged here; *"MAY add new API routes freely."*
- §226 — the one explicit "don't repurpose security semantics" rule, scoped only to `AiAgentMutationPolicy`.

Practical read: hardening is neither forbidden nor blessed. It must be either **additive** (new feature id + `setup.ts` `defaultRoleFeatures` + `yarn mercato auth sync-role-acls`) or an **intentional breaking change** with the full package (spec + UPGRADE_NOTES). The tenant-setting opt-out is the "old behavior alongside the new" bridge required by `:9`.

### 0e. Approach

- Fix **A1, A2, A3 first**, in their own commits with regression tests. The new model is only "narrowing" if the handlers actually enforce anything.
- Pure, unit-testable `lib/task-visibility.ts`: `buildTaskVisibilityFilter(auth, mode)` → the `$or` clause; `assertCanActOnTask(auth, task, bindings)` → typed refusal. No DI, no React, no ORM (matches the Phase 2/3 pure-lib convention).
- Ship the tenant setting **before** flipping behavior: module `workflows`, key `task_permissions_business_context`, default `true`, via `moduleConfigService` (`packages/core/src/modules/configs/lib/module-config-service.ts:101-114`, `ConfigScope { tenantId, organizationId }`). Exemplar to copy: `packages/core/src/modules/entities/api/entity-settings.ts:9-67` (boolean, GET/PUT, features-gated, `tenantId` from auth never from input).
- Change the **filter** before the metadata: keep `requireFeatures` on the routes, make the default result set self-scoped unless the caller holds a new administration feature; then relax the self-scoped read/complete path to `requireAuth` with a fail-closed in-handler check. Never remove a feature id.
- New administration features (additive): `workflows.tasks.view_all`, `workflows.tasks.reassign`, `workflows.tasks.manage`. Add each to `setup.ts` `defaultRoleFeatures` and run `yarn mercato auth sync-role-acls` (enterprise AGENTS.md `:26` makes this a MUST).
- Portal is **new routes only** (BC §7). Never loosen the backoffice routes for portal principals.
- Give agent-disposition tasks a real assignment (A7) or the provider contract needs an explicit "administrative queue" visibility class.
- UPGRADE_NOTES entry under the existing `## 0.6.6 → 0.6.7 (unreleased)` heading.

### 0f. Test surface

- Unit `lib/__tests__/task-visibility.test.ts` — matrix: assignee / role holder / admin / unrelated / wildcard grant / opt-out ON+OFF / disposition task with null assignment.
- Unit regressions: `claimUserTask` and `completeUserTask` refuse a foreign-tenant id; complete refuses a non-assignee; concurrent claim is atomic.
- **`api/tasks/**` has zero route unit tests today** — the only API surface in the module without them. Add four.
- Integration: extend **`TC-WF-028`** (already covers RBAC gates on claim/complete) + new spec for (a) non-assignee with `workflows.tasks.view` no longer sees the task, (b) assignee with **no** `workflows.*` grant sees and completes it, (c) opt-out restores legacy visibility, (d) portal principal completes own bound task and cannot see an unbound one.

---

## 1. 4a — Task inspector (§6.1) · #4240 dynamic, #4241, #4242, #4243, presets

### 1a. Requirements (quoted, abbreviated)

> Sections, in order […] 1. **What** — title (pill-capable) + rich-text **instructions** with variable pills, rendered in a **live preview** against sample context. 2. **About what** — **entity binding**: `entityRef` picks from the ledger ("Customer ← {{context.customerId}}"); preview shows the record card; multiple bindings allowed. 3. **Who** — assignment tabs: **Role** […] **User** […] **Dynamic** (ledger pill, e.g. `{{deal.ownerId}}`, mandatory fallback role), **Rule** (BR picker, kept). 4. **When** — **deadline** (DurationInput anchored to creation; business word "deadline", never "timeout"); **reminders** (offsets); **on breach**: notify / reassign / **route the SLA-breach edge**. **Priority** (low/medium/high/extreme, mirroring platform labels). 5. **Decisions** — form builder […] + **decision buttons**, each mapped 1:1 to an outgoing route (Approve → A, Reject → B, Escalate → C); selected fields markable **editable-prefilled**. 6. **External form** (B5/#4243 […]) completed as a **renderer registry** keyed by formKey. 7. **Approval preset**: a palette entry pre-filling Approve/Reject + comment + entity-binding prompt.

§6.5: authored strings *"accept the platform localized-string shape (`{ [locale]: string }`) with single-string input treated as the tenant default locale"*; *"Node names/edge labels (author-facing) remain single-string."*

### 1b. Code anchors

- `data/validators.ts:145-177` `userTaskConfigSchema` — today only `formSchema` (union of `{fields:[{name,type,label,required?,options?}]}` and JSON-Schema `{properties,required?}`), `assignedTo: union(string, string[])`, `assignmentRule`, `slaDuration`, `escalationRules[]`. `:134 escalationTriggerSchema = ['sla_breach','no_progress','custom']`, `:137 escalationActionSchema = ['reassign','notify','escalate']`. Wired at `:446`. **See A1** — the schema is already out of sync with what the editor writes.
- Runtime creation `lib/step-handler.ts:654-729` (`handleUserTaskStep`), dispatched at `:344-345`. Reads only `assignedTo`, `assignedToRoles`, `formSchema`, `slaDuration`. `:664-671` array→roles coercion, **no `{{context.*}}` interpolation**. `:686` due date. `:696-709` logs `USER_TASK_CREATED`. `:711-720` pauses branch or instance; returns `{status:'WAITING', waitReason:'USER_TASK'}`.
- Editor round-trip: `lib/graph-utils.ts:95-116, 402-411`; `lib/nodeFormTransforms.ts:29-31, 108-110, 267-269, 435-438`; `components/NodeEditDialog.tsx:106-108, 217-219, 527-529`; `components/NodeEditDialogCrudForm.tsx:623-646`; `components/fields/RolesMultiSelect.tsx`.
- Reuse from Phases 2–3: `lib/context-ledger.ts`, `lib/expression-refs.ts`, `VariablePickerButton`, `components/InputDataPanel.tsx`, `lib/ledger-drag.ts`, `lib/sample-resolver.ts`, `interpolateVariables` (Phase-2b pipeline), durable transition ids `t_…` (Phase 3b). `DurationInput`: `packages/ui/src/backend/inputs/DurationInput.tsx`.
- Also validated but unused by any route: `createUserTaskSchema` (`:1176-1196`), `updateUserTaskSchema` (`:1200`), `userTaskFilterSchema` (`:1206-1213`). OpenAPI mirrors in `api/openapi.ts:13-81` (`userTaskSchema` at `:21-43` **omits `comments` and `branchInstanceId`**).

### 1c. Approach

- Fix A1, then extend `userTaskConfigSchema` **additively**: `assignedToRoles`, `formKey`, `instructions` (localized-or-string), `entityBindings: [{ entityType, idPath, label? }]`, `priority`, `deadline` (superset of `slaDuration`, which stays accepted forever), `reminders[]`, `onBreach`, `decisions: [{ id, label, transitionId, style }]`, `editablePrefilled: string[]`. Absent fields ⇒ byte-identical behavior — mirror the Phase-3a regression test in `lib/__tests__/error-routing.test.ts`.
- Fix A9's duration parser (or replace it with the shared duration util) as part of the deadline work.
- Pure `lib/task-localized-string.ts` for the `{ [locale]: string } | string` shape. **No `LocalizedString` type exists anywhere in the repo** — see Risks.
- Interpolate title/instructions/decision labels and resolve dynamic assignment at **task-creation time** in `handleUserTaskStep`, with the mandatory fallback role on a miss.
- Bind decision buttons to durable transition ids, not indices.
- External-form registry `registerTaskFormRenderer(formKey, …)`, modeled on `lib/activity-registry.ts:68 registerActivityType` (pure module, type-only imports so worker and browser can both load it — see the design note at `:9-17`).

### 1d. Test surface

- `lib/__tests__/user-task-config.test.ts` — round-trip of every new field through `graphToDefinition` / `definitionToGraph`; **plus an explicit A1 regression** (roles survive a save).
- New `lib/__tests__/task-handler.test.ts` — **`lib/task-handler.ts` has no unit test at all today.**
- Extend `lib/__tests__/step-handler.test.ts`, `lib/__tests__/integration.test.ts` ("Workflow with user task" suite), `lib/__tests__/advanced-config-transforms.test.ts`, `lib/__tests__/step-type-conversion.test.ts`, `data/__tests__/validators.test.ts`, `components/__tests__/{rolesMultiSelect,durationInputAdoption}.test.tsx`.
- Playwright: *"task completion with entity card + decision-button routing"*.

---

## 2. 4a — Work Inbox projection + `WorkInboxSourceProvider` (#4246 phase 1)

### 2a. Requirements (quoted)

§6.2:

> One queue (P9): filterable by kind/module/entity-type/role, sorted by priority + due date with
> overdue badges; claim/unclaim; **reassign/delegate with reason, audited**; manager **workload view**
> (open tasks per assignee/role, aging).
> **Task detail = decision + context side-by-side:** left — instructions, form, decision buttons;
> right — bound entity card(s) with deep links. […]
> **After completion: "next task"** — a one-click claim-next affordance […] keeps frontline flow.

§6.3: *"building the Work Inbox as **phase 1: a projection/read-model** over existing `UserTask` (+ enterprise `AgentProposal` via the provider contract, §2.3) with no data migration"*.

§2.3: *"Core defines a **`WorkInboxSourceProvider`** DI contract (`{ kind, list(query), render: widgetSpotId, actions }`); core registers the `user_task` provider; `agent_orchestrator` optionally registers the `agent_disposition` provider […] Without enterprise, the inbox simply shows workflow tasks; a disposition task raised by the bridge still renders in degraded form […] because it is a real `UserTask` row."*

### 2b. Code anchors

- `data/entities.ts:624-701` `UserTask`, table `user_tasks`, status union at `:55-60` (`PENDING|IN_PROGRESS|COMPLETED|CANCELLED|ESCALATED`). Indexes `:625-628`: `(workflowInstanceId)`, `(status, assignedTo)`, `(status, dueDate)`, `(tenantId, organizationId)`. `updated_at` present at `:699`. `assignedTo`/`claimedBy`/`completedBy`/`escalatedTo` are bare `varchar(255)` with **no FK**. **No task-comment / history / attachment entity exists** — `comments` is a single `text` column. Missing for §6: `priority`, `entityBindings`, `decisions`, localized title/instructions, reassignment audit columns.
- **`UserTask` is not in the optimistic-lock curated list** (`packages/core/src/__tests__/optimistic-lock-editable-entities.test.ts:57` lists only `WorkflowDefinition`). The UI-coverage guard's regex only matches `PUT|PATCH|DELETE`, and every task mutation today is a `POST` — **a Phase-4 PUT/PATCH reassign UI will trip that guard** and must wire `buildOptimisticLockHeader` / `surfaceRecordConflict`.
- Existing inbox: `backend/tasks/page.tsx` (352 L) — `DataTable` at `:335-347` with **`perspective={{ tableId: 'workflows.tasks.list' }}`** (`:344`), filters `:156-193`, columns `:195-315`, `handleClaim` `:99-118`. Detail `backend/tasks/[id]/page.tsx` (587 L), hand-rolled form, `POST …/complete` at `:103`, no claim button. Mobile: `components/mobile/MobileTaskForm.tsx`. DS debt: `getStatusBadgeClass` `:134-147` (`bg-yellow-100`, `bg-blue-100`, `bg-green-100`), `text-red-600` at `:209` and `:261`. **Phases 0–3 touched none of this; there is no bridge redirect for tasks** (unlike `backend/definitions/*`).
- DI: `di.ts:38-48` registers `workflowExecutor, stepHandler, transitionHandler, activityExecutor, eventLogger, signalHandler, timerHandler, conditionHandler` — all `.scoped()`. **There is no `taskHandler` DI key**; the task routes import `lib/task-handler.ts` directly, violating the module's own MUST #1. Fix that while adding `workInboxService`.
- Provider-registry precedents, in order of fit:
  1. **Generated-registry merge** (best for "many modules contribute to one list") — `packages/shared/src/lib/crud/enricher-registry.ts:48 registerResponseEnrichers(entries)`, `:66 getResponseEnrichers`, `:85 getEnrichersForEntity`; bootstrapped at `packages/shared/src/lib/bootstrap/factory.ts:85-87` alongside `apiInterceptors`, `componentOverrides`, `mutationGuards`, `commandInterceptors`, `notificationHandlers` (`:88-120`) — one uniform "generated entries → `register*(entries)`" shape, with per-entry `features[]`, `priority`, `timeout`, `fallback`, `critical`.
  2. **Optional-peer DI** — `agentWorkflowBridge`: core declares a structural `…Like` type and resolves defensively (`lib/server-output-contract.ts:57-59, :82`; `lib/activity-worker-handler.ts:341-343`), enterprise registers at `packages/enterprise/.../di.ts:158-165`. Resolves exactly **one** impl, not a merged list.
  3. **Imperative pure registry** — `lib/activity-registry.ts:43-78`.
- Enterprise injects into the current table at `packages/enterprise/.../widgets/injection-table.ts:14-19` → spot `data-table:workflows.tasks.list:row-actions` (resolved from `perspective.tableId` by `packages/ui/src/backend/DataTable.tsx:1378-1428`). **FROZEN (BC §6) — keep the `tableId` or enterprise silently breaks.**

### 2c. Approach

- Contract in core, `lib/work-inbox/provider.ts`: `{ kind; list(query, scope): Promise<WorkInboxRow[]>; render?: InjectionSpotId; actions?: … }` + `registerWorkInboxSources(entries)` / `getWorkInboxSources()` — declaration/discovery modeled on the enricher registry (F1), runtime services resolved inside a `tryResolve` (F2) so the enterprise source degrades to nothing when absent.
- `lib/work-inbox/user-task-source.ts` does the `EntityManager` work; register `workInboxService` in `di.ts` (BC §9: new DI keys are free).
- **Add a serializer** for task rows (fixes A8): project `proposalId`, `kind`, `priority`, `dueDate`, `entityBindings` to the top level instead of dumping the entity. `userTaskListResponseSchema` already exists in `api/openapi.ts` and is unused by the handler.
- New `GET /api/workflows/work-inbox` (provider merge, filters kind/module/entityType/role/priority/ overdue, sort priority→due→created) + `POST /api/workflows/work-inbox/next` (claim-next). Leave `/api/workflows/tasks` intact (BC §7). Clamp `limit` ≤ 100 (the current handler `parseInt`s freely despite the OpenAPI max).
- New page `backend/work-inbox/`, `backend/tasks` → redirect (spec: *"`backend/tasks` redirects to the Work Inbox; instance URLs preserved"*), following the Phase-3b bridge-route pattern. Re-emit `tableId: 'workflows.tasks.list'`.
- Reassign/delegate: `POST /api/workflows/tasks/[id]/reassign` + audited `WorkflowEvent` via `eventLogger.logWorkflowEvent()` (module MUST #6). New columns for reason/actor. **Adding a `UserTaskStatus` value (e.g. `REASSIGNED`) is Ask-First** per workflows AGENTS.md ("changing workflow/step/activity state machines").
- Workload view = grouped aggregate over the same projection, gated on `workflows.tasks.manage`.
- **Do not create a `Task` entity.** Resolved question #1: projection now, entity next cycle.

### 2d. Test surface

- Unit: provider merge with/without the enterprise source; sort order; overdue derivation; serializer shape (assert `proposalId` is now top-level).
- Integration: work-inbox list + claim + next-task loop; reassign audit event; extend **`TC-WF-024`** (list filtering) and **`TC-WF-023`** (claim/complete — its header documents the current `claimUserTask` preconditions and must be updated).
- Playwright: *"disposition task from Caseload lens and from Work Inbox are the same record"*.

---

## 3. 4a — Entity bindings, context panel, record-page widgets (#4242, #4246)

### 3a. Requirements

§6.1 §2 (entity binding — quoted in §1a). §6.2: *"**Record-page surfaces:** every bound entity type gets the injected 'pending work' widget."* §2.1: *"tasks/approvals render where the work is, via widget injection (generalizing the order-approval widget and `usePersonTasks`)."* §2.3: customer todos are a *"Phase-in target — workflow tasks bound to a customer surface through the same link mechanism (`todoSource: 'workflows'`)"*.

### 3b. Code anchors

- The pattern to generalize: `widgets/injection/order-approval/widget.ts` (id `workflows.injection.order-approval`, `features: ['sales.orders.approve']`) + `widgets/injection-table.ts:8-19` → spot `sales.document.detail.order:details` (`kind: 'group'`, `column: 2`, i18n group label).
- **Real record-detail spot ids** (convention `detail:<module>.<entity>:<slot>`): `detail:customers.deal:header|status-badges|footer` (`customers/backend/customers/deals/[id]/page.tsx:613, 631, 666`); `detail:customers.person:*` (`.../people-v2/[id]/page.tsx:505, 506, 722`); `detail:customers.company:*` (`.../companies-v2/[id]/page.tsx:474, 475, 609`); `detail:messages:message:sidebar`; `detail:sales.order:shipping`; `sales.document.detail.order:details|tabs`. Legacy: `customers.person.detail:details`. Host component: `packages/ui/src/backend/injection/InjectionSpot.tsx:216`; headless variant `useInjectionDataWidgets` (`packages/ui/src/backend/injection/useInjectionDataWidgets.ts:17`). All feature-gated with `hasAllFeatures`.
- Cross-module precedent (module A injects into module B's detail page): `packages/core/src/modules/communication_channels/widgets/injection-table.ts:21-36`.
- Customer todos: `customers/data/entities.ts:986-1016` `CustomerTodoLink` (`todo_id`, `todo_source` default `'customers:interaction'`, unique on `entity+todoId+todoSource`); `customers/components/detail/hooks/usePersonTasks.ts`; `TasksSection.tsx:132-133` already branches on a "legacy path" — a natural seam.

### 3c. Approach

- New additive `user_tasks.entity_bindings` jsonb column, written by `handleUserTaskStep` from the resolved config.
- One shared `components/work-inbox/EntityContextPanel.tsx` used by the task detail right column, the record-page widget, and the portal page.
- One generic `widgets/injection/pending-work/widget.ts` registered into the enumerated spots via `injection-table.ts`, with **empty `features`** — visibility comes from the §0 task filter, not a workflow grant (that is the point of #4238).
- Write a `CustomerTodoLink` row with `todoSource: 'workflows'` for customer-bound tasks — cheap, uses the existing unique key, delivers §2.3's phase-in without the C3 entity.

### 3d. Test surface

- Unit: binding resolution from ledger paths incl. `maybe` presence and missing-id degradation.
- Unit: widget metadata + injection-table shape.
- Playwright: order-detail widget still completes in place (regression on E6-10 — the one thing that already works); customer-detail pending-work widget appears.

---

## 4. 4a — Deadlines, reminders, breach, notifications & quick actions (#4241)

### 4a. Requirements

§6.1 §4 (quoted in §1a). §6.2:

> **Delivery:** assignment/reminder/breach → notifications (in-app + email) with deep links; an "on
> assignment, emit event" hook lets tenants route approvals anywhere (Slack via webhooks).
> **Notification quick-actions** complete a decision inline **only when** the task has exactly
> one-click semantics: no editable-prefilled fields and no required comment — otherwise the quick
> action deep-links to the full task.

### 4b. Code anchors

- See **A4** (dead event), **A5** (broken link), **A9** (dead escalation + naive duration).
- Declaration type `packages/shared/src/modules/notifications/types.ts:58-70` `NotificationTypeDefinition { type, module, titleKey, bodyKey?, icon, severity, actions, primaryActionId?, linkHref?, Renderer?, expiresAfterHours? }`; action type `:23-32` / runtime `:6-12` `NotificationAction { id, label, labelKey?, variant?, icon?, commandId?, href?, confirmRequired?, confirmMessage? }`.
- **Quick actions are fully wired server-side.** `packages/core/src/modules/notifications/lib/notificationService.ts:462-589` `executeAction` claims the row with a conditional `UPDATE … WHERE status != 'actioned'` (409 on double-fire) then `commandBus.execute(action.commandId, { input: { id: sourceEntityId, ...payload }, ctx, metadata })`. Route `notifications/api/[id]/action/route.ts:43-50` returns `{ ok, result, href }`. Href safety: `notifications/lib/safeHref.ts`. UI buttons `packages/ui/src/backend/notifications/NotificationItem.tsx:211-234` (hidden once `actioned`). ⚠️ **Two real gaps:** `primaryActionId` is not consumed by `NotificationItem`, and `confirmRequired`/`confirmMessage` are typed and validated but **no confirm dialog exists anywhere**.
- Service + builders: DI key `notificationService` (`notifications/di.ts:5-11`); `resolveNotificationService(ctx)` (`lib/notificationService.ts:671`); `lib/notificationBuilder.ts:74 buildNotificationFromType`, `:100 buildRoleNotificationFromType`, `:113 buildFeatureNotificationFromType`.
- **Recipient resolution** `notifications/lib/notificationRecipients.ts` — `create` (user), `createBatch` (`:37`), **`createForRole` (`:61`, joins `user_roles`)**, **`createForFeature` (`:80`, unions `user_acls` + `role_acls`, wildcard-aware via `hasFeature`)**. `groupKey` gives advisory-lock dedupe/refresh-in-place (`notificationService.ts:148-182`) — use it so reassignment does not spam.
- **Email exists**: `notifications/subscribers/deliver-notification.ts` (event `notifications.created`, persistent) → `sendEmail({ react: NotificationEmail(...) })`; template `notifications/emails/NotificationEmail.tsx` renders actions as **links only** ("read-only in this email"). Config per tenant via `moduleConfigService`, module `notifications`, key `'delivery_strategies'` (`lib/deliveryConfig.ts`); env `NOTIFICATIONS_EMAIL_ENABLED` defaults **true**. Channel selection is per-tenant only — not per type, not per user.
- Reactive handlers: `packages/shared/src/modules/notifications/handler.ts:49 NotificationHandler { id, notificationType (supports `*`/`prefix.*`), features?, priority?, debounceMs?, handle }`, registry `packages/shared/src/lib/notifications/handler-registry.ts:30`, dispatcher `packages/ui/src/backend/notifications/NotificationDispatcher.ts:189`, hook `packages/ui/src/backend/notifications/useNotificationEffect.ts:31`. Live examples: `enterprise/record_locks/notifications.handlers.ts`, `core/communication_channels/notifications.handlers.ts`. **Workflows has no `notifications.handlers.ts`.**

### 4c. Approach

- Declare task events in `events.ts` (module MUST #9: undeclared events error): `workflows.task.assigned` (fixes A4), `.reminder_due`, `.deadline_breached`, `.reassigned`, `.completed`. Emit `assigned` from `handleUserTaskStep` after flush.
- Rewrite the subscriber to use `createForRole` when only `assignedToRoles` is set (fixes the "role tasks notify nobody" half of A4) and `groupKey` for dedupe. Fix the hrefs (A5).
- Deadlines/reminders need a scheduler that does not exist. Reuse the Phase-3a **absolute-deadline queue backstop** used for `WAIT_FOR_CONDITION` — enqueue a `workflow-task-sla` job at task creation. Do not build a poller.
- SLA-breach edge as a transition `kind` on the USER_TASK node, resolved by a pure resolver in the shape of `lib/error-routing.ts`.
- Quick-action rule: pure `lib/task-quick-action.ts` computing `oneClick = decisions.length > 0 && !hasEditablePrefilledFields && !requiresComment`; only then emit a `commandId` action (needs a `workflows.tasks.complete` command in the command bus), otherwise the `href` deep link. **If the design needs a confirm step, the confirm dialog must be built** — it does not exist.
- Email: in-app + email land free via the existing `notifications.created` subscriber. Do **not** claim a workflows-owned mail feature — resolved question #6 keeps `SEND_EMAIL` an honest stub this cycle.

### 4d. Test surface

- `lib/__tests__/task-quick-action.test.ts` (predicate, both directions).
- Deadline job scheduling + breach routing resolver.
- **`notifications.ts` and `subscribers/task-assigned-notification.ts` have zero tests** — add them, incl. the role-recipient path.
- Integration: assignment notification actually created after a USER_TASK step runs.

---

## 5. 4b — Portal task API workstream (#4247) + Portal Event Bridge

### 5a. Requirements

§6.4 portal paragraph (quoted in §0a). §6.2: *"**Portal delivery (Ewa):** portal tasks notify through the **portal notification surface and email** (portal users are not backoffice-notification recipients); the Portal Event Bridge (`portalBroadcast`) live-updates her open task view. Mobile-first rendering via the portal DS."*

### 5b. Code anchors

- Pages: `packages/<pkg>/src/modules/<module>/frontend/[orgSlug]/portal/<segment>/page.tsx` + `page.meta.ts`. `[orgSlug]` MUST be the first segment. Existing pages live only in the `portal` core module (`landing, login, signup, verify, reset-password, dashboard, profile`). Enforcement — the **only** enforcement point, and a missing `page.meta.ts` silently disables access control: `apps/mercato/src/app/(frontend)/[...slug]/page.tsx:63-97` (`getCustomerAuthFromCookies`, org-slug ↔ `customerAuth.orgId` binding, `customerRbacService.userHasAllFeatures`). Types: `packages/shared/src/modules/registry.ts:26-49`. **No page in the repo uses `requireCustomerFeatures` yet** — documented form at `packages/ui/AGENTS.md:502-521`.
- ⚠️ **Naming trap:** `requireCustomerFeature` (singular) is the **API-route** helper (`customer_accounts/lib/customerAuth.ts:152`, async, re-resolves ACL, **throws** a 403 `NextResponse`); `requireCustomerFeatures` (plural) is the **page-metadata** field. Do not conflate.
- API routes live under `customer_accounts/api/portal/**` → `/api/customer_accounts/portal/...`; every file exports `metadata = { requireAuth: false }` and authenticates manually. `lib/customerAuth.ts:83 getCustomerAuthFromRequest`, `:144 requireCustomerAuth` (throws 401), `:7-18 CustomerAuthContext { sub, sid, type:'customer', tenantId, orgId, email, displayName, customerEntityId?, personEntityId?, resolvedFeatures }`. Scope always from `auth.*`, never query params — `api/portal/notifications.ts:11-62` (`{ recipientUserId: auth.sub, tenantId: auth.tenantId }`). 403 pattern: `api/portal/profile.ts:60-73`.
- Nav is derived from `page.meta.ts` `nav` blocks: `GET /api/customer_accounts/portal/nav` (`api/portal/nav.ts:37-69`) → `buildPortalNav` (`packages/ui/src/portal/utils/nav.ts:74-132`, feature-filtered by `hasAllFeatures` at `:98-101`). Menu-widget fallback: `usePortalInjectedMenuItems` (`packages/ui/src/portal/hooks/usePortalInjectedMenuItems.ts:70`), frozen spots `menu:portal:sidebar:main|account`, `menu:portal:header:actions`, `menu:portal:user-dropdown` (`packages/ui/src/backend/injection/spotIds.ts:49-53`). Portal content spots at `:55-63` incl. `portal:<id>:before|after`.
- Portal Event Bridge: flag `packages/shared/src/modules/events/types.ts:74-75 portalBroadcast?: boolean`; server check `packages/shared/src/modules/events/factory.ts:146 isPortalBroadcastEvent`; SSE route `customer_accounts/api/portal/events/stream.ts` (`GET` at `:148`, audience filter on tenant + org(s) + `recipientUserId(s)` at `:68-78`, 4 KB payload cap `:21`, 30 s heartbeat `:20`); hooks `packages/ui/src/portal/hooks/usePortalAppEvent.ts:33` and `usePortalEventBridge.ts:35` (mounted once by `PortalShell.tsx:400`). Real example: `customer_accounts/events.ts:5` (`customer_accounts.user.updated`, `portalBroadcast: true`).
- Portal notifications exist but are **read-only**: bell/panel (`packages/ui/src/portal/components/PortalNotificationBell.tsx`, `usePortalNotifications.ts`, 8 s poll), routes `api/portal/notifications*`. Gaps: **no `onExecuteAction`** (portal cannot run notification actions at all), no notifications page, and **no `notifications.*` event declares `portalBroadcast`**, so the SSE refresh path (`usePortalNotifications.ts:80`) never fires.
- Cross-module portal feature contribution: `setup.ts` `defaultCustomerRoleFeatures`, merged by `customer_accounts.seedDefaults` (`customer_accounts/AGENTS.md:155-157`). **This is how `workflows` ships `portal.tasks.*` without touching customer_accounts.**
- `CustomerRbacService` caches with a **5-minute TTL** (`customer_accounts/AGENTS.md:189`) — new portal grants are not immediate.

### 5c. Approach

- New portal ACL features `portal.tasks.view` / `portal.tasks.complete`, seeded via the workflows `setup.ts` `defaultCustomerRoleFeatures`.
- New routes, never a relaxation of `/api/workflows/tasks/*`: `GET /api/workflows/portal/tasks`, `GET …/[id]`, `POST …/[id]/complete`. Each: `requireCustomerAuth` → `requireCustomerFeature` → filter to tasks whose `entityBindings` resolve to `auth.customerEntityId` / `auth.personEntityId` **and** whose assignment names this principal. **Fail closed on a missing binding** — an unbound task is never portal-visible. Export `openApi` from every route (customer_accounts MUST rule).
- **Anything that can read another customer's tasks must be `isPortalAdmin`-gated and company-scoped**, matching the `portal/users*` precedent — not merely auth-gated. Note `isPortalAdmin` resolves to `['*']`, so a naive wildcard check hands a portal admin every task in the org.
- Portal assignee modeling: `UserTask.assignedTo` is a bare `varchar(255)` with no FK and no kind discriminator. Either prefix (`customer:<id>`) or add an `assignee_kind` column. **Decide explicitly** — it leaks into every visibility query.
- Mark the task events `portalBroadcast: true` and refetch with `usePortalAppEvent`.
- Page `frontend/[orgSlug]/portal/tasks/` (+ `[id]`) with a `nav` block, portal DS, rendered through the external-form registry. `components/mobile/MobileTaskForm.tsx` is a layout reference only — it lives in the backoffice tree; do not import it into portal code.
- 🔴 **Ask-First gate**: `customer_accounts/AGENTS.md:19` — *"Ask before changing cookie names, token TTLs, JWT claim shape, rate limits, lockout thresholds, or **portal RBAC semantics**."*

### 5d. Test surface

- Integration (spec-mandated): portal principal completes own bound task; cannot see an unbound one.
- Integration: portal principal gets 401/403 on the backoffice routes (proves nothing leaked).
- Unit: binding resolution incl. `isPortalAdmin` and wildcard grants (`portal.*`, `*`).

---

## 6. 4b — External-form renderer registry (#4243)

§6.1 §6: *"**External form** […] completed as a **renderer registry** keyed by formKey, receiving/returning typed context — the same mechanism portal rendering (§6.4) and record-page widgets use."* Issue #4243 has a two-part AC: document what Form Key is, and finish the binding end-to-end.

- Anchors: `data/validators.ts:147-164` (two accepted `formSchema` shapes); `formKey` is written by the editor (`NodeEditDialogCrudForm.tsx:623-646`) but **stripped by the schema — see A1**. Completion-time validation `lib/task-handler.ts:369-388 validateFormData` checks required-key presence **only for the JSON-Schema shape**; the `{fields:[…]}` authoring shape is never validated. Docs page: `apps/docs/docs/user-guide/workflows/user-tasks.mdx`.
- Approach: `registerTaskFormRenderer({ formKey, title, Renderer, inputSchema, outputSchema })` modeled on `registerActivityType`; consumed by task detail, portal page, and record widget. Unknown `formKey` degrades to the built-in form with a visible notice, never a blank screen. Fix `validateFormData` to cover the `{fields:[…]}` shape.
- Tests: registry resolution, unknown-key degradation, both `formSchema` shapes validated.

---

## 7. 4b — C3 architecture spec (#4246, entity work sequenced separately)

§6.3 freezes the shape now:

> `Task { kind: user_task | agent_disposition | todo, entityBindings[], assignment, priority, dueDate,
> decisions[], formSchema, source }` […] **phase 2: the real entity** with `CustomerTodoLink`
> convergence and cross-module workflow-pauses-until-done semantics.

Deliverable is a **document**: `.ai/specs/2026-07-xx-generic-task-entity.md` per `.ai/specs/AGENTS.md`, covering migration off the projection, `CustomerTodoLink` convergence (`todoSource: 'workflows'`), and how a non-workflow module raises a task that pauses an instance. **No entity work in Phase 4.**

---

## 8. Enterprise touchpoint (agent_orchestrator)

- Flow (`AGENTS.md:19`): *"**MUST gate disposition inline** — after `agentRuntime.run()`, `DispositionService` decides: `confidence ≥ threshold` → audited `auto_approved`; otherwise raise a `workflows` `USER_TASK`, park at `WAIT_FOR_SIGNAL`, and resume on `agent_orchestrator.proposal.ready`. Fail closed."*
- Impl `lib/disposition/dispositionService.ts` — gate `:39-45` (fail-closed on non-numeric confidence), `raiseUserTask :109-115`, `createUserTask :117-156` via a **dynamic import** of core workflows entities inside try/catch, degrading to `pending:<proposalId>` when the peer is absent. Design note `:47-67`: inline, not event-driven, *"an event-driven seam would lose the activity's transaction scope and race `WAIT_FOR_SIGNAL`."* DI `di.ts:121 dispositionService`. **See A7 and A8 for its four defects.** It also hardcodes English `taskName`/`description` — squarely in §6.5's scope.
- `agentWorkflowBridge` seam: interface `lib/runtime/invokeAgentForWorkflow.ts:59-70` (`invokeAgentForWorkflow` + **optional** `listAgentOutcomeContracts?`), args `:23-41`, outcome `:43-46`, service `:78-160`; header doc `:17-22` — *"keeps all `AgentProposal` access inside `agent_orchestrator` so the workflows module never imports this module's entities."* Registration `di.ts:158-165`. Core consumes it duck-typed in three places (`workflows/lib/activity-executor.ts:1135-1164`, `activity-worker-handler.ts:341-343`, `server-output-contract.ts:44,82`).
- **Caseload shares no record with the task inbox today.** `grep` for `workflows|UserTask` across `backend/caseload/**` returns **zero hits** — it is a pure `AgentProposal` surface (`/api/agent_orchestrator/proposals`, dispose with `buildOptimisticLockHeader` + `surfaceRecordConflict` + `useGuardedMutation`), guarded by `requireFeatures: ['agent_orchestrator.proposals.view']`. Spec L129 says *"The disposition task and the caseload item are the same record"* — today they are two rows joined by an un-navigable string. Closing that is A7 + A8 + a `proposalId` projection.
- Security precedent worth mirroring for portal tasks: `workflows/lib/activity-executor.ts:1191-1205` resolves the acting user from the **workflow instance** (`initiatedBy` / definition author), never `context.userId`, and refuses to run without a traceable user — *"Agent runs must execute under the identity of the user who triggered them."*
- 🔴 **Ask-First gate**: `agent_orchestrator/AGENTS.md:32` — *"Ask before changing disposition threshold semantics, the auto-approve vs `user_task` boundary, or the no-bypass flush-time enforcer."* Phase 4 touches exactly that boundary. `:26` — new ACL features MUST go into `setup.ts` `defaultRoleFeatures` + `yarn mercato auth sync-role-acls`.
- No-cross-import: `AGENTS.md:74` *"Cross-module links are FK ids only (no ORM relations across modules)"*; `:128` *"core reads it duck-typed, never imported"*; `:46` *"Never expose cross-tenant runs, proposals, traces, or principals."*

---

## 9. Constraints & tests

### 9a. workflows `AGENTS.md`

> **10. MUST scope all queries by `organization_id`** — workflow data is tenant-scoped; never expose
> cross-tenant instances or tasks

> **UserTask** — human-in-the-loop tasks. MUST have `assignedTo` or `assignedToRoles`; MUST respect
> `dueDate` for SLA tracking

(both violated today — A7 and A9.) Plus: **MUST resolve services via DI** (#1 — the task routes violate it), **MUST use event sourcing** (#6), **MUST declare new events in `events.ts` with `as const`** (#9 — A4). Never-list includes *"never expose cross-tenant workflow instances or tasks"*. **Ask First**: changing workflow/step/activity state machines (a new `UserTaskStatus` value), and coupling another module directly to workflow internals (the `WorkInboxSourceProvider` boundary). Canvas/status rule: *"Status is never colour-only"* — the current task badges violate it.

### 9b. `BACKWARD_COMPATIBILITY.md` surfaces touched

- §5 Event IDs (FROZEN) — MAY add; never rename `workflows.task.assigned`.
- §6 Widget spot ids (FROZEN) — keep `data-table:workflows.tasks.list:*` and `sales.document.detail.order:details` alive from the new surfaces.
- §7 API routes (STABLE) `:150-159` — new routes free; never remove response fields (so the raw-entity → serializer change must be a **superset**).
- §8 DB (ADDITIVE-ONLY) `:161-174` — new nullable/defaulted columns only; standard column contract (`tenant_id`, `organization_id`, `updated_at`) frozen. Precedent for nullable-column additions at `:278`.
- §9 DI names (STABLE) `:176-183` — new keys free; optional methods on existing interfaces free.
- §10 ACL (FROZEN) `:185-191` — add only; `workflows.view_tasks` and `workflows.tasks.view` both stay.
- §11 Notification type ids (FROZEN) — add only.
- **§security semantics: no rule exists.** See §0d.

### 9c. Optimistic locking, migrations, i18n, DS, docs

- `UserTask` is **not** in the curated editable-entity list; a PUT/PATCH reassign UI will trip `optimistic-lock-ui-coverage.test.ts`. Return `updatedAt` and wire `buildOptimisticLockHeader`/`surfaceRecordConflict`.
- Migrations: latest is `migrations/Migration20260727074335_workflows.ts`; snapshot `migrations/.snapshot-open-mercato.json` (8 tables; `user_tasks` = 23 columns + 4 indexes). Update entities → `yarn db:generate` → keep only the intended SQL → update the snapshot. **Never run `yarn db:migrate`.**
- i18n: no hard-coded user-facing strings; the enterprise disposition `taskName`/`description` are hardcoded English and are in §6.5's scope.
- DS (Boy Scout): `backend/tasks/page.tsx:134-147` status badge classes, `:209`, `:261` `text-red-600`.
- Docs: `apps/docs/docs/user-guide/workflows/{user-tasks,creating-workflows,step-types}.mdx`; `apps/docs/docs/framework/workflows/{architecture,extending,services}.mdx`; UPGRADE_NOTES under `## 0.6.6 → 0.6.7 (unreleased)`.

### 9d. Tests to extend

**Zero coverage today** (all central to Phase 4): `lib/task-handler.ts`, all four `api/tasks/**` routes, `notifications.ts`, `subscribers/task-assigned-notification.ts`, `backend/tasks/**`, `components/mobile/MobileTaskForm.tsx`, `components/nodes/UserTaskNode.tsx`, the `UserTask` entity, and enterprise `DispositionServiceImpl`.

Extend: `lib/__tests__/{step-handler,integration,context-ledger,step-type-conversion,advanced-config-transforms}.test.ts`; `data/__tests__/validators.test.ts`; `components/__tests__/{rolesMultiSelect,durationInputAdoption,variablePickerButton}.test.tsx`; `__tests__/acl-dependencies.test.ts` (**mandatory for any new ACL feature** — validates the graph, `defaultRoleFeatures` closure, admin wildcard); `__tests__/di-service-signatures.test.ts`; `__tests__/status-colors-ds.test.ts`.

Integration (`__integration__/`, 41 specs): **`TC-WF-023`** (claim + complete, P0), **`TC-WF-024`** (list filtering, densest task spec), **`TC-WF-028`** (RBAC gates on claim/complete, P0), `TC-WF-015` (USER_TASK in a fork branch), `TC-WF-021` (post-JOIN task creation), `TC-WF-034` (USER_TASK→AUTOMATED conversion quarantines `assignedTo`). Fixture-only: 002, 017, 033, 036. **No spec covers the task-inbox UI — coverage is API-only.** Harness: `@open-mercato/core/helpers/integration/*` — `getAuthToken(request, role)` (per-worker cache, dodges the 5/60s login rate limit), `apiRequest`, and `workflowsFixtures.ts` (`buildClaimableUserTaskDefinitionPayload:131`, `buildAssignedUserTaskDefinitionPayload:172`, `listWorkflowInstanceTasks:316`, `findInstanceUserTask:336`). Teardown is `try/finally` **inside** the test body — there are no `afterAll` hooks in this folder. Every spec opens with a JSDoc naming the TC id, "Surfaces under test" and "Real-behavior notes" — match it. 24 specs still import the legacy `modules/core/__integration__/helpers/*` alias; new specs use `helpers/integration/*`. ⚠️ `.ai/tmp/**` is excluded from Playwright discovery (`.ai/qa/tests/playwright.config.ts:19`) — specs written in this worktree are **not** picked up by the repo-root runner.

---

## 10. Risks / unknowns

1. **§6.4 permission change (HIGHEST).** Default-ON changes who sees existing rows in every tenant on upgrade, and it is only "narrowing" *if* the handlers enforce anything — today they enforce nothing (A2, A3). A **dedicated security review** must cover, at minimum:
   - the exact visibility predicate and its fail-closed behavior when a binding is missing or unresolvable;
   - that the tenant opt-out restores only the old **read** filter and never re-opens claim/complete;
   - A2 (cross-tenant claim write) and A3 (complete-anyone) fixed with regression tests in the same release;
   - **A7** — disposition tasks have no assignee and are never closed: proof they stay visible to the right operators and do not silently stall parked instances, and that the inbox does not fill with dead `PENDING` rows;
   - portal principal modeling in `assignedTo` (no FK, no kind discriminator) and that `isPortalAdmin`'s `['*']` grant does not become a cross-customer task read;
   - `myTasks` matching on **role names** (`auth.roles`) — mutable and, per the root AGENTS.md, spoofable; the new predicate should key on role ids or features;
   - `workflows.view_tasks` vs `workflows.tasks.view` retaining a defined administration meaning rather than becoming dead grants stored in role configs;
   - 404-vs-403 responses that do not disclose task existence across tenants;
   - the 5-minute `CustomerRbacService` cache TTL during a portal grant rollout.
2. **"Entity access" is undefined in the platform.** No record-level ACL exists. Phase 4 must define the check (entity-type feature + scope + portal ownership) and the spec must state that per-record ACL is out of scope.
3. **A1 is a hard prerequisite.** Role assignment authored in the Studio is silently discarded on save. Every claim/role-queue/Work-Inbox story is built on sand until it is fixed — and it is exactly the class of silent object-stripping bug Phase 3b already found three times.
4. **Notifications are greenfield, not "surfacing".** A4/A5/A9: the event is undeclared and unemitted, the links are broken, role-assigned tasks notify nobody, and no scheduler exists for reminders/breach. Size accordingly.
5. **Quick actions need two missing UI pieces.** `confirmRequired` has no dialog and `primaryActionId` is unread; portal notifications have **no `onExecuteAction`** at all, so a portal quick action is not possible without new work.
6. **No `LocalizedString` platform shape exists.** §6.5 assumes one. Inventing it inside workflows risks divergence; putting it in `packages/shared` creates a new STABLE type surface. **Ask first.**
7. **"Every bound entity type gets the widget"** has no generic record-page spot. Only per-entity `detail:<module>.<entity>:<slot>` ids exist. Either enumerate (honest, limited) or propose a generic convention that every host page must render. Do not claim universal coverage.
8. **Two Ask-First gates are unavoidable**: portal RBAC semantics (`customer_accounts/AGENTS.md:19`) and the auto-approve vs `user_task` boundary (`agent_orchestrator/AGENTS.md:32`). Adding a `UserTaskStatus` value is a third (workflows AGENTS.md, state machines).
9. **The `backend/tasks` → Work Inbox move must preserve `tableId: 'workflows.tasks.list'`** or the enterprise Caseload row action silently disappears — and it is already broken (A8), so a naive rewrite would hide the breakage rather than fix it.
10. **Phase sizing.** The roadmap calls Phases 2–4 "multi-release programs". With nine prerequisite defects, 4a alone is inspector + projection + widgets + notifications + a debt burn-down. Pick a cut line deliberately (suggestion: **4a-0** = A1/A2/A3/A4/A5/A6 debt + tests; **4a-1** = inspector + Work Inbox projection + entity panel; **4a-2** = workload/reassign/next-task/record widgets).
