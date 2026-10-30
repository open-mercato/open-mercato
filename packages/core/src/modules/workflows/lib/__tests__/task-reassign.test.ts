/**
 * `reassignUserTask` — the audit trail and the state it leaves behind.
 *
 * Reassignment is the only sanctioned way for an administrator to act on
 * somebody else's work, so what it RECORDS matters as much as what it writes:
 * `reassigned_by` / `reassigned_at` / `reassign_reason` plus a
 * `USER_TASK_REASSIGNED` workflow event carrying both the old and the new owner
 * (module MUST #6 — never mutate state without a corresponding event).
 *
 * Two behaviours are easy to lose and are asserted directly:
 *
 * - **The claim is always released.** Leaving `claimedBy` set would keep
 *   `claimedBy ?? assignedTo` naming the previous claimant, so the predicate
 *   would go on treating the task as theirs and the new assignee could not act
 *   on the task they were just handed.
 * - **No new status value is introduced.** An IN_PROGRESS row returns to
 *   PENDING, exactly as `releaseUserTask` leaves it; adding a `REASSIGNED`
 *   status would be an Ask-First state-machine change.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { UserTask, WorkflowEvent, WorkflowInstance } from '../../data/entities'
import { reassignUserTask, UserTaskError } from '../task-handler'

const TENANT_ID = '11111111-2222-4333-8444-aaaaaaaaaaaa'
const ORG_ID = '11111111-2222-4333-8444-bbbbbbbbbbbb'
const INSTANCE_ID = '11111111-2222-4333-8444-666666666666'
const STEP_INSTANCE_ID = '11111111-2222-4333-8444-777777777777'
const TASK_ID = '11111111-2222-4333-8444-555555555555'
const ADMIN_ID = 'admin-1'
const WORKER_ID = 'user-2'
const CLAIMANT_ID = 'user-3'

type CreatedEvent = Record<string, unknown>

let task: UserTask | null
let instance: WorkflowInstance | null
let created: CreatedEvent[]
let em: {
  findOne: jest.Mock
  flush: jest.Mock
  create: jest.Mock
  persist: jest.Mock
}

function makeTask(overrides: Partial<UserTask> = {}): UserTask {
  const row = new UserTask()
  row.id = TASK_ID
  row.workflowInstanceId = INSTANCE_ID
  row.stepInstanceId = STEP_INSTANCE_ID
  row.taskName = 'Approve order'
  row.status = 'PENDING'
  row.assignedTo = null
  row.assigneeKind = 'user'
  row.assignedToRoles = null
  row.claimedBy = null
  row.tenantId = TENANT_ID
  row.organizationId = ORG_ID
  row.createdAt = new Date('2026-07-28T09:00:00.000Z')
  row.updatedAt = new Date('2026-07-28T09:00:00.000Z')
  Object.assign(row, overrides)
  return row
}

function scope() {
  return { tenantId: TENANT_ID, organizationId: ORG_ID }
}

beforeEach(() => {
  task = makeTask()
  instance = Object.assign(new WorkflowInstance(), {
    id: INSTANCE_ID,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  })
  created = []
  em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === UserTask) return task
      if (entity === WorkflowInstance) return instance
      return null
    }),
    flush: jest.fn(async () => undefined),
    create: jest.fn((_entity: unknown, data: CreatedEvent) => {
      created.push(data)
      return data
    }),
    persist: jest.fn(() => ({ flush: async () => undefined })),
  }
})

function run(input: Parameters<typeof reassignUserTask>[1]) {
  return reassignUserTask(em as never, input)
}

describe('reassignUserTask', () => {
  test('writes the audit columns and logs the workflow event', async () => {
    task = makeTask({ assignedTo: WORKER_ID })

    const result = await run({
      taskId: TASK_ID,
      userId: ADMIN_ID,
      target: { assignedTo: ADMIN_ID },
      reason: 'Escalated by the duty manager',
      scope: scope(),
    })

    expect(result.assignedTo).toBe(ADMIN_ID)
    expect(result.reassignedBy).toBe(ADMIN_ID)
    expect(result.reassignedAt).toBeInstanceOf(Date)
    expect(result.reassignReason).toBe('Escalated by the duty manager')
    expect(em.flush).toHaveBeenCalled()

    expect(em.create).toHaveBeenCalledWith(WorkflowEvent, expect.anything())
    expect(created).toHaveLength(1)
    const event = created[0] as {
      eventType: string
      eventData: { from: Record<string, unknown>; to: Record<string, unknown>; reassignedBy: string }
    }
    expect(event.eventType).toBe('USER_TASK_REASSIGNED')
    expect(event.eventData.reassignedBy).toBe(ADMIN_ID)
    // Both sides of the move are recorded — "who had it before?" is the whole
    // reason the audit exists.
    expect(event.eventData.from).toEqual({
      assignedTo: WORKER_ID,
      assignedToRoles: null,
      claimedBy: null,
    })
    expect(event.eventData.to).toEqual({ assignedTo: ADMIN_ID, assignedToRoles: null })
  })

  test('rescues a task that belongs to nobody', async () => {
    // No assignee, no claim, no queue — the shape §6.4 leaves actionable by
    // nobody. Reassignment must accept it, or the documented remedy is a lie.
    task = makeTask({ assignedTo: null, assignedToRoles: null, claimedBy: null })

    const result = await run({
      taskId: TASK_ID,
      userId: ADMIN_ID,
      target: { assignedTo: WORKER_ID },
      scope: scope(),
    })

    expect(result.assignedTo).toBe(WORKER_ID)
    expect(result.assigneeKind).toBe('user')
    expect(result.reassignReason).toBeNull()
  })

  test('releases an in-flight claim and returns the row to PENDING', async () => {
    task = makeTask({ status: 'IN_PROGRESS', claimedBy: CLAIMANT_ID, claimedAt: new Date() })

    const result = await run({
      taskId: TASK_ID,
      userId: ADMIN_ID,
      target: { assignedTo: WORKER_ID },
      scope: scope(),
    })

    expect(result.claimedBy).toBeNull()
    expect(result.claimedAt).toBeNull()
    expect(result.status).toBe('PENDING')
    const event = created[0] as { eventData: { from: { claimedBy: string | null } } }
    expect(event.eventData.from.claimedBy).toBe(CLAIMANT_ID)
  })

  test('moving a task onto a role queue clears the individual assignee', async () => {
    task = makeTask({ assignedTo: WORKER_ID })

    const result = await run({
      taskId: TASK_ID,
      userId: ADMIN_ID,
      target: { assignedTo: null, assignedToRoles: ['approver', 'manager'] },
      scope: scope(),
    })

    expect(result.assignedTo).toBeNull()
    expect(result.assignedToRoles).toEqual(['approver', 'manager'])
    // PENDING is what makes it claimable off the queue again.
    expect(result.status).toBe('PENDING')
  })

  test('an empty role list is stored as null rather than an empty array', async () => {
    // `[]` and `null` must not both exist as "no queue": the predicate's
    // unassigned-queue arm and the SQL `$overlap` read them differently.
    task = makeTask({ assignedTo: WORKER_ID })

    const result = await run({
      taskId: TASK_ID,
      userId: ADMIN_ID,
      target: { assignedTo: ADMIN_ID, assignedToRoles: [] },
      scope: scope(),
    })

    expect(result.assignedToRoles).toBeNull()
  })

  test('a task outside the caller scope is not found', async () => {
    task = null

    await expect(
      run({ taskId: TASK_ID, userId: ADMIN_ID, target: { assignedTo: WORKER_ID }, scope: scope() }),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
    expect(em.flush).not.toHaveBeenCalled()
  })

  test('a terminal task is refused', async () => {
    for (const status of ['COMPLETED', 'CANCELLED']) {
      task = makeTask({ status: status as UserTask['status'] })
      await expect(
        run({ taskId: TASK_ID, userId: ADMIN_ID, target: { assignedTo: WORKER_ID }, scope: scope() }),
      ).rejects.toBeInstanceOf(UserTaskError)
    }
    expect(em.flush).not.toHaveBeenCalled()
  })

  test('a missing workflow instance does not fail the reassignment', async () => {
    // The row is what authorizes work; a dangling instance reference must not
    // block an administrator from unblocking a stalled task.
    instance = null
    task = makeTask({ assignedTo: WORKER_ID })

    const result = await run({
      taskId: TASK_ID,
      userId: ADMIN_ID,
      target: { assignedTo: ADMIN_ID },
      scope: scope(),
    })

    expect(result.assignedTo).toBe(ADMIN_ID)
    expect(created).toHaveLength(0)
  })
})
