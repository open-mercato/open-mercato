# Task visibility model — design for spec §6.4

- **Date:** 2026-07-28
- **Status:** design document. No code in this document; nothing outside this file was modified.
- **Spec:** `.ai/specs/2026-07-26-workflows-ux-redesign.md` §6.4 + the Migration/BC flagged paragraph.
- **Prior research (built on, not repeated):** `.ai/runs/2026-07-28-workflows-ux-phase4/BRIEFING-phase4.md` §0 (the gate inventory, the entity-access primitive inventory, the BC status, the §0f test surface) and §A (the nine pre-existing defects).
- **Designed against:** what will be merged — base `feat/agent-orchestrator-mvp` **plus** the Phase 4a work on `feat/workflows-ux-phase4` (entity-binding columns, `lib/task-resolution.ts`, `lib/work-inbox/*`, `api/tasks/serialize.ts`, the atomic claim). Phase 4a is a hard prerequisite; §11 sequences it.

---

## 0. Maintainer decisions this design is built on (not re-opened)

1. **Ship the full §6.4 change in one move.** No additive-then-flip two-step. Rationale on record: `agent_orchestrator` is not production code yet, so the risk of disposition tasks going dark is acceptable. This document still gives disposition tasks a real answer (§4) — "acceptable risk" is not "leave it broken".
2. **Portal principals get an `assignee_kind` discriminator column**, not a `customer:<id>` string prefix (§7).

Two things this design *adds* that need an explicit maintainer nod before implementation; both are called out where they arise and collected in §12:

- **D-1 (spec deviation).** Keep `workflows.tasks.claim` / `workflows.tasks.complete` as route `requireFeatures`, contrary to the ACL appendix sentence *"Task completion for one's own assigned work requires **no** workflows feature (§6.4)"*. Reason in §5.3.
- **D-2 (schema).** Add a denormalized `user_tasks.entity_types text[]` column so the entity gate is expressible in SQL rather than post-filtered in JS (§2.6).

---

## 1. The binding text

### 1.1 §6.4, verbatim

> **Rule:** a user (backoffice or portal) can see and act on a task iff (assigned, or holds an assigned role, or claims from a role queue) **AND** passes access checks on the task's bound entities. `workflows.tasks.*` features gate *administration* (viewing others', reassigning) — never one's own assigned work.

> **Portal is new API surface, not a rule tweak:** existing task routes hard-gate on backoffice features and portal principals never pass backoffice auth. Phase 4 therefore ships **portal task routes** under the portal convention (`requireCustomerAuth` + customer RBAC + entity-access checks against customer-scoped records) […]. Relaxing feature checks on the existing backoffice routes is a **security-semantics change to a STABLE API surface** and gets its own review line in the BC section (§11).

### 1.2 The flagged BC paragraph, verbatim

> **One flagged security-semantics change:** task visibility moving from `workflows.tasks.view` to assignment+entity-access (§6.4) alters who can see existing task rows — **decision (2026-07-26): default-ON at release for all tenants**, with a tenant-setting opt-out escape hatch, an explicit UPGRADE_NOTES entry, and a dedicated security review as a release precondition (the entity-access AND-gate means the new model only ever *narrows* visibility relative to bare `workflows.tasks.view`, except for the intended assignment-based grants such as portal assignees).

The parenthetical is the load-bearing claim of the whole rollout, and it is **only true if the act-path handlers actually enforce something**. Today they do not (briefing A2/A3); Phase 4a fixed the tenant filter and the atomic claim and added a completer check, but `claimUserTask` still never verifies the caller holds one of `assignedToRoles`. §11 lands that in the same release.

### 1.3 Risk register line

> | Task-permission model change exposes tasks to unintended users | High | Security | Default-ON at release (decided) with tenant opt-out, entity-access AND-gate, dedicated security review as release precondition of the STABLE-surface change | Medium — needs review sign-off before release |

---

## 2. The visibility predicate

### 2.1 Where it lives and what shape it has

One pure module, `packages/core/src/modules/workflows/lib/task-visibility.ts`. No ORM, no DI, no React, no registry imports — the same convention as `lib/task-resolution.ts`, `lib/error-routing.ts`, `lib/work-inbox/provider.ts`. Everything impure (ACL load, entity classification, portal ownership expansion) is resolved **once per request** by the caller and passed in as data.

```ts
export type TaskPrincipal =
  | {
      kind: 'backoffice'
      userId: string
      tenantId: string
      /** null = unrestricted operator (resolveOrganizationScopeFilter → where: {}) */
      organizationIds: string[] | null
      /** auth.roles — role NAMES, server-derived, never client-supplied */
      roleNames: string[]
      /** rbacService.getGrantedFeatures(...) — MAY contain '*' / 'workflows.*' */
      grantedFeatures: string[]
      isSuperAdmin: boolean
    }
  | {
      kind: 'portal'
      principalId: string          // CustomerAuthContext.sub
      tenantId: string
      organizationId: string
      /**
       * Record ids this principal may legitimately be the subject of.
       * For a plain portal user: {customerEntityId, personEntityId} minus nulls.
       * For a portal admin: the same PLUS every company-member record id,
       * resolved once per request by the route (never by this module).
       */
      ownedRecordIds: ReadonlySet<string>
      isPortalAdmin: boolean
    }

export type TaskEntityBindingFact = { entityType: string; entityId: string }

export type TaskFacts = {
  id: string
  tenantId: string
  organizationId: string
  status: string
  assignedTo: string | null
  assigneeKind: 'user' | 'customer'
  assignedToRoles: string[] | null
  claimedBy: string | null
  entityBindings: TaskEntityBindingFact[]
}

/**
 * Per-request, per-entity-type answer to "may this principal view records of
 * this type at all". Produced by the impure resolver in §3.3.
 *   value = the required feature list (already satisfied → included as []),
 *   MISSING KEY or explicit `null` = deny.
 */
export type TaskEntityAccessMap = ReadonlyMap<string, string[] | null>

export type TaskVisibilityPolicy = {
  /** Tenant opt-out. true = §6.4 model (default). false = legacy read filter. */
  businessContextEnabled: boolean
}

export type TaskVisibilityDecision = {
  visible: boolean
  /** May complete / decide this task. */
  actable: boolean
  /** May claim it off a role queue. Refinement of actable, never wider. */
  claimable: boolean
  reason: TaskVisibilityReason
}

export type TaskVisibilityReason =
  // admits
  | 'assignee' | 'claimant' | 'role-queue'
  | 'administrative'            // view_all / superadmin — visible, never actable
  | 'administrative-queue'      // unassigned queue item (§4)
  | 'legacy-read-filter'        // tenant opt-out is ON
  | 'portal-assignee' | 'portal-company-admin'
  // refusals
  | 'denied:tenant'
  | 'denied:organization'
  | 'denied:no-relationship'
  | 'denied:entity-access'
  | 'denied:unknown-entity-type'
  | 'denied:portal-unbound'
  | 'denied:portal-not-owner'
  | 'denied:portal-wrong-assignee-kind'

export function decideTaskVisibility(
  principal: TaskPrincipal,
  task: TaskFacts,
  entityAccess: TaskEntityAccessMap,
  policy: TaskVisibilityPolicy,
): TaskVisibilityDecision
```

### 2.2 The AND/OR structure, spelled out

§6.4's rule is one conjunction of two clauses. Written out for the backoffice branch:

```
visible  =  SCOPE
            AND ( RELATIONSHIP  OR  ADMINISTRATIVE )
            AND ENTITY

actable  =  SCOPE  AND  RELATIONSHIP  AND  ENTITY  AND  NOT terminal(status)
            AND assigneeKind == 'user'

claimable = actable
            AND task.assignedTo IS NULL
            AND task.claimedBy IS NULL
            AND status == 'PENDING'
            AND ROLE_OVERLAP
```

where

