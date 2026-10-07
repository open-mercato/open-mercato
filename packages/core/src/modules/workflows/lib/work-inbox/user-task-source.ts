/**
 * Work Inbox — the core `user_task` source.
 *
 * A read-model over the existing `user_tasks` rows (spec §6.3: "phase 1: a
 * projection/read-model over existing `UserTask` … with no data migration").
 * Nothing here writes; the inbox's mutations go through `taskHandler`.
 *
 * Rows are projected through the SAME `serializeUserTask` the task list route
 * uses and carried on the wire under `details`, so a work-inbox row remains a
 * strict superset of a task-list row.
 */

import type { EntityManager, FilterQuery } from '@mikro-orm/core'
import { UserTask } from '../../data/entities'
import { serializeUserTask, USER_TASK_INBOX_KIND } from '../../api/tasks/serialize'
import {
  WORK_INBOX_TERMINAL_STATUSES,
  deriveWorkInboxOverdue,
  normalizeWorkInboxPriority,
} from './provider'
import {
  buildTaskVisibilityRequestConditions,
  partitionTaskPage,
} from '../task-visibility-request'
import type {
  WorkInboxAction,
  WorkInboxEntityBinding,
  WorkInboxQuery,
  WorkInboxRow,
  WorkInboxScope,
  WorkInboxSourceContext,
  WorkInboxSourceProvider,
  WorkInboxSourceResult,
} from './provider'

export const WORKFLOWS_MODULE_ID = 'workflows'

/**
 * Declarative actions the inbox renders for a workflow task. `complete` points
 * at the task detail page rather than an endpoint because completing needs the
 * form; claim and unclaim are one-shot POSTs.
 */
export const USER_TASK_WORK_INBOX_ACTIONS: WorkInboxAction[] = [
  {
    id: 'claim',
    labelKey: 'workflows.tasks.actions.claim',
    endpoint: '/api/workflows/tasks/{id}/claim',
    appliesTo: 'claimable',
  },
  {
    id: 'unclaim',
    labelKey: 'workflows.tasks.actions.unclaim',
    endpoint: '/api/workflows/tasks/{id}/unclaim',
    appliesTo: 'claimed-by-me',
  },
]

type WorkInboxWhere = FilterQuery<UserTask>

/**
 * Per-source options a `UserTask`-serving provider passes through to the §6.4
 * rule.
 *
 * `administrativeQueueFeature` is the source's own declaration, handed back by
 * `listWorkInbox`. Core's `user_task` source declares none, so an unassigned row
 * keeps falling back to `workflows.tasks.view_all` exactly as before; a
 * specialized source (an administrative queue raised by another module) supplies
 * its own, and the SQL filter and the predicate must be given the SAME value or
 * a row is counted in `pagination.total` and then dropped from the page.
 */
export type UserTaskWorkInboxOptions = {
  administrativeQueueFeature?: string | null
}

function asBindings(value: unknown): WorkInboxEntityBinding[] {
  if (!Array.isArray(value)) return []
  const bindings: WorkInboxEntityBinding[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const entityType = record.entityType
    const entityId = record.entityId
    if (typeof entityType !== 'string' || typeof entityId !== 'string') continue
    const label = typeof record.label === 'string' ? record.label : null
    bindings.push({ entityType, entityId, label })
  }
  return bindings
}

/**
 * Translate a work-inbox query into the ORM filter.
 *
 * Exported and pure so the tenant/organization scoping and every filter can be
 * asserted without a database. Independent predicates are pushed onto `$and`
 * rather than merged into one object, because several of them (`myWork`,
 * `entityTypes`) each need their own `$or` group and a single object can only
 * carry one.
 */
