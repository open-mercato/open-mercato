/**
 * Per-request wiring for the §6.4 task visibility rule.
 *
 * The pure predicate (`lib/task-visibility.ts`) decides; this module is what
 * every backoffice surface calls to assemble its inputs ONCE and to turn the
 * rule into a `WHERE`. Nothing here decides anything on its own — a second copy
 * of the rule anywhere is a review failure.
 *
 * ## One ACL load per request, not per row
 *
 * `resolveTaskVisibilityRequestContext` performs exactly one `loadAcl`, one
 * config read and one entity-classification pass, and hands back the principal,
 * the tenant policy and the entity-access map together. A page of 50 tasks with
 * two bindings each costs the same as a page of one.
 *
 * ## Why the entity gate is a whitelist and not a denylist
 *
 * The SQL form is
 *
 *     entity_types IS NULL OR entity_types <@ ARRAY[<types the caller may view>]
 *
 * rather than the superficially cheaper `NOT (entity_types && ARRAY[<denied>])`.
 * The two differ on exactly one row: one carrying a type that was not in the
 * enumerated set — a task written between the enumeration and the main query, or
 * a type the classifier never answered for. The whitelist EXCLUDES it; the
 * denylist ADMITS it. The predicate treats a missing map key as a resolution
 * failure and denies, so only the whitelist agrees with the predicate, and a
 * disagreement between the SQL gate and the predicate is precisely the state
 * where a row is counted in `pagination.total` and then dropped from the page —
 * the "short page, lying total" failure D-2 exists to prevent. Fail-closed wins
 * over an index that neither formulation gets to use anyway (a negation is not
 * GIN-servable either).
 *
 * The `entity_types IS NULL` disjunct is load-bearing and must never be dropped:
 * `NULL <@ ARRAY[…]` is NULL, not true, so without it every row written before
 * the column existed — the whole pre-Phase-4 corpus — would vanish from its own
 * assignee's inbox. That is an outage, not a narrowing.
 *
 * ## What the tenant opt-out reaches
 *
 * Only the read filter: `businessContextEnabled: false` drops the relationship
 * clause AND the entity clause from the `WHERE`, and nothing else. `actable` and
 * `claimable` come from the predicate, which computes them by the new rule
 * whatever the flag says.
 */

import type { EntityManager } from '@mikro-orm/core'
import { hasAllFeatures, hasFeature } from '@open-mercato/shared/security/features'
import { UserTask as UserTaskEntity, type UserTask } from '../data/entities'
import {
  collectTaskEntityTypes,
  resolveTaskEntityAccess,
  type TaskEntityAccessRbacService,
  type TaskEntityAccessScope,
} from './task-entity-access'
import {
  buildTaskVisibilityConditions,
  currentTaskOwnerId,
  decideTaskVisibility,
  resolveTaskAffordances,
  TASK_ACTIONABLE_STATUSES,
  WORKFLOWS_TASKS_VIEW_ALL_FEATURE,
  type BackofficeTaskPrincipal,
  type TaskAffordances,
  type TaskEntityAccessMap,
  type TaskEntityBindingFact,
  type TaskFacts,
  type TaskVisibilityDecision,
  type TaskVisibilityFilterOptions,
  type TaskVisibilityPolicy,
} from './task-visibility'
import {
  resolveTaskVisibilityPolicy,
  type TaskPermissionsConfigService,
} from './task-permission-settings'

/**
 * Everything the rule needs about this request, resolved once.
 *
 * `scopedEntityTypes` is the universe the entity whitelist is drawn from: for a
 * list it is the distinct authored types present in the caller's tenant and
 * organizations, for a single task it is that task's own binding types.
 */
export type TaskVisibilityRequestContext = {
  principal: BackofficeTaskPrincipal
  policy: TaskVisibilityPolicy
  entityAccess: TaskEntityAccessMap
  scopedEntityTypes: readonly string[]
}

export type TaskVisibilityAuth = {
  userId: string
  tenantId: string
  roleNames: readonly string[]
}