```
SCOPE          = task.tenantId == principal.tenantId
                 AND isOrganizationAccessAllowed({
                       isSuperAdmin,
                       allowedOrganizationIds: principal.organizationIds,
                       targetOrganizationId: task.organizationId })

RELATIONSHIP   = (task.assigneeKind == 'user' AND task.assignedTo == principal.userId)
                 OR task.claimedBy == principal.userId
                 OR ROLE_OVERLAP

ROLE_OVERLAP   = task.assignedToRoles ∩ principal.roleNames ≠ ∅

ADMINISTRATIVE = principal.isSuperAdmin
                 OR hasFeature(grantedFeatures, 'workflows.tasks.view_all')
                 OR ( UNASSIGNED_QUEUE(task) AND queueFeatureHeld(task) )     // §4

UNASSIGNED_QUEUE(task) = task.assignedTo IS NULL
                         AND (task.assignedToRoles IS NULL OR empty)
                         AND task.claimedBy IS NULL

ENTITY         = task.entityBindings.every(b => entityAccessOk(b))            // §3
```

Three properties worth stating out loud because they are the whole design:

- **`ADMINISTRATIVE` widens `visible` only, never `actable`.** An admin who can see everyone's work cannot complete someone else's task. To act, they must first take it: `workflows.tasks.reassign` → reassign to self → the RELATIONSHIP clause now holds, and the reassignment is on the audit columns (`reassigned_by`/`reassigned_at`/`reassign_reason`, already added in Phase 4a) plus a `WorkflowEvent`. This is Camunda's model, it is the only version that leaves an audit trail, and it is what makes "who approved this?" answerable.
- **`ENTITY` is an AND on both branches.** An administrator does not bypass it — except `isSuperAdmin`, which short-circuits, matching `assertEntityAclForRequest`'s existing `if (acl?.isSuperAdmin) return`. In practice a tenant `admin` role holds `workflows.*` **and** the module wildcards, and `matchFeature('customers.deals.view', 'customers.*')` is true, so real admins pass. A narrowly-granted operator who holds `workflows.tasks.view_all` but not `sales.orders.view` genuinely cannot see order-bound tasks. That is intended.
- **`ENTITY` is `every`, not `some`.** A task bound to both a deal and an order requires both view grants. Rejected `some` because a task about a sensitive deal that also names a harmless customer would leak to anyone who can see customers. The cost is a real failure mode — a legitimately-assigned worker can be blinded by a binding they cannot see — mitigated by the author-time check in §3.5 and the `denied:entity-access` diagnostic in §3.6.

### 2.3 Fail-closed: the exact rules

Fail-closed applies to **resolution failures**, not to absence of data. Precisely:

| Situation | Result |
|---|---|
| `task.tenantId !== principal.tenantId` | deny `denied:tenant`. Never overridden, not by superadmin, not by the opt-out. |
| org not in `allowedOrganizationIds` (and not superadmin, and the list is not `null`) | deny `denied:organization` |
| binding whose `entityType` does not normalize to a known entity id | deny `denied:unknown-entity-type` |
| binding whose entity type has **no** `ENTITY_ACL_REQUIREMENTS` entry and is not a classifiable custom entity | deny `denied:entity-access` (mirrors `entityAcl.ts:124` returning 403 for an unmapped type) |
| the per-request entity-access map is missing a key the task references | deny — a missing key is a resolution failure, never a pass |
| `entityAccess` resolution threw during the request | the route fails the **whole request** (500), it does not fall back to an empty map. An empty map plus vacuous-true logic would admit everything. |
| tenant-setting read fails | default to `businessContextEnabled: true` (the *new*, narrower model). Note this inverts `entity-settings.ts`'s `catch { return false }`; failing open to the legacy org-wide read would be a security regression. |
| `assigneeKind` is an unrecognized value | treat as neither `'user'` nor `'customer'` → RELATIONSHIP's assignee arm is false and the portal branch denies. |

### 2.4 A task with **no** bindings — the answer that drives everything

**Backoffice principal: the entity clause passes vacuously.** `[].every(...) === true`. A task with no bindings is governed purely by RELATIONSHIP ∨ ADMINISTRATIVE.

**Portal principal: a task with no bindings is denied** (`denied:portal-unbound`), always, including for a portal admin.

This asymmetry is deliberate and is the single most important decision in the document:

- A backoffice principal already carries an org-membership grant. Being *assigned* a task inside your own tenant and organization is itself a complete authorization story; there is nothing further to check when the task is about nothing. Every `UserTask` row written before Phase 4 has zero bindings, so the alternative reading — no bindings ⇒ deny — would make the entire existing corpus invisible to its own assignees on upgrade. That is not a narrowing, it is an outage.
- A portal principal carries **no** org-membership grant at all. The binding to their own customer/person record *is* the entire authorization. With no binding there is nothing tying the row to them, so there is nothing to authorize against. Deny is the only correct answer, and it is what the briefing §5c already committed to (*"Fail closed on a missing binding — an unbound task is never portal-visible"*).

Consequence to state in the PR and in UPGRADE_NOTES: **on release day, the entity gate is a no-op for essentially every existing row**, and the observable change is entirely the assignment gate. The entity AND-gate is a forward-looking constraint that starts biting as Phase 4a's `entityBindings` get authored. Do not let anyone review this change believing the entity gate is what protects them today.

### 2.5 The opt-out inside the predicate

When `policy.businessContextEnabled === false`:

```
visible = SCOPE AND hasFeature(grantedFeatures, 'workflows.tasks.view')   → 'legacy-read-filter'
actable, claimable = computed by the NEW rule, unchanged
```

The opt-out is a **read-only** escape hatch. It never touches `actable`/`claimable`. See §6.

### 2.6 Making the predicate a query, not just a check (D-2)

A JS predicate cannot filter a table. The list surfaces (`GET /api/workflows/tasks`, `GET /api/workflows/work-inbox`, the record-page pending-work widget, the workload aggregate) need the same rule as a `WHERE`. Two halves:

- **RELATIONSHIP ∨ ADMINISTRATIVE is directly expressible.** `buildTaskVisibilityFilter(principal, policy)` returns the `$and`/`$or` clause: tenant, org `$in`, and — unless ADMINISTRATIVE holds — `$or: [{ assignedTo: userId, assigneeKind: 'user' }, { claimedBy: userId }, { assignedToRoles: { $overlap: roleNames } }]`, plus the unassigned-queue arm from §4 when the caller holds the queue feature. This slots straight into `buildUserTaskWorkInboxWhere`'s existing `$and` array (`lib/work-inbox/user-task-source.ts:80`), which already composes independent `$or` groups exactly this way.
- **ENTITY is not expressible over the `entity_bindings` jsonb.** The predicate is *"no binding whose type is outside my allowed set"*; the disallowed set is unbounded (authored free text), so it cannot be enumerated as a series of `$contains` negations.

  **Recommendation (D-2):** add `user_tasks.entity_types text[]` (nullable, additive, GIN index), written at task creation from the resolved bindings — the same `[...new Set(bindings.map(b => b.entityType))]` the projection already computes at `user-task-source.ts:158`. The filter becomes a containment test, `entity_types IS NULL OR entity_types <@ ARRAY[:allowedTypes]`, emitted as one raw fragment inside `lib/work-inbox/user-task-source.ts` (the only file that needs it). It is indexable, it makes `total` correct, and it costs one nullable column on an ADDITIVE-ONLY surface.

  **Fallback if D-2 slips:** apply the entity gate as a post-filter over the returned page. Honest cost: `pagination.total` becomes an upper bound and pages can come back short. Ship it only with the response documenting `total` as approximate — do not silently lie about it.

  Rows written before the column exists have `entity_types = NULL`, which the filter treats as "no bindings" → §2.4's vacuous pass. Correct by construction.

### 2.7 404 vs 403

Existence disclosure rules for the single-task surfaces (`GET /api/workflows/tasks/[id]`, claim, unclaim, complete, reassign):

