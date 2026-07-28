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
import type { UserTask } from '../data/entities'
import {
  collectTaskEntityTypes,
  resolveTaskEntityAccess,
  type TaskEntityAccessRbacService,
  type TaskEntityAccessScope,
} from './task-entity-access'
import {
  buildTaskVisibilityConditions,
  decideTaskVisibility,
  WORKFLOWS_TASKS_VIEW_ALL_FEATURE,
  type BackofficeTaskPrincipal,
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
 * Empty for a superadmin (who short-circuits the gate in the predicate too) and
 * under the tenant opt-out (which skips the entity gate on reads by design).
 */
export function buildTaskEntityGateConditions(
  context: TaskVisibilityRequestContext,
): Record<string, unknown>[] {
  if (context.principal.isSuperAdmin) return []
  if (!context.policy.businessContextEnabled) return []
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
  status: 404 | 403
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