export type ResolveTaskVisibilityRequestContextInput = {
  em: EntityManager
  rbac: TaskEntityAccessRbacService
  moduleConfigService: TaskPermissionsConfigService | null | undefined
  auth: TaskVisibilityAuth
  /**
   * `null`/`undefined` = unrestricted operator, matching what
   * `resolveOrganizationScopeFilter` returns for the wildcard scope.
   */
  organizationIds: readonly string[] | null | undefined
  /** The organization the ACL is loaded against, as every other route does. */
  aclOrganizationId: string | null
  /** Authored binding types the gate must be able to answer for. */
  entityTypes: Iterable<string>
}

/**
 * Assemble the request context: one ACL load, one classification pass, one
 * tenant-setting read.
 *
 * Nothing is caught. A resolver that throws must fail the whole request rather
 * than degrade to an empty map — an empty map denies today, but "swallow and
 * carry on" is the shape of bug that later becomes "swallow and pass".
 */
export async function resolveTaskVisibilityRequestContext(
  input: ResolveTaskVisibilityRequestContextInput,
): Promise<TaskVisibilityRequestContext> {
  const scope: TaskEntityAccessScope = {
    tenantId: input.auth.tenantId,
    organizationId: input.aclOrganizationId,
  }
  const scopedEntityTypes = [...new Set(input.entityTypes)]

  const [access, policy] = await Promise.all([
    resolveTaskEntityAccess({
      entityTypes: scopedEntityTypes,
      em: input.em,
      rbac: input.rbac,
      userId: input.auth.userId,
      scope,
    }),
    resolveTaskVisibilityPolicy(input.moduleConfigService, input.auth.tenantId),
  ])

  return {
    principal: {
      kind: 'backoffice',
      userId: input.auth.userId,
      tenantId: input.auth.tenantId,
      organizationIds: input.organizationIds ?? null,
      roleNames: input.auth.roleNames,
      grantedFeatures: access.grantedFeatures,
      isSuperAdmin: access.isSuperAdmin,
    },
    policy,
    entityAccess: access.map,
    scopedEntityTypes,
  }
}

/** The slice of the DI container the route helper below reaches for. */
export type TaskVisibilityContainer = { resolve: <T>(name: string) => T }

/**
 * An ACL that grants nothing.
 *
 * Used when `rbacService` cannot be resolved. Deny-everything is the only safe
 * reading of "the authorization service is missing", and it is loud — an empty
 * inbox is noticed immediately, whereas failing the request open would not be
 * noticed at all.
 */
const NO_GRANTS_RBAC: TaskEntityAccessRbacService = { loadAcl: async () => null }

function resolveOptional<T>(container: TaskVisibilityContainer, name: string): T | null {
  try {
    return container.resolve<T>(name) ?? null
  } catch {
    return null
  }
}

/** Assemble the context from a request container. */
export async function resolveTaskVisibilityForRequest(input: {
  container: TaskVisibilityContainer
  em: EntityManager
  auth: TaskVisibilityAuth
  organizationIds: readonly string[] | null | undefined
  aclOrganizationId: string | null
  entityTypes: Iterable<string>
}): Promise<TaskVisibilityRequestContext> {
  return resolveTaskVisibilityRequestContext({
    em: input.em,
    rbac: resolveOptional<TaskEntityAccessRbacService>(input.container, 'rbacService') ?? NO_GRANTS_RBAC,
    // A config read that cannot happen defaults to the NEW model, never the
    // permissive one — see `lib/task-permission-settings.ts`.
    moduleConfigService: resolveOptional<TaskPermissionsConfigService>(
      input.container,
      'moduleConfigService',
    ),
    auth: input.auth,
    organizationIds: input.organizationIds,
    aclOrganizationId: input.aclOrganizationId,
    entityTypes: input.entityTypes,
  })
}

export type ScopedTaskEntityTypeScope = {
  tenantId: string
  organizationIds: readonly string[] | null
}

/**
 * The distinct authored binding types in the caller's scope.
 *
 * One `SELECT DISTINCT unnest(entity_types)` rather than a whitelist derived
 * from the entity registry: the registry universe is hundreds of ids, each of
 * which would have to be classified (a query apiece for custom entities), while
 * the set a tenant actually binds tasks to is a handful. `unnest` of a NULL
 * array yields no rows, so a tenant whose tasks all predate the column answers
 * with an empty set and the whitelist collapses to "rows about nothing", which
 * is every row it has.
 */