- `denied:tenant` → **404**, generic body. Always. A cross-tenant id must be indistinguishable from a nonexistent one.
- `denied:organization`, `denied:no-relationship`, `denied:portal-*` → **404**, generic body. The caller has no legitimate knowledge that this row exists.
- `denied:entity-access` / `denied:unknown-entity-type` **when the caller holds `workflows.tasks.view_all` or is superadmin** → **403** with `{ error, reason, entityType }`. They already know the row exists (it is in their list view, greyed); they need the diagnosis. This is the only case that returns a reason.
- Everyone else on an entity refusal → **404**.
- Route-level `requireFeatures` refusals still come from the API catch-all (`apps/mercato/src/app/api/[...slug]/route.ts:249`) as a 403 carrying `requiredFeatures`. That discloses nothing about a specific task and stays as-is.

---

## 3. What "entity access" concretely means

### 3.1 Statement of scope, to be repeated in the PR and the spec

**There is no record-level ACL in this platform, and this change does not add one.** Confirmed exhaustively: the query engine's entire public interface is `query(entity, opts)` (`packages/shared/src/lib/query/types.ts:179-181`); a grep for `acl|feature|permission|canRead|authorize` across `packages/shared/src/lib/query/engine.ts` returns zero matches. The only per-record rule in the repo is `assertCanAccessChannel` (`packages/core/src/modules/communication_channels/lib/access-control.ts:36-56`), which is a bespoke owner-comparison over an already-loaded row with no `entityId` and no wiring to `entityAcl.ts`.

So **"passes access checks on the task's bound entities" is implemented as entity-*type* + scope, not row-level**. In practice: *"you may see a task about a deal iff you may see deals at all, and the task is inside your tenant and organization."* A user who can see deals can see a task about **any** deal in their org, including one they would not have opened themselves. Say this in the UPGRADE_NOTES; do not let it be discovered.

### 3.2 The composition

For each binding, in order:

1. **Normalize** the authored `entityType` to a canonical generated entity id (`module:entity`). See §3.4 — this is the sharpest edge.
2. **Classify** the entity id: `system` (ORM-backed, in the generated `E` registry), `custom` (module `ce.ts` declaration or a scoped `custom_entities` row), or `unknown`.
3. **Derive the required view features**:
   - `system` → `resolveEntityAclRequirement(entityId).view` from `ENTITY_ACL_REQUIREMENTS` (`packages/core/src/modules/entities/lib/entityAcl.ts:12-64`). No entry, or `platformOnly: true` → **deny**.
   - `custom`, unrestricted → `['entities.records.view']`.
   - `custom`, `accessRestricted` → `['entities.records.view', deriveCustomEntityRecordFeature(entityId, 'view')]` (`packages/core/src/modules/entities/lib/recordFeatures.ts:28-30`).
   - `unknown` → **deny**.
4. **Match wildcard-aware**: `hasAllFeatures(granted, required)` from `@open-mercato/shared/security/features`. Never `Array.includes` — seeded roles carry `workflows.*`, `customers.*`, `*`.
5. **Scope**: the task row's own `tenant_id`/`organization_id`, already enforced by SCOPE in §2.2.

`isSuperAdmin` short-circuits the whole loop, matching `entityAcl.ts:107,121`.

### 3.3 Where the impure part runs

Do **not** call `assertEntityAclForRequest` per row — it calls `rbac.loadAcl` on every invocation, so a 50-row inbox page with two bindings each would issue 100 ACL loads. Instead:

```
resolveTaskEntityAccess(distinctEntityTypes, { auth, rbac, em, scope })
  → TaskEntityAccessMap        // one ACL load, one classification pass, cached per request
```

Reuse `classifyRecordsEntity`'s three-tier precedence (`packages/core/src/modules/entities/api/records.ts:87-106`: `isOrmBackedSystemEntityId` → module-declared `ce.ts` → scoped `custom_entities` row). That function is currently private to `records.ts`; **extract it to `packages/core/src/modules/entities/lib/entityClassification.ts` and re-export from `records.ts`** so both callers share one precedence chain rather than the workflows module growing a second, drifting copy. New exported symbol on an ADDITIVE surface — free under BC §2/§3.

For the **list** path the map is built from the distinct entity types on the page (or, with D-2, from the caller's allowed set, computed once). For the **single-task** path it is built from that task's bindings.

### 3.4 The normalization problem (the sharpest edge)

`entityType` on a binding is **authored free text**. Phase 4a's `lib/work-inbox/entity-links.ts` already documents this (`:1-13`: *"the inspector offers `customers:person` as a placeholder but stores whatever the author typed"*) and copes with a 13-entry alias table. Worse, its own canonical ids are display ids, not generated ones: it canonicalizes to `customers:person`, whereas `ENTITY_ACL_REQUIREMENTS` is keyed on `customers:customer_person_profile`. Two other divergent alias tables exist (`customers/ai-agents-context.ts:72-86`, the optimistic-lock `resourceKind` readers).

Design:

- Add `normalizeTaskEntityTypeToEntityId(raw): string | null` in the workflows lib, mapping authored spellings to **generated entity ids** (`#generated/entities.ids.generated`). Reuse `entity-links.ts`'s alias table as the input dictionary but invert its direction — deep-link canonical (`customers:person`) → ACL canonical (`customers:customer_person_profile`). Keep the two tables in one file with a unit test asserting they stay in sync; do not let a fourth alias table appear.
- Anything that does not normalize to a registry entity id → **deny** (`denied:unknown-entity-type`). Do not fall back to `resolveEntityTableName`'s pluralize-and-guess (`packages/shared/src/lib/query/engine.ts:130-147`, which *logs a warning and returns a guessed table name*). Guessing is the opposite of fail-closed.
- **Fix the source, not just the sink:** the §6.1 "About what" entity picker must emit generated entity ids and the Problems panel must flag a binding whose type does not resolve. A typo silently hiding a task from its own assignee is exactly the class of silent-stripping bug Phase 3b found three times.

### 3.5 Author-time guard

Add a Problems-panel check on the USER_TASK node: *"this task binds `<entityType>`; principals holding only `<assigned roles>` may not view that entity type."* It is a warning, not an error (role feature sets are tenant data and can change after authoring), and it is the difference between "the model narrowed correctly" and "tasks vanish and nobody knows why".

### 3.6 Diagnosability

A task hidden by the entity gate must never disappear without trace:

- `view_all` holders see the row in the inbox with a `hidden — entity access` marker and the failing entity type (403-with-reason per §2.7), not a silently short page.
- Task creation logs a `WorkflowEvent` when a binding's entity type does not normalize.
- The workload aggregate counts entity-hidden rows in a separate bucket so a manager sees "12 open, 1 not visible to you".

### 3.7 Accepted residual: bindings are not re-scope-checked per record

We check the *task's* org, not each bound *record's* org. Verifying every bound record is in the caller's org means one query per (entity type, id) per row — unacceptable on a list, and there is no generic `(entityType, recordId) → record` resolver to do it with (§3.1). The engine writes bindings by interpolating the run context of an org-scoped instance, so in the normal case they are same-org by construction; a `CALL_API` step could in principle inject a foreign id. **Accepted residual risk, item 6 on the review checklist (§9).** The portal path does *not* accept it — there the record identity is compared directly (§7.3).

---

## 4. Disposition tasks

### 4.1 The problem

`packages/enterprise/.../lib/disposition/dispositionService.ts:134-143` creates the `UserTask` with **no `assignedTo`, no `assignedToRoles`**, English hardcoded copy, `stepInstanceId: stepInstance?.id ?? ctx.processId` (an *instance* uuid in a step-instance column), and nothing anywhere closes the row — a grep for `UserTask` across `packages/enterprise/src` hits only this file. Under a naive "assigned OR role" rule, every one of these rows becomes invisible to everyone.

### 4.2 Recommendation: a provider-declared administrative-queue visibility class — implemented entirely in core

Add one **optional** field to the core-owned `WorkInboxSourceProvider` contract (`lib/work-inbox/provider.ts:127-134`):

```ts
export type WorkInboxSourceProvider = {
  kind: string
  moduleId: string
  render?: string
  actions?: WorkInboxAction[]
  /**
   * ACL feature that admits a principal to this source's UNASSIGNED rows.
   * Declares "this kind is an administrative queue, not personal work".
   * Absent ⇒ unassigned rows of this kind fall back to
   * `workflows.tasks.view_all` (core's own administrative grant).
   */
  administrativeQueueFeature?: string
  list: (...) => Promise<WorkInboxSourceResult>
}
```

`agent_orchestrator` registers its `agent_disposition` source from its own `di.ts` declaring `administrativeQueueFeature: 'agent_orchestrator.proposals.view'` — which the seeded `admin`, `employee`, `operator` and `engineer` roles already hold (`packages/enterprise/src/modules/agent_orchestrator/setup.ts:60-90`). Nothing in `dispositionService.ts` changes. The auto-approve vs `USER_TASK` boundary is not touched, so the `agent_orchestrator/AGENTS.md:32` Ask-First gate does **not** fire.

In the predicate this is the `UNASSIGNED_QUEUE ∧ queueFeatureHeld` arm of ADMINISTRATIVE (§2.2). The queue feature for a `user_task`-kind row with no assignment is core's `workflows.tasks.view_all`; for an `agent_disposition` row it is whatever the enterprise provider declared. Concretely, on release day:

- an operator with `agent_orchestrator.proposals.view` still sees every disposition task — the population that sees them today is unchanged;
- a workflows-only user with `workflows.tasks.view` who has no orchestrator grant stops seeing them, which is the intended narrowing;
- nothing stalls, because a parked `INVOKE_AGENT` resumes from the **Caseload** disposing the `AgentProposal`, not from the task row.

The disposition tasks also carry zero bindings, so §2.4's vacuous-true keeps the entity gate out of the way.

### 4.3 Rejected alternatives

- **Give them a real user assignment.** Nobody knows who. The enterprise module cannot pick a tenant user without inventing routing policy that belongs in the workflow definition.
- **Give them a role assignment.** `assignedToRoles` holds tenant role *names*; `agent_orchestrator` has no business knowing a tenant's role vocabulary, and a rename orphans it silently.
- **Leave them feature-gated on `workflows.tasks.view` forever (a carve-out).** That is the pre-change semantics kept alive under a new name, and it re-widens exactly the grant the change exists to narrow.

### 4.4 The related defect, filed separately — say it loudly

**A7 (nothing closes the row) is a real bug and this design does not fix it.** After a Caseload dispose the `UserTask` stays `PENDING` forever, so the administrative queue fills with dead rows. Fixing it means calling into the workflows task handler from the dispose path in `dispositionService.ts`. That is **completing a loop the design already assumes**, not moving the auto-approve boundary — but it is the same file the Ask-First rule guards, so **get an explicit maintainer OK before touching it** and land it as its own PR with its own tests. The visibility model works without it; the inbox will just be untidy. Also unfixed here: A8's `stepInstanceId` type confusion and the hardcoded English copy (§6.5's i18n scope).

