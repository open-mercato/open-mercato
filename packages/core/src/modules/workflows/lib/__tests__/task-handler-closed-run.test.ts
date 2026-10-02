/**
 * A user task outlives its run: `completeWorkflow` closes open tasks only when
 * the run is CANCELLED, so a FAILED, COMPLETED or compensated run can still own
 * a PENDING row. Completing that row used to write the form data into the
 * closed run's context, exit its step and execute the outgoing transition — a
 * cancelled run came back PAUSED on its next step.
 *
 * Two things are pinned here, and the second matters as much as the first:
 *
 * - a closed run refuses the completion BEFORE anything is written — no flush,
 *   the task and the run exactly as they were, no event, no engine call;
 * - the guard is not "must be PAUSED": a RUNNING run (retry / rerun-from-step
 *   leave it there) and a FORKED run (a branch task) complete as they always
 *   did.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

jest.mock('../find-definition', () => ({
  findDefinitionForInstance: jest.fn(),
}))

jest.mock('../transition-handler', () => ({
  findValidTransitions: jest.fn(),
  executeTransition: jest.fn(),
}))

jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(),
}))

jest.mock('../step-handler', () => ({
  exitStep: jest.fn(),
}))

jest.mock('../parallel-handler', () => ({
  resumeBranch: jest.fn(),
}))

jest.mock('../activity-executor', () => ({
  interpolateVariables: (value: unknown) => value,
}))

import { completeUserTask } from '../task-handler'
import { findDefinitionForInstance } from '../find-definition'
import * as transitionHandler from '../transition-handler'
import * as stepHandler from '../step-handler'
import { executeWorkflow } from '../workflow-executor'
import { resumeBranch } from '../parallel-handler'
import { RUN_STATUSES_CLOSED_TO_USER_TASKS, isRunClosedToUserTasks } from '../instance-status'

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '22222222-2222-2222-2222-222222222222'
const USER = '33333333-3333-3333-3333-333333333333'
const TASK_ID = '44444444-4444-4444-4444-444444444444'
const INSTANCE_ID = '55555555-5555-5555-5555-555555555555'
const STEP_INSTANCE_ID = '66666666-6666-6666-6666-666666666666'
const BRANCH_INSTANCE_ID = '77777777-7777-7777-7777-777777777777'
const TASK_UPDATED_AT = new Date('2026-09-30T08:00:00.000Z')
const INSTANCE_UPDATED_AT = new Date('2026-09-30T09:00:00.000Z')

const scope = { tenantId: TENANT, organizationId: ORG }

type Row = Record<string, unknown>

function makeTask(overrides: Row = {}): Row {
  return {
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    workflowInstanceId: INSTANCE_ID,
    stepInstanceId: STEP_INSTANCE_ID,
    taskName: 'Review refund',
    status: 'PENDING',
    assignedTo: USER,
    assignedToRoles: null,
    claimedBy: null,
    branchInstanceId: null,
    formSchema: null,
    formData: null,
    completedBy: null,
    completedAt: null,
    comments: null,
    updatedAt: TASK_UPDATED_AT,
    ...overrides,
  }
}

function makeInstance(status: string): Row {
  return {
    id: INSTANCE_ID,
    definitionId: 'def-1',
    workflowId: 'refunds',
    tenantId: TENANT,
    organizationId: ORG,
    currentStepId: 'review',
    context: { orderId: 'order-1' },
    status,
    updatedAt: INSTANCE_UPDATED_AT,
  }
}

function makeEm(task: Row, instance: Row | null) {
  const stepInstance: Row = { id: STEP_INSTANCE_ID, stepId: 'review', status: 'ACTIVE' }
  const events: Row[] = []

  const findOne = jest.fn(async (entity: { name?: string }, where: unknown) => {
    switch (entity?.name) {
      case 'UserTask': {
        const filter = where as Record<string, unknown>
        if (filter.tenantId !== task.tenantId) return null
        return task
      }
      case 'WorkflowInstance':
        return instance
      case 'StepInstance':
        return stepInstance
      default:
        return null
    }
  })

  const flush = jest.fn(async () => undefined)
  const create = jest.fn((_entity: unknown, data: Row) => {
    const row = { ...data }
    events.push(row)
    return row
  })
  const persist = jest.fn(() => ({ flush }))

  return {
    em: { findOne, flush, create, persist } as unknown as EntityManager,
    flush,
    create,
    persist,
    stepInstance,
    events,
  }
}

const container = { resolve: jest.fn(() => undefined) } as unknown as AwilixContainer

function complete(em: EntityManager) {
  return completeUserTask(em, container, {
    taskId: TASK_ID,
    formData: { approved: true },
    userId: USER,
    comments: 'late approval',
    scope,
  })
}

function expectNothingWritten(
  harness: ReturnType<typeof makeEm>,
  task: Row,
  instance: Row | null,
  taskStatus: string,
  instanceStatus?: string,
) {
  expect(harness.flush).not.toHaveBeenCalled()
  expect(harness.create).not.toHaveBeenCalled()
  expect(harness.persist).not.toHaveBeenCalled()
  expect(harness.events).toEqual([])

  expect(task.status).toBe(taskStatus)
  expect(task.formData).toBeNull()
  expect(task.completedBy).toBeNull()
  expect(task.completedAt).toBeNull()
  expect(task.comments).toBeNull()
  expect(task.updatedAt).toBe(TASK_UPDATED_AT)

  if (instance) {
    expect(instance.status).toBe(instanceStatus)
    expect(instance.currentStepId).toBe('review')
    expect(instance.context).toEqual({ orderId: 'order-1' })
    expect(instance.updatedAt).toBe(INSTANCE_UPDATED_AT)
  }
  expect(harness.stepInstance.status).toBe('ACTIVE')

  expect(stepHandler.exitStep).not.toHaveBeenCalled()
  expect(transitionHandler.findValidTransitions).not.toHaveBeenCalled()
  expect(transitionHandler.executeTransition).not.toHaveBeenCalled()
  expect(resumeBranch).not.toHaveBeenCalled()
  expect(executeWorkflow).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(findDefinitionForInstance as jest.Mock).mockResolvedValue({
    id: 'def-1',
    definition: {
      steps: [{ stepId: 'review', stepType: 'USER_TASK', userTaskConfig: {} }],
      transitions: [
        { transitionId: 't_next', fromStepId: 'review', toStepId: 'second', trigger: 'auto' },
      ],
    },
  } as never)
  ;(transitionHandler.executeTransition as jest.Mock).mockResolvedValue({ success: true } as never)
  ;(transitionHandler.findValidTransitions as jest.Mock).mockResolvedValue([
    { isValid: true, transition: { transitionId: 't_next', toStepId: 'second' } },
  ] as never)
  ;(resumeBranch as jest.Mock).mockResolvedValue(true as never)
})

describe('the closed-run status set', () => {
  test('names the terminal statuses plus COMPENSATING, and nothing a live run can be in', () => {
    expect([...RUN_STATUSES_CLOSED_TO_USER_TASKS].sort()).toEqual(
      ['CANCELLED', 'COMPENSATED', 'COMPENSATING', 'COMPLETED', 'FAILED'],
    )
    for (const status of ['RUNNING', 'PAUSED', 'FORKED', 'WAITING_FOR_ACTIVITIES']) {
      expect(isRunClosedToUserTasks(status)).toBe(false)
    }
    expect(isRunClosedToUserTasks(null)).toBe(false)
    expect(isRunClosedToUserTasks(undefined)).toBe(false)
  })
})

describe('completeUserTask on a closed run', () => {
  test.each(['CANCELLED', 'FAILED', 'COMPLETED', 'COMPENSATING', 'COMPENSATED'])(
    'a %s run refuses the completion and nothing is written',
    async (status) => {
      const task = makeTask()
      const instance = makeInstance(status)
      const harness = makeEm(task, instance)

      await expect(complete(harness.em)).rejects.toMatchObject({
        name: 'UserTaskError',
        code: 'WORKFLOW_NOT_ACTIVE',
        message: 'Workflow is no longer active',
        details: { taskId: TASK_ID, workflowInstanceId: INSTANCE_ID, status },
      })

      expectNothingWritten(harness, task, instance, 'PENDING', status)
    },
  )

  test('a claimed task on a closed run stays claimed and IN_PROGRESS', async () => {
    const task = makeTask({ status: 'IN_PROGRESS', assignedTo: null, claimedBy: USER })
    const instance = makeInstance('FAILED')
    const harness = makeEm(task, instance)

    await expect(complete(harness.em)).rejects.toMatchObject({ code: 'WORKFLOW_NOT_ACTIVE' })

    expectNothingWritten(harness, task, instance, 'IN_PROGRESS', 'FAILED')
    expect(task.claimedBy).toBe(USER)
  })

  test('a branch-scoped task on a closed run is refused before its branch is resumed', async () => {
    const task = makeTask({ branchInstanceId: BRANCH_INSTANCE_ID })
    const instance = makeInstance('CANCELLED')
    const harness = makeEm(task, instance)

    await expect(complete(harness.em)).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_ACTIVE',
      details: { status: 'CANCELLED' },
    })

    expectNothingWritten(harness, task, instance, 'PENDING', 'CANCELLED')
  })

  test('a missing instance is reported before the task is completed', async () => {
    const task = makeTask()
    const harness = makeEm(task, null)

    await expect(complete(harness.em)).rejects.toMatchObject({
      code: 'INSTANCE_NOT_FOUND',
      details: { workflowInstanceId: INSTANCE_ID },
    })

    expectNothingWritten(harness, task, null, 'PENDING')
  })

  test('the assignee check still answers first, so a stranger learns nothing about the run', async () => {
    const task = makeTask({ assignedTo: 'someone-else' })
    const instance = makeInstance('CANCELLED')
    const harness = makeEm(task, instance)

    await expect(complete(harness.em)).rejects.toMatchObject({
      code: 'TASK_ASSIGNED_TO_ANOTHER_USER',
    })

    expectNothingWritten(harness, task, instance, 'PENDING', 'CANCELLED')
  })
})

describe('completeUserTask on a live run is unchanged', () => {
  test('a PAUSED run completes the task, merges the form data and resumes', async () => {
    const task = makeTask()
    const instance = makeInstance('PAUSED')
    const harness = makeEm(task, instance)

    await complete(harness.em)

    expect(task.status).toBe('COMPLETED')
    expect(task.formData).toEqual({ approved: true })
    expect(task.completedBy).toBe(USER)
    expect(task.comments).toBe('late approval')
    expect(instance.context).toEqual({ orderId: 'order-1', approved: true })
    expect(instance.status).toBe('RUNNING')
    expect(harness.flush).toHaveBeenCalled()
    expect(harness.events.map((event) => event.eventType)).toEqual(['USER_TASK_COMPLETED'])
    expect(stepHandler.exitStep).toHaveBeenCalledTimes(1)
    expect(transitionHandler.executeTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      instance,
      'review',
      'second',
      expect.objectContaining({ transitionId: 't_next' }),
    )
    expect(executeWorkflow).toHaveBeenCalledWith(harness.em, container, INSTANCE_ID, { userId: USER })
  })

  test('a RUNNING run (after retry or rerun-from-step) still completes its task', async () => {
    const task = makeTask()
    const instance = makeInstance('RUNNING')
    const harness = makeEm(task, instance)

    await complete(harness.em)

    expect(task.status).toBe('COMPLETED')
    expect(task.formData).toEqual({ approved: true })
    expect(instance.context).toEqual({ orderId: 'order-1', approved: true })
    expect(instance.status).toBe('RUNNING')
    expect(harness.events.map((event) => event.eventType)).toEqual(['USER_TASK_COMPLETED'])
    expect(stepHandler.exitStep).toHaveBeenCalledTimes(1)
    expect(transitionHandler.executeTransition).toHaveBeenCalledTimes(1)
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })

  test('a FORKED run still completes a branch-scoped task through its branch', async () => {
    const task = makeTask({ branchInstanceId: BRANCH_INSTANCE_ID })
    const instance = makeInstance('FORKED')
    const harness = makeEm(task, instance)

    await complete(harness.em)

    expect(task.status).toBe('COMPLETED')
    expect(task.formData).toEqual({ approved: true })
    expect(instance.status).toBe('FORKED')
    expect(harness.events).toEqual([
      expect.objectContaining({
        eventType: 'USER_TASK_COMPLETED',
        branchInstanceId: BRANCH_INSTANCE_ID,
      }),
    ])
    expect(resumeBranch).toHaveBeenCalledWith(
      harness.em,
      expect.objectContaining({
        instanceId: INSTANCE_ID,
        branchInstanceId: BRANCH_INSTANCE_ID,
        contextMerge: { approved: true },
        exitStepInstanceId: STEP_INSTANCE_ID,
      }),
    )
    expect(transitionHandler.executeTransition).not.toHaveBeenCalled()
    expect(executeWorkflow).toHaveBeenCalledTimes(1)
  })
})
