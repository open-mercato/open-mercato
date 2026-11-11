/**
 * Two submissions of the same task (the task page and a quick action, a client
 * retry) both read the row while it is still open. Each contender gets its own snapshot of
 * that row, while `nativeUpdate` applies the conditional update to the one
 * shared row, the way the database would. Only one may complete the task and
 * run its side effects; the other gets TASK_NOT_FOUND.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

jest.mock('../find-definition', () => ({ findDefinitionForInstance: jest.fn() }))
jest.mock('../transition-handler', () => ({ findValidTransitions: jest.fn(), executeTransition: jest.fn() }))
jest.mock('../workflow-executor', () => ({ executeWorkflow: jest.fn() }))
jest.mock('../step-handler', () => ({ exitStep: jest.fn() }))
jest.mock('../parallel-handler', () => ({ resumeBranch: jest.fn() }))

import { completeUserTask } from '../task-handler'
import { findDefinitionForInstance } from '../find-definition'
import * as transitionHandler from '../transition-handler'
import * as stepHandler from '../step-handler'
import { executeWorkflow } from '../workflow-executor'
import { resumeBranch } from '../parallel-handler'

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const USER = '33333333-3333-3333-3333-333333333333'
const TASK_ID = '44444444-4444-4444-4444-444444444444'

type Row = Record<string, unknown>

function makeContender(storedTask: Row, instance: Row) {
  const snapshot: Row = { ...storedTask }
  const findOne = jest.fn(async (entity: { name?: string }) => {
    if (entity?.name === 'UserTask') return snapshot
    if (entity?.name === 'WorkflowInstance') return instance
    if (entity?.name === 'StepInstance') return { id: 'step-1', stepId: 'review', status: 'ACTIVE' }
    return null
  })
  const nativeUpdate = jest.fn(async (_entity: unknown, where: Row, data: Row) => {
    if (!(where.status as { $in: string[] }).$in.includes(storedTask.status as string)) return 0
    Object.assign(storedTask, data)
    return 1
  })
  const flush = jest.fn(async () => undefined)
  const create = jest.fn((_entity: unknown, data: Row) => ({ ...data }))
  const persist = jest.fn(() => ({ flush }))
  return { em: { findOne, nativeUpdate, flush, create, persist } as unknown as EntityManager, create }
}

function submit(em: EntityManager, approved: boolean) {
  return completeUserTask(em, { resolve: jest.fn() } as unknown as AwilixContainer, {
    taskId: TASK_ID,
    formData: { approved },
    userId: USER,
    scope: { tenantId: TENANT, organizationId: ORG },
  }).then(
    () => null,
    (error: unknown) => error,
  )
}

function race(taskOverrides: Row, instanceStatus: string) {
  const storedTask: Row = {
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    workflowInstanceId: 'instance-1',
    stepInstanceId: 'step-1',
    taskName: 'Review refund',
    status: 'PENDING',
    assignedTo: USER,
    claimedBy: null,
    branchInstanceId: null,
    formSchema: null,
    ...taskOverrides,
  }
  const instance: Row = {
    id: 'instance-1',
    definitionId: 'def-1',
    tenantId: TENANT,
    organizationId: ORG,
    currentStepId: 'review',
    context: {},
    status: instanceStatus,
  }
  return { storedTask, instance, first: makeContender(storedTask, instance), second: makeContender(storedTask, instance) }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(findDefinitionForInstance).mockResolvedValue({
    definition: { transitions: [{ transitionId: 't_next', fromStepId: 'review', toStepId: 'next', trigger: 'auto' }] },
  } as unknown as Awaited<ReturnType<typeof findDefinitionForInstance>>)
  jest.mocked(transitionHandler.findValidTransitions).mockResolvedValue([
    { isValid: true, transition: { transitionId: 't_next', toStepId: 'next' } },
  ] as unknown as Awaited<ReturnType<typeof transitionHandler.findValidTransitions>>)
  jest.mocked(transitionHandler.executeTransition).mockResolvedValue({
    success: true,
  } as unknown as Awaited<ReturnType<typeof transitionHandler.executeTransition>>)
  jest.mocked(resumeBranch).mockResolvedValue(true as unknown as Awaited<ReturnType<typeof resumeBranch>>)
})

describe('completeUserTask double submit', () => {
  test('only the first of two submissions that both read the open task completes it', async () => {
    const { storedTask, instance, first, second } = race({ status: 'IN_PROGRESS', claimedBy: USER }, 'PAUSED')

    expect(await submit(first.em, true)).toBeNull()
    expect(await submit(second.em, false)).toMatchObject({ code: 'TASK_NOT_FOUND' })

    expect(storedTask).toMatchObject({ status: 'COMPLETED', formData: { approved: true } })
    expect(instance.context).toEqual({ approved: true })
    expect(second.create).not.toHaveBeenCalled()
    expect(stepHandler.exitStep).toHaveBeenCalledTimes(1)
    expect(transitionHandler.executeTransition).toHaveBeenCalledTimes(1)
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })

  test('a branch task is resumed once, not once per submission', async () => {
    const { first, second } = race({ branchInstanceId: 'branch-1' }, 'FORKED')

    expect(await submit(first.em, true)).toBeNull()
    expect(await submit(second.em, false)).toMatchObject({ code: 'TASK_NOT_FOUND' })

    expect(second.create).not.toHaveBeenCalled()
    expect(resumeBranch).toHaveBeenCalledTimes(1)
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })
})