---

## 5. The administration features

### 5.1 New ids (additive — BC §10 "MAY add new feature IDs freely")

| id | dependsOn | Admits |
|---|---|---|
| `workflows.tasks.view_all` | `workflows.tasks.view` | Read tasks you have no relationship to, subject to the same entity gate. Powers the inbox "All work" lens, the manager workload view, the unassigned-queue arm for core `user_task` rows, and 403-with-reason diagnostics. **Never grants act.** |
| `workflows.tasks.reassign` | `workflows.tasks.view_all` | `POST /api/workflows/tasks/[id]/reassign` — change `assigned_to`/`assigned_to_roles` with a mandatory reason; writes the Phase-4a audit columns and a `WorkflowEvent`. This is the *only* supported way an administrator comes to act on someone else's work. |
| `workflows.tasks.manage` | `workflows.tasks.view_all` | Administrative mutations that are not reassignment: force-unclaim, cancel a task, bulk operations, and `PUT` on the tenant setting (§6). |

`dependsOn: ['workflows.tasks.view']` on `view_all` is what keeps the old id load-bearing in the ACL graph and satisfies `__tests__/acl-dependencies.test.ts` (which asserts the full dependency table explicitly — every new row must be added there or the test fails).

Wildcard check that matters: `matchFeature('workflows.tasks.view_all', 'workflows.*')` → prefix `workflows`, `required.startsWith('workflows.')` → **true** (`packages/shared/src/lib/auth/featureMatch.ts:27-30`). So `admin: ['workflows.*']` in `setup.ts:13` picks the three new features up automatically. No tenant admin loses access on upgrade.

### 5.2 `setup.ts` `defaultRoleFeatures`

```ts
defaultRoleFeatures: {
  admin: ['workflows.*'],                 // unchanged — wildcard already covers the new ids
  employee: [
    'workflows.view',
    'workflows.view_tasks',
    'workflows.tasks.view',
    'workflows.tasks.claim',
    'workflows.tasks.complete',
    'workflows.instances.view',
  ],                                       // unchanged — employees get NO administration
}
```

The `employee` list is deliberately untouched. Granting `view_all` to employees would restore the pre-change behavior for the largest population and make the whole release a no-op. Tenants that genuinely want a supervisor role add `workflows.tasks.view_all` themselves; UPGRADE_NOTES tells them how. Run `yarn mercato auth sync-role-acls` after the ACL change (workflows/enterprise AGENTS.md make this a MUST for new features).

### 5.3 The two existing task features — no dead grants

| id | Before | After |
|---|---|---|
| `workflows.view_tasks` | `requireFeatures` on the task **pages** (`backend/tasks/page.meta.ts:3`, `backend/tasks/[id]/page.meta.ts:3`) | **Unchanged.** Moves with the pages to `backend/work-inbox` (the bridge redirect keeps `backend/tasks` alive). It is the "the Work Inbox exists in your nav" grant. |
| `workflows.tasks.view` | `requireFeatures` on `GET /api/workflows/tasks` and `GET /api/workflows/tasks/[id]` — and *effectively* meant "see every task in the org" | **Retained in place, effect narrowed.** It stays the `requireFeatures` gate on the list/detail read routes and on `GET /api/workflows/work-inbox`, and becomes the `dependsOn` root of all three new features. It is now **necessary but not sufficient**: it admits you to the API, the predicate decides which rows you get. |

Neither becomes a stored-but-meaningless grant. `workflows.tasks.view` is in the seeded `employee` set, so no existing tenant using seeded roles loses the ability to open their own inbox.

**D-1 — the deviation.** The spec's ACL appendix says *"Task completion for one's own assigned work requires no workflows feature."* This design **keeps** `workflows.tasks.claim` and `workflows.tasks.complete` as route `requireFeatures`. Four reasons:

1. Dropping them makes two FROZEN ACL ids grants that no route consults — precisely the "dead grants sitting in role configs" failure this document is asked to prevent, and BC §10 forbids removing them to clean up.
2. Both are seeded to `employee`, so no real tenant is blocked by keeping them.
3. The spec sentence's actual purpose is portal parity — a portal user must not need a backoffice feature. That is served by the **new portal routes** with `portal.tasks.*` (§7), which is what §6.4's own portal paragraph mandates ("new API surface, not a rule tweak"). Relaxing the backoffice routes is not needed to achieve it.
4. Keeping them preserves an auditable per-tenant "who may work tasks at all" switch.

The narrowing §6.4 actually demands still lands in full: holding `workflows.tasks.complete` no longer lets you complete *anyone's* task, only your own. **Needs a maintainer nod** because it deviates from an approved spec sentence; if it is refused, the alternative is to drop the two features from `requireFeatures`, mark them `@deprecated` in `acl.ts` with a pointer to the predicate, and accept two dead grants — say so in the UPGRADE_NOTES rather than leaving it silent.

---

## 6. The tenant opt-out

### 6.1 Shape

- Module `workflows`, key **`task_permissions_business_context`**, boolean, **default `true`**.
- Stored via `moduleConfigService` (`packages/core/src/modules/configs/lib/module-config-service.ts`), `ConfigScope { tenantId }` only — never organization-scoped. A per-org opt-out would let one org inside a tenant be wide-open while another is narrow, which is unreviewable.
- Key format is fine under `moduleConfigKeySchema` (`name` ≤ 128 chars).
- Route `packages/core/src/modules/workflows/api/task-settings.ts`, copied field-for-field from `packages/core/src/modules/entities/api/entity-settings.ts`: `metadata` with **per-method** features (`GET: ['workflows.tasks.view_all']`, `PUT: ['workflows.tasks.manage']`), `tenantId` taken from `auth.tenantId` and **never from the body**, zod-validated `PUT` body, exported `openApi`.
- **One deliberate difference from the exemplar:** `entity-settings.ts:40-42` swallows read errors and returns the permissive default. Here the read must default to `true` on failure — see §2.3.
- Read once per request in the route/service layer and passed into the predicate as `policy`. Never read inside the pure module.