export async function collectScopedTaskEntityTypes(
  em: EntityManager,
  scope: ScopedTaskEntityTypeScope,
): Promise<string[]> {
  const params: unknown[] = [scope.tenantId]
  let sql = 'SELECT DISTINCT unnest(entity_types) AS entity_type FROM user_tasks WHERE tenant_id = ?'

  if (scope.organizationIds !== null) {
    if (scope.organizationIds.length === 0) return []
    sql += ` AND organization_id IN (${scope.organizationIds.map(() => '?').join(', ')})`
    params.push(...scope.organizationIds)
  }

  const rows = await em
    .getConnection()
    .execute<Array<{ entity_type: string | null }>>(sql, params)

  const types = new Set<string>()
  for (const row of rows) {
    const entityType = row?.entity_type
    if (typeof entityType === 'string' && entityType.length > 0) types.add(entityType)
  }
  return [...types]
}

/** The subset of `candidates` this caller may view records of. */
export function resolveAllowedTaskEntityTypes(
  context: TaskVisibilityRequestContext,
  candidates: Iterable<string> = context.scopedEntityTypes,
): string[] {
  const allowed: string[] = []
  for (const entityType of new Set(candidates)) {
    const decision = context.entityAccess.get(entityType)
    // A missing key is a resolution failure, never a pass — the same rule the
    // predicate applies, so the two cannot disagree about a row.
    if (!decision || decision.kind !== 'requires') continue
    if (!hasAllFeatures(context.principal.grantedFeatures, decision.features)) continue
    allowed.push(entityType)
  }
  return allowed
}

/**
 * The ENTITY half of the rule as ORM conditions.
 *
 * Empty for a superadmin (who short-circuits the gate in the predicate too),
 * under the tenant opt-out (which skips the entity gate on reads by design),
 * and — deliberately — for a principal entitled to a DIAGNOSIS.
 *
 * That last case is the §3.6 rule: a task hidden by the entity gate must never
 * disappear without trace. Excluding the row in SQL is exactly the trace-free
 * disappearance, because an administrator then sees a page that is short by an
 * unexplained number of rows and cannot tell "no such task" from "you cannot see
 * its record". So the gate is lifted from the `WHERE` for them, the predicate
 * still refuses each row, and the caller reports the refusals as MARKERS —
 * `partitionTaskPage` below. The rows themselves never reach the response body;
 * only their ids and the entity type that blocked them do, which is exactly what
 * §2.7 already entitles a `view_all` holder to on the single-task surface.
 */
export function buildTaskEntityGateConditions(
  context: TaskVisibilityRequestContext,
): Record<string, unknown>[] {
  if (context.principal.isSuperAdmin) return []
  if (!context.policy.businessContextEnabled) return []
  if (canDiagnoseTaskRefusal(context.principal)) return []
  return [
    {
      $or: [
        { entityTypes: null },
        { entityTypes: { $contained: resolveAllowedTaskEntityTypes(context) } },
      ],
    },
  ]
}

/**
 * RELATIONSHIP ∨ ADMINISTRATIVE plus ENTITY, as conditions to push onto an
 * existing `$and` array. Tenant and organization scoping stay with the caller,
 * which already applies them on every query.
 */
export function buildTaskVisibilityRequestConditions(
  context: TaskVisibilityRequestContext,
  options: TaskVisibilityFilterOptions = {},
): Record<string, unknown>[] {
  return [
    ...buildTaskVisibilityConditions(context.principal, context.policy, options),
    ...buildTaskEntityGateConditions(context),
  ]
}

function asBindingFacts(value: unknown): TaskEntityBindingFact[] {
  if (!Array.isArray(value)) return []
  const bindings: TaskEntityBindingFact[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record.entityType !== 'string' || typeof record.entityId !== 'string') continue
    bindings.push({ entityType: record.entityType, entityId: record.entityId })
  }
  return bindings
}

export type TaskFactsOptions = {
  /** Queue feature for the source that produced this row, when it declares one. */
  administrativeQueueFeature?: string | null
}

/**
 * Project a `UserTask` row onto the facts the predicate reads.
 *
 * `assigneeKind` is defaulted rather than coalesced: the column is NOT NULL, and
 * a row read through a projection that predates it is a backoffice task like
 * every row before it.
 */
