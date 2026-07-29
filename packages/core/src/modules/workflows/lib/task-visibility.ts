/**
 * Who may see and act on a user task (PURE).
 *
 * Spec §6.4: *a user (backoffice or portal) can see and act on a task iff
 * (assigned, or holds an assigned role, or claims from a role queue) AND passes
 * access checks on the task's bound entities. `workflows.tasks.*` features gate
 * administration (viewing others', reassigning) — never one's own assigned
 * work.*
 *
 * Written out:
 *
 *   visible   = SCOPE ∧ (RELATIONSHIP ∨ ADMINISTRATIVE) ∧ ENTITY
 *   actable   = SCOPE ∧ RELATIONSHIP ∧ ENTITY ∧ workable(status) ∧ own-the-row
 *   claimable = actable ∧ unassigned ∧ unclaimed ∧ PENDING ∧ role overlap
 *
 * Three properties are the whole design and every change here must preserve
 * them:
 *
 * 1. **A task with no bindings passes the entity clause vacuously — for
 *    backoffice.** `[].every(...)` is `true`, and that is deliberate: every
 *    `UserTask` row written before Phase 4 carries zero bindings, so reading
 *    "no bindings ⇒ deny" would make the entire existing corpus invisible to
 *    its own assignees on upgrade. That is an outage, not a narrowing. A PORTAL
 *    principal is the mirror image: they carry no org-membership grant at all,
 *    so the binding to their own record IS the authorization and an unbound
 *    task is visible to nobody.
 * 2. **Fail-closed applies to resolution failures, never to absence of data.**
 *    An unresolvable entity type, a map key the resolver never produced, and a
 *    resolver that threw all deny. An empty binding list does not.
 * 3. **Administration widens seeing, never acting.** `workflows.tasks.view_all`
 *    and superadmin admit a principal to somebody else's row; they never make
 *    it actable. To act, an administrator reassigns it to themselves first,
 *    which is audited (`reassigned_by`/`reassigned_at`/`reassign_reason` plus a
 *    `WorkflowEvent`). That is what keeps "who approved this?" answerable.
 *
 * PURE by contract, like `lib/task-resolution.ts` and `lib/error-routing.ts`:
 * no ORM, no DI, no React, no entity registry. Everything impure — the ACL
 * load, entity classification, portal ownership expansion, the tenant setting —
 * is resolved ONCE per request by the caller and handed in as data.
 */

import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import { hasAllFeatures, hasFeature } from '@open-mercato/shared/security/features'

/** Admits a principal to the task API. Necessary, never sufficient. */
export const WORKFLOWS_TASKS_VIEW_FEATURE = 'workflows.tasks.view'

/** Administration: read rows you have no relationship to. Never grants act. */
export const WORKFLOWS_TASKS_VIEW_ALL_FEATURE = 'workflows.tasks.view_all'

/** Administration: move a row to another assignee or role queue. */
export const WORKFLOWS_TASKS_REASSIGN_FEATURE = 'workflows.tasks.reassign'

/**
 * The statuses a task can still be worked in.
 *
 * Deliberately the set `completeUserTask` accepts rather than "not terminal":
 * the handler filters on `status IN ('PENDING','IN_PROGRESS')`, so treating an
 * `ESCALATED` row as actable would render a Complete button that always fails.
 * The predicate and the handler must agree or the UI lies.
 */
export const TASK_ACTIONABLE_STATUSES: readonly string[] = ['PENDING', 'IN_PROGRESS']

export type BackofficeTaskPrincipal = {
  kind: 'backoffice'
  userId: string
  tenantId: string
  /** `null` = unrestricted operator (`resolveOrganizationScopeFilter` → `where: {}`). */
  organizationIds: readonly string[] | null
  /** `auth.roles` — role NAMES, server-derived, never client-supplied. */
  roleNames: readonly string[]
  /** `rbacService.getGrantedFeatures(...)` — MAY contain `'*'` / `'workflows.*'`. */
  grantedFeatures: readonly string[]
  isSuperAdmin: boolean
}

export type PortalTaskPrincipal = {
  kind: 'portal'
  /** `CustomerAuthContext.sub`. */
  principalId: string
  tenantId: string
  organizationId: string
  /**
   * Record ids this principal may legitimately be the subject of. For a plain
   * portal user: `{customerEntityId, personEntityId}` minus nulls. For a portal
   * admin: the same PLUS every company-member record id, resolved once per
   * request by the route — never by this module.
   */
  ownedRecordIds: ReadonlySet<string>
  isPortalAdmin: boolean
}