### 6.2 What it restores — exactly

**When `false`, and only this:**

- The **read filter** on `GET /api/workflows/tasks`, `GET /api/workflows/tasks/[id]` and `GET /api/workflows/work-inbox` reverts to the pre-change behavior: `SCOPE ∧ hasFeature(granted, 'workflows.tasks.view')`. Same rows as today, same `myTasks`/`myWork` opt-in narrowing.
- The entity AND-gate is skipped on those reads.
- The record-page pending-work widget and the workload aggregate follow the same read filter (they are the same projection).

**When `false`, none of this changes:**

- `actable`/`claimable` are computed by the new rule, always. Completing still requires being the assignee or claimant; claiming still requires role overlap and an unclaimed `PENDING` row; the atomic conditional claim stays atomic.
- Tenant and organization scoping. `denied:tenant` is never reachable by a setting.
- The A2/A3-class handler checks (`claimUserTask` role-membership, `completeUserTask` claimant check) stay armed.
- **The portal routes never consult the flag at all.** They are new surface with no legacy behavior to restore; a portal principal's visibility is always §7's rule.
- `workflows.tasks.reassign` / `.manage` gating.

The one-line summary for the reviewer: *the opt-out is a `SELECT` filter, not an authorization mode.* If a code path reads `businessContextEnabled` anywhere outside the list/detail read filter, that is a review failure.

### 6.3 Lifecycle

State in UPGRADE_NOTES that the flag is a **migration aid with a removal date**: it exists for one minor release so a tenant with an unusual role topology can keep the lights on while they grant `workflows.tasks.view_all`, and it is removed in the release after. A permanent opt-out is a permanent second security model to test.

---

## 7. Portal principals

### 7.1 The `assignee_kind` column

```
user_tasks.assignee_kind  varchar(20)  NOT NULL  DEFAULT 'user'
```

- **Values:** `'user'` (`assigned_to` names a backoffice user id) and `'customer'` (`assigned_to` names a `CustomerAuthContext.sub`). Additive under BC §8 ("MAY add new columns with defaults").
- **Existing rows** backfill to `'user'`, which is correct — every `assigned_to` written before this change is a backoffice user id. Rows with `assigned_to IS NULL` also get `'user'`; harmless, because every branch that reads `assigneeKind` first checks `assignedTo != null`.
- **Chosen over `NULL`-able** so the predicate never coalesces; the discriminator exists precisely to remove ambiguity, and reintroducing a null case defeats it.
- **Chosen over a `customer:<id>` string prefix** (maintainer decision) — a prefix is unindexable, silently collides with any id that happens to contain a colon, and would require every existing comparison (`assignedTo: auth.sub` in the claim filter, the `myWork` `$or`, the reassign write) to learn a parsing rule.
- **`assignedToRoles` is never used with `assignee_kind = 'customer'`.** Portal roles are a different namespace (`CustomerRole`), and portal principals cannot claim from a queue in Phase 4b. Enforce it at task creation and assert it in a unit test.

### 7.2 How the predicate branches

```
if principal.kind == 'portal':
    if task.tenantId != principal.tenantId          → denied:tenant           (404)
    if task.organizationId != principal.organizationId → denied:organization  (404)
    if task.assigneeKind != 'customer'              → denied:portal-wrong-assignee-kind (404)
    if task.entityBindings is empty                 → denied:portal-unbound   (404)
    ownershipOk = task.entityBindings.every(b => principal.ownedRecordIds.has(b.entityId))
    if not ownershipOk                              → denied:portal-not-owner (404)

    if task.assignedTo == principal.principalId
        → visible, actable        reason 'portal-assignee'
    if principal.isPortalAdmin
        → visible, NOT actable    reason 'portal-company-admin'
    → denied:portal-not-owner
```

Note the order: **every structural and ownership gate runs before any feature or admin consideration.** `isPortalAdmin` is consulted last and only to widen `visible`, never `actable` and never ownership.

### 7.3 The `isPortalAdmin` trap, and how the predicate avoids it

The trap is real and worse than the briefing states. Two independent wildcards:

- `packages/core/src/modules/customer_accounts/lib/customerAuth.ts:80` — `return { valid: true, resolvedFeatures: acl.isPortalAdmin ? ['*'] : acl.features }`. A portal admin's feature list is literally `['*']`; their real grants are *replaced*, not extended.
- `packages/core/src/modules/customer_accounts/services/customerRbacService.ts:132` — `if (acl.isPortalAdmin) return true` short-circuits `userHasAllFeatures` **before** any matching. So `requireCustomerFeature(auth, ['portal.tasks.view'], rbac)` passes for a portal admin unconditionally.

Therefore: **a feature check can never be part of the portal ownership decision.** Four independent defences:

1. **The predicate never reads `grantedFeatures` on the portal branch.** The portal principal type does not even carry a feature array — only `ownedRecordIds` and the `isPortalAdmin` boolean. A wildcard cannot satisfy a `Set.has`.
2. **Ownership is a data comparison against `ownedRecordIds`**, which the route builds from `auth.customerEntityId` / `auth.personEntityId` and — for a portal admin only — the company member ids resolved with the exact `portal/users.ts` filter (`{ customerEntityId: auth.customerEntityId, tenantId: auth.tenantId, deletedAt: null }`, `api/portal/users.ts:38-52`), including its hard precondition `if (!auth.customerEntityId) → 403 'No company association'` (`:27-29`). No company association ⇒ empty set ⇒ nothing visible.
3. **`assignee_kind = 'customer'` is a structural filter in the SQL**, so a backoffice task is not in the portal result set at all, independent of the predicate.
4. **The unbound-task rule denies first**, so a portal admin with `['*']` still cannot see a single legacy backoffice task — those all have zero bindings.

Also note: `customerEntityId` / `personEntityId` are **JWT claims read straight off the token** (`customerAuth.ts:134-135`), not re-verified per request. A user moved between companies keeps stale ownership until their token turns over. Session revocation (`assertSessionStillActive`, fail-closed at `:30-34`) covers the deliberate case; the company-move case is a review checklist item (§9, item 8).

### 7.4 New portal surface

- Features `portal.tasks.view` / `portal.tasks.complete`, seeded from the **workflows** `setup.ts` `defaultCustomerRoleFeatures` (`packages/shared/src/modules/setup.ts:66`; merged by `customer_accounts.seedDefaults` → `ensureDefaultCustomerRoleAcls`, `customer_accounts/setup.ts:144-182`). The id space is free — a repo-wide grep for `portal.tasks` returns zero hits. Caveat found during research: **no shipped module declares `defaultCustomerRoleFeatures` today**, and the merge is additive-into-existing-roles only (`if (!role) continue`), so workflows would be the first real consumer — budget for that and test it.
- Routes `GET /api/workflows/portal/tasks`, `GET …/[id]`, `POST …/[id]/complete`. `requireCustomerAuth` → `requireCustomerFeature` (singular, the API helper at `customerAuth.ts:152` — not the plural page-metadata field) → the §7.2 predicate. `metadata = { requireAuth: false }` per the portal convention; export `openApi` from every route.
- 🔴 **Ask-First:** `customer_accounts/AGENTS.md:19` — *"Ask before changing … portal RBAC semantics."* New portal features + new portal routes land squarely there. This is unavoidable and already known; get the nod before the portal step starts.
- `CustomerRbacService` caches ACLs for 5 minutes (`customerRbacService.ts:24`, `cacheTtlMs = 5 * 60 * 1000`). A grant rollout is not immediate; note it in the runbook so nobody debugs a working system for five minutes.

---