export function toTaskFacts(task: UserTask, options: TaskFactsOptions = {}): TaskFacts {
  return {
    id: task.id,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    status: task.status,
    assignedTo: task.assignedTo ?? null,
    assigneeKind: task.assigneeKind ?? 'user',
    assignedToRoles: task.assignedToRoles ?? null,
    claimedBy: task.claimedBy ?? null,
    entityBindings: asBindingFacts(task.entityBindings),
    administrativeQueueFeature: options.administrativeQueueFeature ?? null,
  }
}

/**
 * The distinct authored binding types a set of already-loaded tasks references —
 * what a single-task surface feeds `resolveTaskVisibilityRequestContext`.
 */
export function collectTaskEntityTypesFromTasks(tasks: Iterable<UserTask>): string[] {
  return collectTaskEntityTypes(
    [...tasks].map((task) => ({ entityBindings: asBindingFacts(task.entityBindings) })),
  )
}

/** The predicate's answer for one already-loaded row. */
export function decideTaskAccess(
  context: TaskVisibilityRequestContext,
  task: UserTask,
  options: TaskFactsOptions = {},
): TaskVisibilityDecision {
  return decideTaskVisibility(
    context.principal,
    toTaskFacts(task, options),
    context.entityAccess,
    context.policy,
  )
}

/**
 * The act surfaces a detail response advertises for one already-loaded row.
 *
 * The server has always known this — `decideTaskAccess` returns `actable` and
 * `claimable` on every request — and until now it threw the answer away, which
 * is why the backoffice task page rendered a Complete button that 409s for a
 * `workflows.tasks.view_all` administrator. Sending the decision is the fix; a
 * client re-deriving it is the bug coming back.
 */
export function resolveTaskAffordancesForRequest(
  context: TaskVisibilityRequestContext,
  task: UserTask,
  decision: TaskVisibilityDecision,
  options: TaskFactsOptions = {},
): TaskAffordances {
  return resolveTaskAffordances(context.principal, toTaskFacts(task, options), decision)
}

/**
 * The rows of an already-filtered page the predicate agrees are visible.
 *
 * The `WHERE` this module builds IS this rule, so in practice nothing is
 * dropped here and `pagination.total` stays exactly the count of what the caller
 * may see. It runs anyway because the predicate is the single decision point and
 * because the failure direction matters: should the SQL gate and the predicate
 * ever disagree, losing a row from a page is recoverable and leaking one is not.
 */
export function filterVisibleTasks(
  context: TaskVisibilityRequestContext,
  tasks: readonly UserTask[],
  options: TaskFactsOptions = {},
): UserTask[] {
  return tasks.filter((task) => decideTaskAccess(context, task, options).visible)
}

/**
 * A row an administrator may know EXISTS but may not read.
 *
 * Three fields and no fourth. The id is what makes the marker actionable (it is
 * the argument to reassignment and to a support conversation), the reason
 * separates an author's typo from a policy refusal, and the entity type names
 * the grant that would fix it. Everything that would say what the task is ABOUT
 * — its name, description, form schema, form data, bindings, assignee — is
 * absent by construction rather than by redaction, because a redaction is a
 * field somebody later un-redacts.
 */
export type TaskEntityHiddenMarker = {
  id: string
  reason: 'denied:entity-access' | 'denied:unknown-entity-type'
  /** The binding type that blocked it, when the predicate identified one. */
  entityType: string | null
}

export type TaskPagePartition = {
  /** Rows the caller may read in full. */
  visible: UserTask[]
  /**
   * Rows the entity gate refused to a caller entitled to know they are there.
   * Always empty for everybody else — the gate excluded those rows in SQL, so
   * there is nothing to report and nothing is disclosed.
   */
  entityHidden: TaskEntityHiddenMarker[]
}

/**
 * Split an already-filtered page into what the caller may read and what they may
 * only be told about.
 *
 * This is the counterpart to lifting the entity gate for a diagnosable
 * principal: the SQL returns the rows, the predicate refuses them one by one,
 * and the refusals become markers instead of an unexplained gap in the page. For
 * everybody else the `WHERE` already removed them, `entityHidden` is empty, and
 * the result is byte-identical to `filterVisibleTasks`.
 *
 * A refusal that is NOT an entity refusal (a foreign tenant, an organization the
 * caller cannot see, no relationship at all) is dropped silently, exactly as
 * before: those callers have no legitimate knowledge that the row exists, and a
 * marker would be the disclosure the 404 policy exists to prevent.
 */