export type TaskPrincipal = BackofficeTaskPrincipal | PortalTaskPrincipal

export type TaskEntityBindingFact = { entityType: string; entityId: string }

/**
 * Per-entity-type answer to "may this principal view records of this type at
 * all", produced once per request by `lib/task-entity-access.ts`.
 *
 * A tagged union rather than the design's `string[] | null`, because that shape
 * cannot tell `denied:unknown-entity-type` (the authored type does not resolve
 * to any entity id — an author's typo) from `denied:entity-access` (it resolves
 * fine, but the caller may not view that type, or the platform has no rule for
 * it). §2.3 and §2.7 both need those apart: the first is a definition bug the
 * Problems panel should flag, the second is a policy decision an administrator
 * is told about. Both still deny.
 *
 * `requires` carries the REQUIRED features, not a verdict, so the wildcard-aware
 * match happens here in the one place that decides anything.
 */
export type TaskEntityAccessDecision =
  | { kind: 'requires'; features: readonly string[] }
  | { kind: 'unknown-entity-type' }
  | { kind: 'unavailable' }

/** Keyed by the binding's AUTHORED `entityType`, verbatim — see `resolveTaskEntityAccess`. */
export type TaskEntityAccessMap = ReadonlyMap<string, TaskEntityAccessDecision>

export type TaskFacts = {
  id: string
  tenantId: string
  organizationId: string
  status: string
  assignedTo: string | null
  /** `'user'` = `assignedTo` names a backoffice user; `'customer'` = a portal principal. */
  assigneeKind: 'user' | 'customer'
  assignedToRoles: readonly string[] | null
  claimedBy: string | null
  entityBindings: readonly TaskEntityBindingFact[]
  /**
   * ACL feature that admits a principal to this row when it is an UNASSIGNED
   * administrative queue item rather than personal work — declared by the work
   * inbox source that produced it (`WorkInboxSourceProvider.administrativeQueueFeature`).
   * Absent falls back to core's own `workflows.tasks.view_all`.
   */
  administrativeQueueFeature?: string | null
}

export type TaskVisibilityPolicy = {
  /** Tenant opt-out. `true` = the §6.4 model (default). `false` = legacy read filter. */
  businessContextEnabled: boolean
}

export type TaskVisibilityReason =
  // admits
  | 'assignee'
  | 'claimant'
  | 'role-queue'
  | 'administrative'
  | 'administrative-queue'
  | 'legacy-read-filter'
  | 'portal-assignee'
  | 'portal-company-admin'
  // refusals
  | 'denied:tenant'
  | 'denied:organization'
  | 'denied:no-relationship'
  | 'denied:entity-access'
  | 'denied:unknown-entity-type'
  | 'denied:portal-unbound'
  | 'denied:portal-not-owner'
  | 'denied:portal-wrong-assignee-kind'

export type TaskVisibilityDecision = {
  visible: boolean
  /** May complete / decide this task. */
  actable: boolean
  /** May claim it off a role queue. A refinement of `actable`, never wider. */
  claimable: boolean
  reason: TaskVisibilityReason
  /**
   * The binding that failed the entity clause, when one did.
   *
   * Set on refusals, where it powers the `view_all`-only 403-with-reason
   * diagnostic — a task hidden by the entity gate must never disappear without
   * trace. Also set on the `legacy-read-filter` ADMIT, which is the one path
   * that shows a row whose entity clause failed: the opt-out restores the read
   * and nothing else, so the act surfaces need to see that the gate is still
   * closed underneath.
   */
  blockedEntityType?: string
}

function deny(reason: TaskVisibilityReason, blockedEntityType?: string): TaskVisibilityDecision {
  return blockedEntityType
    ? { visible: false, actable: false, claimable: false, reason, blockedEntityType }
    : { visible: false, actable: false, claimable: false, reason }
}

/**
 * Both sides are role NAMES, not ids.
 *
 * `assignedToRoles` holds what the Studio picker wrote, and `roleNames` is
 * `auth.roles`, derived server-side from the session — so a client cannot forge
 * membership by claiming a role. Names are tenant-MUTABLE, though: renaming a
 * role silently orphans every assignment authored against the old name, and
 * this comparison is where that shows up. Moving to immutable ids needs a
 * coordinated data + authored-definition migration (`loadAcl` returns no role
 * ids today, so changing only this side would match nothing); it is tracked as
 * a follow-up and stated in `framework/workflows/task-visibility.mdx` →
 * Known Limits.
 */