## 8. Migration & backward compatibility

### 8.1 The BC status, stated plainly

**`BACKWARD_COMPATIBILITY.md` has no rule for changing the auth semantics of an already-shipped route.** Grepped exhaustively — no section, no bullet, no classification-table row. Do not invent one and do not claim coverage. The nearest applicable rules:

- `:3` — *"Every surface listed below is a **public contract**. Changes to these surfaces MUST follow the deprecation protocol or they are **breaking changes** that block merge."*
- `:9` (protocol step 3) — *"keep the old behavior alongside the new one for at least one minor version."* → **the tenant opt-out is the bridge that discharges this**, and it is why the opt-out is not optional even though it will be used by nobody.
- §7 API routes (STABLE), `:150-159` — URL, method and response fields are all unchanged here (`serializeUserTask` is already a documented superset). *"MAY add new API routes freely"* covers the portal routes, the reassign route and the settings route.
- §10 ACL (FROZEN), `:185-191` — *"MUST NOT rename an existing feature ID · MUST NOT remove an existing feature ID without a data migration · MAY add new feature IDs freely."* We add three and remove none. Re-gating a route onto a new id functionally revokes access without removing an id — the letter is satisfied, the spirit is what the security review is for.
- §8 DB (ADDITIVE-ONLY), `:161-174` — `assignee_kind` (defaulted) and `entity_types` (nullable) both qualify.
- §12, `:226` — the one explicit "do not repurpose security semantics" rule in the repo, scoped only to `AiAgentMutationPolicy`. Cite it as the *closest precedent for the norm*, not as governing text.

**Practical read:** hardening a route is neither forbidden nor blessed. It ships as an intentional, documented behavior change with the full package — spec section, UPGRADE_NOTES entry, opt-out bridge, dedicated security review. It also means the *spec* is the only place this rule is written down. **Recommendation: add a 14th contract-surface category to `BACKWARD_COMPATIBILITY.md` — "Route authorization semantics (DOCUMENTED-CHANGE)"** — requiring, for any change to which principals a shipped route admits: a spec section, an UPGRADE_NOTES entry, an opt-out or dual-path bridge for ≥1 minor, and a named reviewer. That is a contract-surface addition and therefore its own Ask-First; propose it, do not just do it.

### 8.2 What a deploying tenant actually observes

| Population | Before | After |
|---|---|---|
| Tenant `admin` (`workflows.*`) | sees all tasks | **unchanged** — the wildcard matches `workflows.tasks.view_all` |
| Superadmin | sees all | **unchanged** |
| `employee` who is an assignee / role-queue member | sees all tasks in the org | **sees only their own + their role queues.** This is the headline change and the one support tickets will be about. |
| `employee` who is *not* assigned anything | sees all tasks in the org | **sees an empty inbox** |
| Anyone completing someone else's task | possible (A3) | **refused** |
| Anyone claiming a task whose roles they do not hold | possible | **refused** |
| Cross-tenant task id on claim | mutated the row, then 500'd (A2) | **404** |
| Disposition tasks | visible to `workflows.tasks.view` holders | visible to `agent_orchestrator.proposals.view` holders (the seeded `admin`/`employee`/`operator`/`engineer` roles) |
| Notification deep link to your own task | works | **works** (single-task read is relationship-based) |
| Portal users | no task surface at all | new portal task pages/routes; can see and complete tasks bound to their own records |
| Pre-Phase-4 rows (zero bindings) | — | entity gate is a **no-op**; only the assignment gate applies |
| Tenants that flip the opt-out | — | legacy read filter restored; act path stays narrowed |

### 8.3 UPGRADE_NOTES entry (drop-in text, under `## 0.6.6 → 0.6.7 (unreleased)`)

```markdown
### Workflows: task visibility is now assignment + entity access (security-semantics change)

**Who is affected:** every tenant with workflow user tasks. **This change is ON by default.**

Until this release, any user holding `workflows.tasks.view` could list and read **every**
user task in their organization — including other people's work and agent-disposition rows
carrying proposal payloads — and any user holding `workflows.tasks.complete` could complete
**anyone's** task. As of this release (spec `.ai/specs/2026-07-26-workflows-ux-redesign.md`
§6.4), a task is visible and actionable only to a principal who

1. is the assignee, holds the task's claim, or holds one of its assigned roles — **and**
2. passes an access check on every entity the task is bound to (entity-*type* view feature
   plus tenant/organization scope; there is no record-level ACL in the platform and this
   change does not add one).

**What you need to do**

- **Nothing, if you use the seeded roles.** `admin` holds `workflows.*`, which matches the
  three new administration features automatically. `employee` keeps its own work.
- **Grant `workflows.tasks.view_all`** to any role whose members need to see other people's
  tasks (supervisors, support, the manager workload view). Then run
  `yarn mercato auth sync-role-acls`.
- **Grant `workflows.tasks.reassign`** to roles that must move work between people. This is
  now the only supported way to act on someone else's task: an administrator with
  `view_all` can *see* a task but cannot complete it — they reassign it to themselves
  first, with a mandatory reason, and the move is audited.
- **Grant `workflows.tasks.manage`** for force-unclaim, cancel, bulk operations and the
  tenant setting below.
- **Check any custom role that receives task assignments** still holds `workflows.view_tasks`
  (the Work Inbox page) and `workflows.tasks.view` (the task API). Both are in the seeded
  `employee` grant; a hand-built role may be missing them.

**New ACL features (additive):** `workflows.tasks.view_all`, `workflows.tasks.reassign`,
`workflows.tasks.manage`. **No feature id was renamed or removed.** `workflows.view_tasks`
still gates the task pages; `workflows.tasks.view` still gates the task API and is now the
dependency root of the three new features — it admits you to the API, and the visibility rule
decides which rows you get.

**Escape hatch (temporary).** Set the tenant setting `task_permissions_business_context` to
`false` (module `workflows`, `PUT /api/workflows/task-settings`, requires
`workflows.tasks.manage`) to restore the **read** filter you had before. It restores reads
only: completing someone else's task, claiming a queue you do not belong to, and cross-tenant
access remain refused, and the portal task routes ignore the setting entirely. The flag is a
migration aid and will be removed one minor release from now.

**Agent-disposition tasks** (enterprise `agent_orchestrator`) are an administrative queue:
they carry no assignee by design, and are visible to principals holding
`agent_orchestrator.proposals.view` — which the seeded `admin`, `employee`, `operator` and
`engineer` roles already have.

**New portal surface.** Portal principals can now be task assignees and act on their own
bound tasks through new routes under `/api/workflows/portal/tasks` with the new
`portal.tasks.view` / `portal.tasks.complete` customer features. The backoffice task routes
were **not** loosened for portal principals; a portal token still gets 401/403 there. A portal
task with no entity binding is visible to nobody, by design.

**Schema (additive).** `user_tasks.assignee_kind varchar(20) NOT NULL DEFAULT 'user'`
discriminates a backoffice user id from a portal principal id in `assigned_to`; existing rows
backfill to `'user'`. `user_tasks.entity_types text[]` denormalizes the bound entity types so
the visibility rule is a `WHERE`, not a post-filter. No column was renamed or removed and no
API response field was dropped.

**Bugs fixed in the same release, previously exploitable:** claiming a task belonging to
another tenant wrote to that tenant's row before failing; completing did not check the
assignee; claiming did not check the caller held one of the task's assigned roles.
```

---

## 9. Security review checklist (release precondition)

Refined from the briefing's nine items into things a reviewer can tick against a file, a test name, or a query. **Every row needs a named artifact — a passing test id or a file:line — not an opinion.**

