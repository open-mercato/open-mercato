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

function readPriority(task: UserTask): string | number | null {
  const value = asRecord(task.formSchema)?.priority
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function readEntityBindings(task: UserTask): unknown[] | null {
  const value = asRecord(task.formSchema)?.entityBindings
  return Array.isArray(value) ? value : null
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
    assignedToRoles: task.assignedToRoles ?? null,
    claimedBy: task.claimedBy ?? null,
    claimedAt: toIso(task.claimedAt),
    dueDate: toIso(task.dueDate),
    escalatedAt: toIso(task.escalatedAt),
    escalatedTo: task.escalatedTo ?? null,
    completedBy: task.completedBy ?? null,
    completedAt: toIso(task.completedAt),
    comments: task.comments ?? null,
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