function hasRoleOverlap(
  taskRoles: readonly string[] | null,
  roleNames: readonly string[],
): boolean {
  if (!taskRoles || taskRoles.length === 0 || roleNames.length === 0) return false
  const held = new Set(roleNames)
  return taskRoles.some((role) => held.has(role))
}

/** No assignee, no claimant and no role queue — nobody's personal work. */
function isUnassignedQueueItem(task: TaskFacts): boolean {
  return (
    task.assignedTo === null &&
    task.claimedBy === null &&
    (task.assignedToRoles === null || task.assignedToRoles.length === 0)
  )
}

type EntityClauseResult =
  | { ok: true }
  | { ok: false; reason: 'denied:entity-access' | 'denied:unknown-entity-type'; entityType: string }

/**
 * `every`, not `some`: a task bound to a sensitive deal AND a harmless customer
 * must not leak through the harmless one. The cost is real — a legitimately
 * assigned worker can be blinded by a binding they cannot see — and is paid for
 * by the author-time Problems check and the `denied:entity-access` diagnostic
 * rather than by weakening the rule.
 */
function evaluateEntityClause(
  principal: BackofficeTaskPrincipal,
  task: TaskFacts,
  entityAccess: TaskEntityAccessMap,
): EntityClauseResult {
  // Mirrors `assertEntityAclForRequest`'s own `if (acl?.isSuperAdmin) return`.
  if (principal.isSuperAdmin) return { ok: true }
  for (const binding of task.entityBindings) {
    const decision = entityAccess.get(binding.entityType)
    // A key the resolver never produced is a RESOLUTION FAILURE, never a pass.
    if (!decision) {
      return { ok: false, reason: 'denied:entity-access', entityType: binding.entityType }
    }
    if (decision.kind === 'unknown-entity-type') {
      return { ok: false, reason: 'denied:unknown-entity-type', entityType: binding.entityType }
    }
    if (decision.kind === 'unavailable') {
      return { ok: false, reason: 'denied:entity-access', entityType: binding.entityType }
    }
    if (!hasAllFeatures(principal.grantedFeatures, decision.features)) {
      return { ok: false, reason: 'denied:entity-access', entityType: binding.entityType }
    }
  }
  return { ok: true }
}

/** The queue feature that admits a principal to this row when it is unassigned. */
function administrativeQueueFeatureOf(task: TaskFacts): string {
  return task.administrativeQueueFeature ?? WORKFLOWS_TASKS_VIEW_ALL_FEATURE
}

function resolveRelationshipReason(
  principal: BackofficeTaskPrincipal,
  task: TaskFacts,
): TaskVisibilityReason | null {
  if (task.assigneeKind === 'user' && task.assignedTo === principal.userId) return 'assignee'
  if (task.claimedBy !== null && task.claimedBy === principal.userId) return 'claimant'
  if (hasRoleOverlap(task.assignedToRoles, principal.roleNames)) return 'role-queue'
  return null
}

function resolveAdministrativeReason(
  principal: BackofficeTaskPrincipal,
  task: TaskFacts,
): TaskVisibilityReason | null {
  if (principal.isSuperAdmin) return 'administrative'
  if (hasFeature(principal.grantedFeatures, WORKFLOWS_TASKS_VIEW_ALL_FEATURE)) return 'administrative'
  if (
    isUnassignedQueueItem(task) &&
    hasFeature(principal.grantedFeatures, administrativeQueueFeatureOf(task))
  ) {
    return 'administrative-queue'
  }
  return null
}

/**
 * Who owns the row right now. A claim outranks an assignment because that is
 * what `completeUserTask` enforces (`claimedBy ?? assignedTo`), and the two must
 * not disagree. `null` means the row is open, and membership in its queue is
 * then what confers the right to act.
 */
export function currentTaskOwnerId(task: TaskFacts): string | null {
  if (task.claimedBy !== null) return task.claimedBy
  if (task.assigneeKind === 'user') return task.assignedTo
  return null
}