| # | Check | Evidence required |
|---|---|---|
| 1 | The predicate is a single pure function with no ORM/DI/network reachable from it, and every surface (list, detail, claim, complete, reassign, work-inbox, record widget, workload, portal) routes through it. | `lib/task-visibility.ts` imports; a grep proving no second copy of the rule; one test per surface asserting refusal. |
| 2 | Fail-closed on resolution failure: unknown entity type, missing entity-access map key, and a thrown resolver each **deny** (or 500), never admit. Explicit test for each. | `task-visibility.test.ts` cases; the route test that asserts a resolver throw does not degrade to an empty map. |
| 3 | No-bindings behavior is exactly §2.4 — vacuous-true for backoffice, deny for portal — and is asserted in both directions. | Two named tests. |
| 4 | The opt-out changes **only** the read filter. Grep proves `businessContextEnabled` is read in no other code path; a test asserts claim and complete still refuse with the flag `false`. | Grep output + 2 tests. |
| 5 | A2 and A3 regressions are fixed and covered: cross-tenant claim is a 404 with **no write**, complete refuses a non-assignee, claim refuses a caller who holds none of `assignedToRoles`, and concurrent claim is atomic. | 4 tests; the claim role-check is the one Phase 4a did **not** land — verify it exists. |
| 6 | Bound-record org scoping: reviewer has read §3.7 and signed off that per-record scope checks are out of scope, or has required them. | Written sign-off in the PR. |
| 7 | Portal: `assignee_kind='customer'` is a **SQL** filter on the portal routes; ownership is a `Set.has` against `ownedRecordIds`; the portal branch reads no feature array; a portal admin with `['*']` cannot read a task outside their company, and cannot read any unbound task. | 4 tests, incl. one that constructs `resolvedFeatures: ['*']` explicitly. |
| 8 | Portal identity staleness: `customerEntityId`/`personEntityId` are JWT claims not re-verified per request; reviewer has accepted the window or required a re-resolution. | Written sign-off; note the 5-minute `CustomerRbacService` TTL is a *separate* delay. |
| 9 | Role matching keys on `auth.roles` (names). Documented: names are server-derived (not caller-supplied, so not spoofable by the client) but tenant-mutable, so a role rename silently orphans an assignment. Follow-up issue exists for an additive `assigned_to_role_ids`. | Issue link + a comment at the comparison site. |
| 10 | `workflows.view_tasks` and `workflows.tasks.view` each still gate a real surface after the change (pages / API) and are not stored-but-unused. | The route metadata diff + the `acl-dependencies` test. |
| 11 | D-1 resolved: `workflows.tasks.claim` / `.complete` either remain on their routes (maintainer nod recorded) or are `@deprecated` with the dead-grant consequence in UPGRADE_NOTES. | PR comment with the decision. |
| 12 | 404 vs 403: cross-tenant and no-relationship refusals are indistinguishable 404s with a generic body; the only reason-bearing 403 is entity-access for a `view_all` holder. | Test asserting identical bodies for "foreign tenant id" and "random uuid". |
| 13 | Disposition tasks: a principal with `agent_orchestrator.proposals.view` still sees them; one without does not; no parked instance stalls; `dispositionService.ts` is untouched. | 3 tests + the file's git diff being empty. |
| 14 | Every new ACL id is in `acl.ts` with `dependsOn`, in `setup.ts` where intended, asserted by `acl-dependencies.test.ts`, and `yarn mercato auth sync-role-acls` is in the release runbook. | Test diff + runbook line. |
| 15 | The `admin: ['workflows.*']` wildcard genuinely matches all three new ids (nobody loses access on upgrade). | One test calling `matchFeature` with the real strings. |
| 16 | Response payloads are still supersets (BC §7) and no field was dropped by the visibility work. | `api/__tests__/serialize.test.ts` remains green plus a superset assertion. |

---

## 10. Test matrix

### 10.1 Unit — `lib/__tests__/task-visibility.test.ts` (pure, no DB)

| # | Principal | Task | Policy | Expect |
|---|---|---|---|---|
| U1 | assignee, no `workflows.*` grants | assigned to them, no bindings | on | visible, actable |
| U2 | role holder (`auth.roles` overlap) | role-assigned, unclaimed, PENDING | on | visible, actable, **claimable** |
| U3 | role holder | role-assigned, already claimed by someone else | on | visible, **not** actable, not claimable |
| U4 | `workflows.tasks.view_all` | someone else's task | on | **visible, not actable** (`administrative`) |
| U5 | `workflows.tasks.view` only, unrelated | someone else's task | on | **denied:no-relationship** |
| U6 | same as U5 | same | **off** | **visible** (`legacy-read-filter`); actable still false |
| U7 | assignee | same | off | visible, actable — opt-out never widens or narrows the act path |
| U8 | grants `['*']` | any task in tenant | on | visible (administrative); actable only if related |
| U9 | grants `['workflows.*']` | someone else's | on | visible — proves `matchFeature` covers `view_all` |
| U10 | `view_all`, lacks `customers.deals.view` | bound to `customers:customer_deal` | on | **denied:entity-access** |
| U11 | assignee, lacks `sales.orders.view` | bound to `sales:sales_order` | on | **denied:entity-access** — assignment does not bypass the entity gate |
| U12 | assignee | binding `entityType: 'Custmers:Deal'` (typo) | on | **denied:unknown-entity-type** |
| U13 | assignee, holds one of two required types | two bindings | on | denied — `every`, not `some` |
| U14 | `agent_orchestrator.proposals.view` | unassigned disposition task, no bindings | on | visible (`administrative-queue`), not actable |
| U15 | `workflows.tasks.view` only, no orchestrator grant | same | on | **denied:no-relationship** |
| U16 | any backoffice principal | task in another **tenant** | on **and** off | **denied:tenant** both ways |
| U17 | operator with `organizationIds: ['A']` | task in org B, same tenant | on | **denied:organization** |
| U18 | operator with `organizationIds: null` | any org in tenant | on | passes SCOPE |
| U19 | portal principal | `assigneeKind: 'customer'`, `assignedTo` = them, binding = own `customerEntityId` | on | visible, actable (`portal-assignee`) |
| U20 | portal principal | same but **no bindings** | on | **denied:portal-unbound** |
| U21 | portal principal | binding = another customer's record id | on | **denied:portal-not-owner** |
| U22 | portal principal | `assigneeKind: 'user'` (a backoffice task) | on | **denied:portal-wrong-assignee-kind** |
| U23 | **portal admin**, `resolvedFeatures: ['*']`, `isPortalAdmin: true` | backoffice task, no bindings | on | **denied** — the wildcard buys nothing |
| U24 | portal admin | task bound to a company-member record (`ownedRecordIds` contains it) | on | visible, **not actable** (`portal-company-admin`) |
| U25 | portal admin with **no** `customerEntityId` (empty `ownedRecordIds`) | any portal task | on | denied |
| U26 | portal principal | task in another tenant | on | **denied:tenant** |
| U27 | any | entity-access map missing the task's type key | on | **denied** (missing key ≠ pass) |

### 10.2 Unit — filter builder & routes

- `buildTaskVisibilityFilter` emits the tenant + org + `$or` relationship clause; administrative callers get no relationship clause; the unassigned-queue arm appears only with the queue feature; the D-2 `entity_types <@` fragment appears only when the caller's allowed set is finite.
- The four `api/tasks/**` routes (route tests exist as of Phase 4a — extend, do not create): list excludes unrelated rows; detail returns 404 for unrelated; claim refuses a non-role-holder; complete refuses a non-assignee.
- Settings route: `PUT` writes tenant-scoped, `tenantId` comes from auth even when the body supplies one; read failure defaults to `true`.

### 10.3 Integration (`__integration__/`, self-contained fixtures, `try/finally` teardown)

- Extend **TC-WF-023** (claim/complete) and **TC-WF-028** (RBAC gates) — TC-WF-028's header documents the current preconditions and must be rewritten.
- New spec: (a) a non-assignee holding `workflows.tasks.view` no longer sees the task; (b) an assignee holding `workflows.tasks.view` + `.complete` and nothing else sees and completes it; (c) the opt-out restores legacy read visibility and still refuses a foreign complete; (d) a portal principal completes their own bound task and gets nothing for an unbound one; (e) a portal token gets 401/403 on the backoffice task routes.
- Cross-tenant: claim a foreign task id → 404, and assert **the foreign row is unmodified** afterwards.
- Disclosure: foreign-tenant id and random uuid return byte-identical bodies.
- ⚠️ `.ai/tmp/**` is excluded from Playwright discovery (`.ai/qa/tests/playwright.config.ts:19`) — specs written in the phase-4 worktree are not picked up by the repo-root runner.

