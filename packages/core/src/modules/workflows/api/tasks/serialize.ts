import type { z } from 'zod'
import type { UserTask } from '../../data/entities'
import type { userTaskRowSchema } from '../openapi'

/**
 * Work-inbox row projection for `UserTask`.
 *
 * The list endpoint used to hand the ORM entities straight to `NextResponse.json`,
 * so anything a consumer needed that was not a column stayed buried in the
 * authored `formSchema` blob: the enterprise "Review proposal" row action reads
 * `row.proposalId`, which lives at `formSchema.proposalId`, and therefore never
 * fired. This projects those work-item fields to the top level.
 *
 * It is a strict SUPERSET of the previous payload — every column the entity dump
 * carried is still emitted, with dates in the same ISO form `JSON.stringify`
 * produced (BACKWARD_COMPATIBILITY.md §7: never remove a response field).
 */

export const USER_TASK_INBOX_KIND = 'user_task'

export type SerializedUserTask = z.infer<typeof userTaskRowSchema>

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readProposalId(task: UserTask): string | null {
  for (const source of [task.formSchema, task.formData]) {
    const record = asRecord(source)
    const value = record?.proposalId ?? record?.proposal_id
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

/**
 * Both readers prefer the real column and fall back to the authored
 * `formSchema` blob. The column is authoritative from the moment task creation
 * resolves it; the fallback keeps every row written before the column existed
 * — and every third party that stuffed the value into `formSchema` — reading
 * exactly as it read before.
 */
function readPriority(task: UserTask): string | number | null {
  if (typeof task.priority === 'string' && task.priority.length > 0) return task.priority
  const value = asRecord(task.formSchema)?.priority
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function readEntityBindings(task: UserTask): unknown[] | null {
  if (Array.isArray(task.entityBindings)) return task.entityBindings
  const value = asRecord(task.formSchema)?.entityBindings
  return Array.isArray(value) ? value : null
}

/**
 * The stored denormalization when there is one, otherwise derived from the
 * bindings the row actually carries. The fallback is what keeps a row written
 * before the column existed reporting the same set the work-inbox projection
 * computes for it — the two must never disagree, because that disagreement is
 * exactly a task hidden by the SQL gate and shown by the JS one.
 */
function readEntityTypes(task: UserTask): string[] | null {
  if (Array.isArray(task.entityTypes)) return task.entityTypes
  const bindings = readEntityBindings(task)
  if (!bindings) return null
  const types = new Set<string>()
  for (const binding of bindings) {
    const entityType = asRecord(binding)?.entityType
    if (typeof entityType === 'string' && entityType.length > 0) types.add(entityType)
  }
  return types.size > 0 ? [...types] : null
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function serializeUserTask(task: UserTask): SerializedUserTask {
  return {
    id: task.id,
    workflowInstanceId: task.workflowInstanceId,
    stepInstanceId: task.stepInstanceId,
    branchInstanceId: task.branchInstanceId ?? null,
    taskName: task.taskName,
    description: task.description ?? null,
    status: task.status,
    formSchema: task.formSchema ?? null,
    formData: task.formData ?? null,
    assignedTo: task.assignedTo ?? null,
    // Defaulted rather than coalesced to null: the column is NOT NULL precisely
    // so no branch has to handle an absent discriminator, and a row read through
    // a stale projection is a backoffice task like every row that predates it.
    assigneeKind: task.assigneeKind ?? 'user',
    assignedToRoles: task.assignedToRoles ?? null,
    entityTypes: readEntityTypes(task),
    claimedBy: task.claimedBy ?? null,
    claimedAt: toIso(task.claimedAt),
    dueDate: toIso(task.dueDate),
    escalatedAt: toIso(task.escalatedAt),
    escalatedTo: task.escalatedTo ?? null,
    completedBy: task.completedBy ?? null,
    completedAt: toIso(task.completedAt),
    comments: task.comments ?? null,
    reassignedBy: task.reassignedBy ?? null,
    reassignedAt: toIso(task.reassignedAt),
    reassignReason: task.reassignReason ?? null,
    tenantId: task.tenantId,
    organizationId: task.organizationId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    kind: USER_TASK_INBOX_KIND,
    proposalId: readProposalId(task),
    priority: readPriority(task),
    entityBindings: readEntityBindings(task),
  }
}