function decideBackoffice(
  principal: BackofficeTaskPrincipal,
  task: TaskFacts,
  entityAccess: TaskEntityAccessMap,
  policy: TaskVisibilityPolicy,
): TaskVisibilityDecision {
  // Never overridden — not by superadmin, not by the tenant opt-out.
  if (task.tenantId !== principal.tenantId) return deny('denied:tenant')
  if (
    !isOrganizationAccessAllowed({
      isSuperAdmin: principal.isSuperAdmin,
      allowedOrganizationIds: principal.organizationIds,
      targetOrganizationId: task.organizationId,
    })
  ) {
    return deny('denied:organization')
  }

  const relationshipReason = resolveRelationshipReason(principal, task)
  const administrativeReason = relationshipReason
    ? null
    : resolveAdministrativeReason(principal, task)
  const admitReason = relationshipReason ?? administrativeReason

  const entity = evaluateEntityClause(principal, task, entityAccess)

  // ACT is computed by the NEW rule always — the opt-out is a SELECT filter, not
  // an authorization mode, so it can neither widen nor narrow this.
  const owner = currentTaskOwnerId(task)
  const ownsTheRow =
    owner !== null
      ? owner === principal.userId
      : hasRoleOverlap(task.assignedToRoles, principal.roleNames)
  const actable =
    entity.ok &&
    ownsTheRow &&
    task.assigneeKind === 'user' &&
    TASK_ACTIONABLE_STATUSES.includes(task.status)
  const claimable =
    actable &&
    task.assignedTo === null &&
    task.claimedBy === null &&
    task.status === 'PENDING' &&
    hasRoleOverlap(task.assignedToRoles, principal.roleNames)

  if (admitReason && entity.ok) {
    return { visible: true, actable, claimable, reason: admitReason }
  }

  // The opt-out restores the pre-change READ filter and nothing else: same rows,
  // no entity gate, act path untouched. It is additive on purpose — it must
  // never hide a row the new model would have shown.
  if (
    !policy.businessContextEnabled &&
    hasFeature(principal.grantedFeatures, WORKFLOWS_TASKS_VIEW_FEATURE)
  ) {
    return {
      visible: true,
      actable,
      claimable,
      reason: 'legacy-read-filter',
      // Reported even though the row is admitted: the read came back, the entity
      // gate did not, and an act surface must be able to tell the difference.
      ...(entity.ok ? {} : { blockedEntityType: entity.entityType }),
    }
  }

  // No relationship and no administrative grant discloses less than an entity
  // refusal does, so it is reported first: a caller with no legitimate knowledge
  // that the row exists learns nothing about which entity blocked them.
  if (!admitReason) return deny('denied:no-relationship')
  if (!entity.ok) return deny(entity.reason, entity.entityType)
  return deny('denied:no-relationship')
}

function decidePortal(principal: PortalTaskPrincipal, task: TaskFacts): TaskVisibilityDecision {
  if (task.tenantId !== principal.tenantId) return deny('denied:tenant')
  if (task.organizationId !== principal.organizationId) return deny('denied:organization')
  // Structural: a backoffice task is not portal work, whatever the caller holds.
  if (task.assigneeKind !== 'customer') return deny('denied:portal-wrong-assignee-kind')
  // A portal principal carries no org-membership grant, so an unbound task has
  // nothing tying it to them. Denying is the only correct answer, and it is what
  // keeps every legacy (binding-free) backoffice row out of the portal.
  if (task.entityBindings.length === 0) return deny('denied:portal-unbound')

  // A data comparison, never a feature check: `isPortalAdmin` resolves to `['*']`
  // in `customerAuth.ts` and short-circuits `userHasAllFeatures`, so a wildcard
  // must not be able to satisfy ownership. A `Set.has` cannot be wildcarded.
  const ownsEveryBinding = task.entityBindings.every((binding) =>
    principal.ownedRecordIds.has(binding.entityId),
  )
  if (!ownsEveryBinding) return deny('denied:portal-not-owner')

  if (task.assignedTo === principal.principalId) {
    const actable = TASK_ACTIONABLE_STATUSES.includes(task.status)
    return { visible: true, actable, claimable: false, reason: 'portal-assignee' }
  }

  // Consulted LAST, and only to widen seeing — a company admin reads their
  // members' work, they never complete it.
  if (principal.isPortalAdmin) {
    return { visible: true, actable: false, claimable: false, reason: 'portal-company-admin' }
  }

  return deny('denied:portal-not-owner')
}

/**
 * The one decision point. Every surface — list, detail, claim, unclaim,
 * complete, reassign, work inbox, the record-page pending-work widget, the
 * workload aggregate and the portal routes — routes through this function. A
 * second copy of the rule anywhere is a review failure.
 */