### 10.4 Playwright

- Supervisor with `view_all` sees a colleague's task, the complete button is **absent**, reassign-to-self then completes.
- Assignee opens a notification deep link and completes without ever loading the inbox list.

---

## 11. Implementation steps (PLAN.md rows, dependency order)

Sizes: S ≈ ½ day, M ≈ 1–2 days, L ≈ 3–5 days.

| # | Step | Size | Depends on |
|---|---|---|---|
| 1 | Land Phase 4a first (`feat/workflows-ux-phase4` steps 2.4 → 4.2). Everything below assumes `entity_bindings`, `assignee`-aware serializer, `taskHandler` DI, the atomic claim, and the work-inbox provider are merged. | — | — |
| 2 | **Prerequisite defect:** `claimUserTask` verifies the caller holds one of `assignedToRoles` (the one A2-family gap Phase 4a left). Regression tests for foreign-tenant claim leaving the row unmodified, non-role-holder refusal, atomic double-claim. | S | 1 |
| 3 | Extract `classifyRecordsEntity` from `entities/api/records.ts` to `entities/lib/entityClassification.ts`; re-export from `records.ts`; behavior-identical test. | S | — |
| 4 | `lib/task-entity-types.ts` — `normalizeTaskEntityTypeToEntityId`, sharing one alias dictionary with `lib/work-inbox/entity-links.ts` + a sync test. | S | 3 |
| 5 | `lib/task-visibility.ts` — the pure predicate and `buildTaskVisibilityFilter`, with the full §10.1 matrix. **No call sites yet.** | M | 4 |
| 6 | `lib/task-entity-access.ts` — the impure per-request `TaskEntityAccessMap` resolver (one ACL load, one classification pass). | M | 3, 5 |
| 7 | ACL: three new features in `acl.ts` with `dependsOn`; `__tests__/acl-dependencies.test.ts` dependency table updated; `setup.ts` unchanged; runbook line for `yarn mercato auth sync-role-acls`. | S | — |
| 8 | Tenant setting: `api/task-settings.ts` (GET/PUT, `moduleConfigService`, fail-to-`true`), route tests, i18n strings. | S | 7 |
| 9 | Migration: `user_tasks.assignee_kind` (NOT NULL DEFAULT `'user'`) + `entity_types text[]` + GIN index; entity update; reviewed SQL + `.snapshot-open-mercato.json`. **Never run `yarn db:migrate`.** Task creation writes both. | M | 1 |
| 10 | Wire the predicate into the backoffice read surfaces: `GET /api/workflows/tasks`, `GET /api/workflows/tasks/[id]`, `GET /api/workflows/work-inbox`, `buildUserTaskWorkInboxWhere`, the pending-work widget, the workload aggregate. Includes the 404-vs-403 policy. | L | 5, 6, 8, 9 |
| 11 | Wire the act surfaces: claim, unclaim, complete — predicate `actable`/`claimable` in the handler; keep `requireFeatures` per D-1 (or apply the fallback if D-1 is refused). | M | 10 |
| 12 | `POST /api/workflows/tasks/[id]/reassign` behind `workflows.tasks.reassign`: audit columns + `WorkflowEvent`; optimistic-lock header (`buildOptimisticLockHeader` / `surfaceRecordConflict`) — `UserTask` is not in the curated editable-entity list and a `PUT/PATCH` UI trips `optimistic-lock-ui-coverage.test.ts`. | M | 11 |
| 13 | `administrativeQueueFeature?: string` on `WorkInboxSourceProvider` + the unassigned-queue arm; enterprise registers the `agent_disposition` source from its own `di.ts` declaring `agent_orchestrator.proposals.view`. **`dispositionService.ts` untouched.** | M | 10 |
| 14 | Author-time guard: Problems-panel check on USER_TASK bindings (unknown type = error, assignee-cannot-view = warning); the entity picker emits generated entity ids. | M | 4 |
| 15 | Inbox diagnostics: `hidden — entity access` marker for `view_all` holders; the separate workload bucket. | S | 10, 14 |
| 16 | 🔴 **Ask-First gate, then:** portal features `portal.tasks.*` in `defaultCustomerRoleFeatures`; `GET/POST /api/workflows/portal/tasks*`; `ownedRecordIds` resolution copying the `portal/users.ts` company filter incl. the no-company 403; `openApi` on every route. | L | 5, 9 |
| 17 | Portal pages `frontend/[orgSlug]/portal/tasks/` (+ `[id]`), portal DS, external-form renderer, `nav` block; task events marked `portalBroadcast: true` + `usePortalAppEvent` refetch. | L | 16 |
| 18 | Integration + Playwright suites (§10.3, §10.4). | L | 11, 13, 16 |
| 19 | Docs: `apps/docs/docs/user-guide/workflows/user-tasks.mdx`, `framework/workflows/*`, the §8.3 UPGRADE_NOTES entry, spec changelog. | M | 18 |
| 20 | Security review against §9 with a named reviewer; sign-off recorded on the PR. **Release precondition.** | S | 19 |
| 21 | *(Separate PR, separate Ask-First)* A7: close the disposition `UserTask` when the proposal is disposed. | M | 13 |
| 22 | *(Proposal)* `BACKWARD_COMPATIBILITY.md` category 14, "Route authorization semantics (DOCUMENTED-CHANGE)". | S | 20 |

---

## 12. Rejected alternatives, and open items

### 12.1 Rejected

| Alternative | Why not |
|---|---|
| **Entity gate as `some` binding accessible** | Leaks a sensitive record through a harmless co-binding. |
| **No-bindings ⇒ deny for backoffice too (uniform fail-closed)** | Makes the entire pre-Phase-4 corpus invisible to its own assignees. An outage, not a narrowing. |
| **`view_all` also grants act** | Destroys the audit story ("who approved this?") and removes any reason to reassign. Reassign-then-act is one extra click and a permanent record. |
| **Per-record ACL layer** | Does not exist in the platform; building one is a multi-release platform program, not a workflows phase. Explicitly out of scope (§3.1). |
| **Assign disposition tasks to a user or a role** | Enterprise cannot know tenant routing policy or role names; role names are mutable and a rename orphans it. |
| **Carve disposition tasks out on `workflows.tasks.view`** | Keeps the pre-change grant alive under a new name — re-widens exactly what the change narrows. |
| **`customer:<id>` prefix instead of `assignee_kind`** | Maintainer decision; also unindexable and forces a parsing rule into every existing comparison. |
| **Post-filter the entity gate in JS instead of D-2's column** | `total` becomes a lie and pages come back short. Kept only as the documented fallback if the migration slips. |
| **Per-organization opt-out scope** | One org wide-open next to a narrow one is unreviewable. Tenant-scoped only. |
| **Keying role matching on features instead of role names** | `loadAcl` returns `{ isSuperAdmin, features, organizations }` — **no role ids** — and `assignedToRoles` stores names throughout (Studio picker, engine, shipped `examples/*.json`, existing rows). Moving to immutable ids is a coordinated data + authored-definition migration, filed as follow-up, not smuggled into this change. |
| **Permanent tenant opt-out** | A permanent second security model to test forever. One minor release, then removed. |

### 12.2 Open items needing a maintainer decision before implementation

1. **D-1** — keep `workflows.tasks.claim` / `.complete` on their routes (§5.3), against the spec's ACL-appendix sentence.
2. **D-2** — add `user_tasks.entity_types text[]` (§2.6), or accept the post-filter fallback and its inaccurate `total`.
3. **Portal RBAC semantics** — `customer_accounts/AGENTS.md:19` Ask-First; blocks step 16.
4. **A7** — closing the disposition task touches `dispositionService.ts`, the file guarded by `agent_orchestrator/AGENTS.md:32`. The visibility model does **not** require it; it is filed as step 21 so the gate is crossed deliberately, not accidentally.
5. **BACKWARD_COMPATIBILITY.md category 14** (§8.1) — adding a contract-surface category is itself a contract change.
