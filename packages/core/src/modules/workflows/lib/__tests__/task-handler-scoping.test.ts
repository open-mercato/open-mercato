/**
 * Tenant scoping and assignee authorization for user tasks.
 *
 * `claimUserTask` used to look a task up by id and status alone and mutate it
 * before its route ever compared tenants, so a task id from another tenant was
 * claimable — a cross-tenant write. `completeUserTask` was unscoped too (its
 * route checked first, so only defence in depth) and enforced no assignee at
 * all. These lock both down, and pin the case that must NOT regress: a task
 * nobody is assigned to — an agent disposition, an unclaimed role queue — stays
 * completable by anyone the route's feature gate already admitted.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { claimUserTask, completeUserTask, UserTaskError } from '../task-handler'

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'
const ORG_A = '33333333-3333-3333-3333-333333333333'
const ORG_B = '44444444-4444-4444-4444-444444444444'
const USER_A = '55555555-5555-5555-5555-555555555555'
const USER_B = '66666666-6666-6666-6666-666666666666'
const TASK_ID = '77777777-7777-7777-7777-777777777777'

const scopeA = { tenantId: TENANT_A, organizationId: ORG_A }

type TaskRow = Record<string, unknown>

function makeTask(overrides: TaskRow = {}): TaskRow {
  return {
    id: TASK_ID,
    tenantId: TENANT_A,
    organizationId: ORG_A,
    workflowInstanceId: '88888888-8888-8888-8888-888888888888',
    stepInstanceId: '99999999-9999-9999-9999-999999999999',
    taskName: 'Approve order',
    status: 'PENDING',
    assignedTo: null,
    assignedToRoles: ['approver'],
    claimedBy: null,
    formSchema: null,
    ...overrides,
  }
}

/**
 * Stands in for the identity map: only returns a row when every scalar in the
 * filter matches, which is exactly what a missing tenant filter would bypass.
 */
function makeEm(rows: TaskRow[]) {
  const flush = jest.fn(async () => undefined)
  const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    return (
      rows.find((row) =>
        Object.entries(where).every(([key, value]) => {
          if (value !== null && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
            return ((value as { $in: unknown[] }).$in).includes(row[key])
          }
          return row[key] === value
        }),
      ) ?? null
    )
  })
  return { em: { findOne, flush } as unknown as EntityManager, findOne, flush }
}

const container = { resolve: jest.fn(() => undefined) } as unknown as AwilixContainer

describe('claimUserTask tenant scoping', () => {
  beforeEach(() => jest.clearAllMocks())

  test('refuses a task belonging to another tenant and writes nothing', async () => {
    const row = makeTask({ tenantId: TENANT_B, organizationId: ORG_B })
    const { em, flush } = makeEm([row])

    await expect(claimUserTask(em, TASK_ID, USER_A, scopeA)).rejects.toThrow(UserTaskError)

    expect(flush).not.toHaveBeenCalled()
    expect(row.claimedBy).toBeNull()
    expect(row.status).toBe('PENDING')
  })

  test('filters the lookup on tenant and organization', async () => {
    const { em, findOne } = makeEm([makeTask()])

    await claimUserTask(em, TASK_ID, USER_A, scopeA)

    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: TASK_ID, tenantId: TENANT_A, organizationId: ORG_A }),
    )
  })

  test('still claims a role-queued task inside the caller scope', async () => {
    const row = makeTask()
    const { em } = makeEm([row])

    await claimUserTask(em, TASK_ID, USER_A, scopeA)

    expect(row.claimedBy).toBe(USER_A)
    expect(row.status).toBe('IN_PROGRESS')
  })
})

describe('completeUserTask authorization', () => {
  beforeEach(() => jest.clearAllMocks())

  const complete = (em: EntityManager, userId: string) =>
    completeUserTask(em, container, { taskId: TASK_ID, formData: {}, userId, scope: scopeA })

  test('refuses a task belonging to another tenant', async () => {
    const { em } = makeEm([makeTask({ tenantId: TENANT_B, organizationId: ORG_B })])

    await expect(complete(em, USER_A)).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' })
  })

  test('refuses when the task is assigned to someone else', async () => {
    const { em } = makeEm([makeTask({ assignedTo: USER_B, assignedToRoles: null })])

    await expect(complete(em, USER_A)).rejects.toMatchObject({
      code: 'TASK_ASSIGNED_TO_ANOTHER_USER',
    })
  })

  test('refuses when another user has claimed it', async () => {
    const { em } = makeEm([makeTask({ claimedBy: USER_B, status: 'IN_PROGRESS' })])

    await expect(complete(em, USER_A)).rejects.toMatchObject({
      code: 'TASK_ASSIGNED_TO_ANOTHER_USER',
    })
  })

  test('lets the assignee through', async () => {
    const { em } = makeEm([makeTask({ assignedTo: USER_A, assignedToRoles: null })])

    await expect(complete(em, USER_A)).rejects.not.toMatchObject({
      code: 'TASK_ASSIGNED_TO_ANOTHER_USER',
    })
  })

  test('leaves an unassigned task completable — agent dispositions must not strand', async () => {
    const { em } = makeEm([makeTask({ assignedTo: null, assignedToRoles: null, claimedBy: null })])

    await expect(complete(em, USER_A)).rejects.not.toMatchObject({
      code: 'TASK_ASSIGNED_TO_ANOTHER_USER',
    })
  })
})