export function decideTaskVisibility(
  principal: TaskPrincipal,
  task: TaskFacts,
  entityAccess: TaskEntityAccessMap,
  policy: TaskVisibilityPolicy,
): TaskVisibilityDecision {
  if (principal.kind === 'portal') return decidePortal(principal, task)
  return decideBackoffice(principal, task, entityAccess, policy)
}

/**
 * The statuses `reassignUserTask` accepts (`lib/task-handler.ts`
 * `REASSIGNABLE_STATUSES`). Restated here because this module is PURE and the
 * handler is not; the two must agree or the Reassign button lies.
 */
export const TASK_REASSIGNABLE_STATUSES: readonly string[] = ['PENDING', 'IN_PROGRESS']

/**
 * The status `releaseUserTask` accepts. It looks the row up with
 * `status: 'IN_PROGRESS'`, so a PENDING row is `TASK_NOT_FOUND` there — which is
 * narrower than `TASK_ACTIONABLE_STATUSES` and must not be widened to it.
 */
export const TASK_RELEASABLE_STATUS = 'IN_PROGRESS'

/**
 * Why an act surface is closed to a caller who CAN read the row.
 *
 * Every value here is derivable from fields the caller already has in the same
 * response (`status`, `assignedTo`, `claimedBy`, `assignedToRoles`), so naming
 * the reason discloses nothing the payload does not. The one deliberate
 * exception is `unavailable`, below.
 */
export type TaskActionBlockReason =
  /** Terminal status — the handler answers `TASK_NOT_FOUND`. */
  | 'not-workable'
  /** Somebody else is the assignee or the claimant — a 409 on click. */
  | 'owned-by-another'
  /** Open, but queued to a role the caller does not hold. */
  | 'not-in-your-queue'
  /** Nobody's work: no assignee, no claim, no queue — `TASK_NOT_ACTIONABLE`. */
  | 'unowned'
  /**
   * Refused without a reason, on purpose.
   *
   * Reachable only under the tenant opt-out, which restores the READ and never
   * the act path: the row comes back with `blockedEntityType` set and the act
   * routes answer a bare 404 for it, because "the entity gate blocked you" names
   * a binding the gate has just refused this caller. The UI must be exactly as
   * uninformative — it says the action is unavailable and stops there.
   */
  | 'unavailable'

/**
 * What the page may OFFER, decided here so no client re-derives §6.4.
 *
 * These are booleans, not features: a `workflows.tasks.view_all` administrator
 * holds `workflows.tasks.complete` and still gets `canComplete: false`, because
 * administration widens seeing and never acting. Each flag mirrors the gate its
 * own endpoint applies (`resolveTaskActRefusal` for complete/claim/release,
 * visibility + the reassign feature for reassign), so an offered action is one
 * the server will accept.
 */
export type TaskAffordances = {
  canComplete: boolean
  canClaim: boolean
  canRelease: boolean
  canReassign: boolean
  /** Why `canComplete` is false, for a caller who can read the row. */
  actBlockedReason: TaskActionBlockReason | null
}

/**
 * Resolve the act surfaces for one already-decided row.
 *
 * PURE, and deliberately a projection of `decideTaskVisibility`'s own answer
 * rather than a second evaluation of the rule: `canComplete` IS `actable` and
 * `canClaim` IS `claimable`. Only `canRelease` and `canReassign` add anything,
 * and each adds exactly the one condition its endpoint checks beyond visibility.
 */
export function resolveTaskAffordances(
  principal: BackofficeTaskPrincipal,
  task: TaskFacts,
  decision: TaskVisibilityDecision,
): TaskAffordances {
  // Set on the `legacy-read-filter` ADMIT: the opt-out restored the read and the
  // entity gate is still shut underneath, so every act route answers 404.
  const entityGateClosed = decision.blockedEntityType !== undefined
  const actSurfaceOpen = decision.visible && !entityGateClosed

  const canComplete = decision.visible && decision.actable
  const canClaim = decision.visible && decision.claimable
  const canRelease =
    actSurfaceOpen && task.status === TASK_RELEASABLE_STATUS && task.claimedBy === principal.userId
  const canReassign =
    actSurfaceOpen &&
    TASK_REASSIGNABLE_STATUSES.includes(task.status) &&
    (principal.isSuperAdmin ||
      hasFeature(principal.grantedFeatures, WORKFLOWS_TASKS_REASSIGN_FEATURE))

  return {
    canComplete,
    canClaim,
    canRelease,
    canReassign,
    actBlockedReason: resolveActBlockReason(principal, task, decision, {
      canComplete,
      entityGateClosed,
    }),
  }
}