export function partitionTaskPage(
  context: TaskVisibilityRequestContext,
  tasks: readonly UserTask[],
  options: TaskFactsOptions = {},
): TaskPagePartition {
  const visible: UserTask[] = []
  const entityHidden: TaskEntityHiddenMarker[] = []
  const diagnosable = canDiagnoseTaskRefusal(context.principal)

  for (const task of tasks) {
    const decision = decideTaskAccess(context, task, options)
    if (decision.visible) {
      visible.push(task)
      continue
    }
    if (!diagnosable) continue
    if (
      decision.reason !== 'denied:entity-access' &&
      decision.reason !== 'denied:unknown-entity-type'
    ) {
      continue
    }
    entityHidden.push({
      id: task.id,
      reason: decision.reason,
      entityType: decision.blockedEntityType ?? null,
    })
  }

  return { visible, entityHidden }
}

/**
 * Whether this caller is entitled to a diagnosis rather than a bare 404.
 *
 * Only a principal who can already see the row in a list view — a `view_all`
 * holder or a superadmin — learns WHICH entity type blocked them. Everybody else
 * gets an answer indistinguishable from "no such task", because they have no
 * legitimate knowledge that the row exists at all.
 */
export function canDiagnoseTaskRefusal(principal: BackofficeTaskPrincipal): boolean {
  return (
    principal.isSuperAdmin || hasFeature(principal.grantedFeatures, WORKFLOWS_TASKS_VIEW_ALL_FEATURE)
  )
}

export type TaskRefusal = {
  /** 404 hides existence, 403 diagnoses, 409 is the act-path conflict. */
  status: 403 | 404 | 409
  body: Record<string, unknown>
}

/**
 * The generic body every non-diagnosable refusal returns.
 *
 * Byte-identical to the body a genuinely missing id produces — a cross-tenant
 * id, an organization the caller cannot see, a task they have no relationship
 * to and a random uuid must all be the same answer.
 */
export const TASK_NOT_FOUND_BODY: Record<string, unknown> = { error: 'Task not found' }

/**
 * Message and code the task handler already throws when the row belongs to
 * somebody else. Reused verbatim so enforcing ownership one layer earlier does
 * not change what a client sees.
 */
export const TASK_ASSIGNED_TO_ANOTHER_USER_BODY: Record<string, unknown> = {
  error: 'Task is assigned to another user',
  code: 'TASK_ASSIGNED_TO_ANOTHER_USER',
}

/**
 * Refusal for a row §6.4 makes nobody's: no assignee, no claim and no role
 * queue. Administration widens seeing, never acting, so the remedy is
 * `workflows.tasks.reassign` rather than a wider grant.
 */
export const TASK_NOT_ACTIONABLE_BODY: Record<string, unknown> = {
  error: 'Task is not assigned to anyone; reassign it before acting on it',
  code: 'TASK_NOT_ACTIONABLE',
}

export type TaskActRefusalOptions = TaskFactsOptions & {
  /**
   * Enforce `actable` here rather than leaving it to the task handler.
   *
   * ON for **complete**, which is the whole point of the narrowing: holding
   * `workflows.tasks.complete` must no longer complete anyone else's work, and
   * the handler deliberately leaves an OWNERLESS row open to anyone the feature
   * gate admitted — the pre-change semantics.
   *
   * OFF for **claim** and **unclaim**, where the handler is already the precise
   * authority and answering here would coarsen its codes: an empty role queue is
   * `TASK_NOT_ROLE_ASSIGNED`, a queue the caller does not belong to is
   * `TASK_NOT_FOUND`, and unclaiming a row nobody holds is `TASK_NOT_FOUND`.
   * Pre-empting those with one generic refusal would lose information the client
   * has always had.
   */
  requireOwnership?: boolean
}