export function buildUserTaskWorkInboxWhere(
  query: WorkInboxQuery,
  scope: WorkInboxScope,
  options: UserTaskWorkInboxOptions = {},
): WorkInboxWhere {
  const conditions: Record<string, unknown>[] = []

  if (query.statuses && query.statuses.length > 0) {
    conditions.push({ status: { $in: query.statuses } })
  }

  if (query.overdueOnly) {
    conditions.push({ dueDate: { $lt: query.now } })
    conditions.push({ status: { $nin: [...WORK_INBOX_TERMINAL_STATUSES] } })
  }

  if (query.assignedTo) {
    conditions.push({ assignedTo: query.assignedTo })
  }

  if (query.workflowInstanceId) {
    conditions.push({ workflowInstanceId: query.workflowInstanceId })
  }

  if (query.priorities && query.priorities.length > 0) {
    conditions.push({ priority: { $in: query.priorities } })
  }

  if (query.roles && query.roles.length > 0) {
    conditions.push({ assignedToRoles: { $overlap: query.roles } })
  }

  if (query.entityTypes && query.entityTypes.length > 0) {
    conditions.push({
      $or: query.entityTypes.map((entityType) => ({
        entityBindings: { $contains: [{ entityType }] },
      })),
    })
  }

  if (query.myWork) {
    conditions.push({
      $or: [
        { assignedTo: scope.userId },
        { claimedBy: scope.userId },
        { assignedToRoles: { $overlap: scope.roles } },
      ],
    })
  }

  // §6.4. Pushed onto the SAME `$and` array as every other predicate, so the
  // relationship clause, the entity gate and the caller's own filters compose
  // rather than overwrite each other. Empty for an administrator, a superadmin,
  // or a tenant that has flipped the opt-out — the rule then adds nothing and
  // tenant/organization scoping below is still the floor.
  conditions.push(
    ...buildTaskVisibilityRequestConditions(scope.visibility, {
      administrativeQueueFeature: options.administrativeQueueFeature ?? null,
    }),
  )

  const where: Record<string, unknown> = { tenantId: scope.tenantId }
  if (scope.organizationIds) {
    where.organizationId = { $in: scope.organizationIds }
  }
  if (conditions.length > 0) {
    where.$and = conditions
  }

  return where as WorkInboxWhere
}

export function toUserTaskWorkInboxRow(task: UserTask, now: Date): WorkInboxRow {
  const details = serializeUserTask(task)
  const bindings = asBindings(details.entityBindings)
  return {
    id: details.id,
    kind: USER_TASK_INBOX_KIND,
    moduleId: WORKFLOWS_MODULE_ID,
    title: details.taskName,
    description: details.description ?? null,
    status: details.status,
    priority: normalizeWorkInboxPriority(details.priority),
    dueDate: details.dueDate ?? null,
    overdue: deriveWorkInboxOverdue(details.dueDate ?? null, details.status, now),
    createdAt: details.createdAt,
    updatedAt: details.updatedAt,
    assignedTo: details.assignedTo ?? null,
    assignedToRoles: details.assignedToRoles ?? null,
    claimedBy: details.claimedBy ?? null,
    entityTypes: [...new Set(bindings.map((binding) => binding.entityType))],
    entityBindings: bindings,
    detailHref: `/backend/tasks/${details.id}`,
    actions: USER_TASK_WORK_INBOX_ACTIONS,
    details,
  }
}

/**
 * SQL orders by due date (Postgres puts NULLs last on ASC, which is what the
 * inbox wants) and then by recency; the canonical priority → due → created
 * ordering is applied by the merge service over the returned window, because
 * `priority` is an authored label with no ordinal column to sort on. Phase 1 is
 * a projection — a persisted sort key belongs with the `Task` entity, which
 * resolved question #1 defers to the next cycle.
 */
async function listUserTaskWorkItems(
  query: WorkInboxQuery,
  context: WorkInboxSourceContext,
): Promise<WorkInboxSourceResult> {
  const em = context.resolve<EntityManager>('em')
  const options: UserTaskWorkInboxOptions = {
    administrativeQueueFeature: context.administrativeQueueFeature ?? null,
  }
  const where = buildUserTaskWorkInboxWhere(query, context.scope, options)

  const [tasks, total] = await em.findAndCount(UserTask, where, {
    orderBy: [{ dueDate: 'ASC' }, { createdAt: 'DESC' }],
    limit: query.offset + query.limit,
    offset: 0,
  })

  // The `WHERE` already IS the rule; running the predicate over the page keeps
  // this source routed through the single decision point and makes a
  // SQL/predicate divergence lose a row instead of leaking one. It is handed the
  // SAME queue feature the filter was built with, for exactly that reason.
  const { visible, entityHidden } = partitionTaskPage(context.scope.visibility, tasks, options)

  return {
    rows: visible.map((task) => toUserTaskWorkInboxRow(task, query.now)),
    total,
    ...(entityHidden.length > 0 ? { entityHidden } : {}),
  }
}

export const userTaskWorkInboxSource: WorkInboxSourceProvider = {
  kind: USER_TASK_INBOX_KIND,
  moduleId: WORKFLOWS_MODULE_ID,
  render: 'work-inbox:user_task:detail',
  actions: USER_TASK_WORK_INBOX_ACTIONS,
  list: listUserTaskWorkItems,
}