/**
 * Mirrors `resolveTaskActRefusal`'s precedence exactly — entity gate, then
 * status, then ownership — so the stated reason and the refusal a click would
 * produce can never disagree.
 */
function resolveActBlockReason(
  principal: BackofficeTaskPrincipal,
  task: TaskFacts,
  decision: TaskVisibilityDecision,
  state: { canComplete: boolean; entityGateClosed: boolean },
): TaskActionBlockReason | null {
  if (state.canComplete) return null
  if (!decision.visible) return null
  if (state.entityGateClosed) return 'unavailable'
  if (!TASK_ACTIONABLE_STATUSES.includes(task.status)) return 'not-workable'

  const owner = currentTaskOwnerId(task)
  if (owner !== null) return owner === principal.userId ? 'unavailable' : 'owned-by-another'
  if (task.assignedToRoles !== null && task.assignedToRoles.length > 0) return 'not-in-your-queue'
  return 'unowned'
}

export type TaskVisibilityFilterOptions = {
  /**
   * Queue feature for the source being filtered, when it is not core's own
   * `workflows.tasks.view_all`. Supplying it adds the unassigned-queue arm.
   */
  administrativeQueueFeature?: string | null
}

/**
 * The RELATIONSHIP ∨ ADMINISTRATIVE half of the rule as ORM conditions, for
 * pushing onto an existing `$and` array (`buildUserTaskWorkInboxWhere` composes
 * independent `$or` groups exactly this way).
 *
 * Returns `[]` when the caller may read everything in scope — an administrator,
 * a superadmin, or a tenant that has flipped the opt-out.
 *
 * **The ENTITY half is deliberately absent.** The predicate is "no binding whose
 * type is outside my allowed set", and the disallowed set is unbounded (authored
 * free text), so it cannot be enumerated as `$contains` negations over the
 * `entity_bindings` jsonb. It becomes a containment test against the
 * denormalized `user_tasks.entity_types` column (design D-2), emitted as one raw
 * fragment where the query is built. Do not try to express it here.
 */
export function buildTaskVisibilityConditions(
  principal: BackofficeTaskPrincipal,
  policy: TaskVisibilityPolicy,
  options: TaskVisibilityFilterOptions = {},
): Record<string, unknown>[] {
  if (principal.isSuperAdmin) return []
  if (hasFeature(principal.grantedFeatures, WORKFLOWS_TASKS_VIEW_ALL_FEATURE)) return []
  if (
    !policy.businessContextEnabled &&
    hasFeature(principal.grantedFeatures, WORKFLOWS_TASKS_VIEW_FEATURE)
  ) {
    return []
  }

  const arms: Record<string, unknown>[] = [
    // `assigneeKind` discriminates a backoffice user id from a portal principal
    // id in the same column, so a customer-assigned row can never match a
    // backoffice caller whose user id happens to collide.
    { assignedTo: principal.userId, assigneeKind: 'user' },
    { claimedBy: principal.userId },
  ]
  if (principal.roleNames.length > 0) {
    arms.push({ assignedToRoles: { $overlap: [...principal.roleNames] } })
  }

  const queueFeature = options.administrativeQueueFeature
  if (queueFeature && hasFeature(principal.grantedFeatures, queueFeature)) {
    arms.push({
      assignedTo: null,
      claimedBy: null,
      $or: [{ assignedToRoles: null }, { assignedToRoles: { $eq: [] } }],
    })
  }

  return [{ $or: arms }]
}

/**
 * The full `WHERE` for a backoffice principal: tenant, organization and the
 * relationship clause. Same shape as `buildUserTaskWorkInboxWhere`'s output so
 * the two compose.
 *
 * Portal reads do not use this — they filter on `assignee_kind = 'customer'`
 * plus the caller's owned record ids, which is new surface with its own query.
 */
export function buildTaskVisibilityFilter(
  principal: BackofficeTaskPrincipal,
  policy: TaskVisibilityPolicy,
  options: TaskVisibilityFilterOptions = {},
): Record<string, unknown> {
  const where: Record<string, unknown> = { tenantId: principal.tenantId }
  if (principal.organizationIds !== null) {
    where.organizationId = { $in: [...principal.organizationIds] }
  }
  const conditions = buildTaskVisibilityConditions(principal, policy, options)
  if (conditions.length > 0) where.$and = conditions
  return where
}