/**
 * The act gate for claim / unclaim / complete.
 *
 * Deliberately narrow: it answers only what the task handler cannot answer for
 * itself and hands everything else through, so the handler keeps producing the
 * exact error codes it always has (`TASK_NOT_FOUND`, `TASK_ALREADY_ASSIGNED`,
 * `TASK_NOT_ROLE_ASSIGNED`, `TASK_ASSIGNED_TO_ANOTHER_USER`) and keeps taking
 * the row with its own compare-and-set.
 *
 * 1. **Can this caller see the row at all?** Running FIRST is the disclosure fix:
 *    `claimUserTask` reports `TASK_ALREADY_ASSIGNED` before it checks queue
 *    membership, so without this a caller with no relationship to the task could
 *    tell an existing task from a nonexistent one by the status code alone.
 * 2. **Does the entity gate block acting?** Reachable only under the tenant
 *    opt-out, which restores the READ and never the act path. Refused as a plain
 *    404 — a reason here would leak the binding to a principal the gate just
 *    refused.
 * 3. **Is the row theirs?** Only when `requireOwnership` is set. The owner is
 *    `claimedBy ?? assignedTo`: holding a task's queued role confers the right
 *    to CLAIM an open row, never to finish one a colleague already claimed.
 *
 * A row in a terminal status is always passed through: the handler answers
 * `TASK_NOT_FOUND` for it, exactly as before.
 */
export function resolveTaskActRefusal(
  context: TaskVisibilityRequestContext,
  decision: TaskVisibilityDecision,
  task: UserTask,
  options: TaskActRefusalOptions = {},
): TaskRefusal | null {
  if (!decision.visible) return resolveTaskRefusal(context, decision)

  if (decision.blockedEntityType) return { status: 404, body: TASK_NOT_FOUND_BODY }

  if (!options.requireOwnership || decision.actable) return null

  const facts = toTaskFacts(task, options)
  if (!TASK_ACTIONABLE_STATUSES.includes(facts.status)) return null

  return currentTaskOwnerId(facts) !== null
    ? { status: 409, body: TASK_ASSIGNED_TO_ANOTHER_USER_BODY }
    : { status: 403, body: TASK_NOT_ACTIONABLE_BODY }
}

export type TaskActionGateResult =
  | { allowed: true; task: UserTask; visibility: TaskVisibilityRequestContext }
  | { allowed: false; refusal: TaskRefusal }

/**
 * The whole §6.4 gate for one act route, in the order that keeps existence
 * undisclosed.
 *
 * The lookup carries tenant AND organization, so a foreign id resolves to
 * nothing before the predicate — and long before any write. That ordering is the
 * point: it is what keeps `claimUserTask`'s conditional `UPDATE` from ever
 * touching another tenant's row.
 */
export async function gateTaskAction(input: {
  container: TaskVisibilityContainer
  em: EntityManager
  auth: TaskVisibilityAuth
  taskId: string
  organizationId: string
  administrativeQueueFeature?: string | null
  /** See `TaskActRefusalOptions.requireOwnership` — ON for complete only. */
  requireOwnership?: boolean
}): Promise<TaskActionGateResult> {
  const task = await input.em.findOne(UserTaskEntity, {
    id: input.taskId,
    tenantId: input.auth.tenantId,
    organizationId: input.organizationId,
  })

  if (!task) return { allowed: false, refusal: { status: 404, body: TASK_NOT_FOUND_BODY } }

  const visibility = await resolveTaskVisibilityForRequest({
    container: input.container,
    em: input.em,
    auth: input.auth,
    organizationIds: [input.organizationId],
    aclOrganizationId: input.organizationId,
    entityTypes: collectTaskEntityTypesFromTasks([task]),
  })

  const options: TaskActRefusalOptions = {
    administrativeQueueFeature: input.administrativeQueueFeature ?? null,
    requireOwnership: input.requireOwnership ?? false,
  }
  const refusal = resolveTaskActRefusal(
    visibility,
    decideTaskAccess(visibility, task, options),
    task,
    options,
  )

  return refusal ? { allowed: false, refusal } : { allowed: true, task, visibility }
}

export function resolveTaskRefusal(
  context: TaskVisibilityRequestContext,
  decision: TaskVisibilityDecision,
): TaskRefusal {
  const isEntityRefusal =
    decision.reason === 'denied:entity-access' || decision.reason === 'denied:unknown-entity-type'

  if (isEntityRefusal && canDiagnoseTaskRefusal(context.principal)) {
    return {
      status: 403,
      body: {
        error: 'Forbidden',
        reason: decision.reason,
        ...(decision.blockedEntityType ? { entityType: decision.blockedEntityType } : {}),
      },
    }
  }

  return { status: 404, body: TASK_NOT_FOUND_BODY }
}
