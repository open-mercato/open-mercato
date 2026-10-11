/**
 * Task completion guards (issue #7178).
 *
 * A host module vetoes a completion through `registerTaskCompletionGuards`;
 * `completeUserTask` consults the registry before mutating anything, so every
 * caller of the handler — the HTTP route, the `workflows.tasks.complete`
 * command and in-process callers — is refused with the same code. These pin the
 * registry contract, the fail-closed rule, the non-mutating preview and the
 * regression that matters most: no guard, no change.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

const findDefinitionForInstance = jest.fn()
const exitStep = jest.fn(async () => undefined)

jest.mock('../find-definition', () => ({
  findDefinitionForInstance: (...args: unknown[]) => findDefinitionForInstance(...args),
}))

jest.mock('../step-handler', () => ({
  exitStep: (...args: unknown[]) => exitStep(...(args as [])),
}))

jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(async () => undefined),
}))

import {
  clearTaskCompletionGuards,
  evaluateTaskCompletionGuards,
  getTaskCompletionGuards,
  registerTaskCompletionGuards,
  taskCompletionGuardApplies,
  TASK_COMPLETION_BLOCKED_CODE,
  TASK_COMPLETION_GUARD_FAILED_CODE,
} from '../task-completion-guards'
import type { TaskCompletionGuard, TaskCompletionGuardInput } from '../task-completion-guards'
import {
  completeUserTask,
  isTaskCompletionBlockedError,
  TaskCompletionBlockedError,
  UserTaskError,
} from '../task-handler'
import type { UserTask } from '../../data/entities'

const TENANT = '11111111-1111-1111-1111-111111111111'
const ORG = '33333333-3333-3333-3333-333333333333'
const USER = '55555555-5555-5555-5555-555555555555'
const TASK_ID = '77777777-7777-7777-7777-777777777777'
const INSTANCE_ID = '88888888-8888-8888-8888-888888888888'
const STEP_INSTANCE_ID = '99999999-9999-9999-9999-999999999999'

type Row = Record<string, unknown>

function makeTask(overrides: Row = {}): Row {
  return {
    id: TASK_ID,
    tenantId: TENANT,
    organizationId: ORG,
    workflowInstanceId: INSTANCE_ID,
    stepInstanceId: STEP_INSTANCE_ID,
    taskName: 'Approve contract',
    status: 'PENDING',
    assignedTo: USER,
    assignedToRoles: null,
    claimedBy: null,
    formSchema: null,
    entityBindings: [],
    ...overrides,
  }
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value !== null && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
      return (value as { $in: unknown[] }).$in.includes(row[key])
    }
    return row[key] === value
  })
}

/**
 * Routes `findOne` by entity class name, so the handler, the decision context
 * and the guard target loader all read the same rows. `fork` returns a separate
 * stub whose `flush` is tracked on its own.
 */
function makeEm(task: Row) {
  const instance: Row = {
    id: INSTANCE_ID,
    workflowId: 'contract-approval',
    definitionId: 'def-1',
    status: 'PAUSED',
    currentStepId: 'review',
    context: {},
    tenantId: TENANT,
    organizationId: ORG,
  }
  const stepInstance: Row = { id: STEP_INSTANCE_ID, stepId: 'review', status: 'ACTIVE' }
  const tables: Record<string, Row[]> = {
    UserTask: [task],
    WorkflowInstance: [instance],
    StepInstance: [stepInstance],
  }
  const flush = jest.fn(async () => undefined)
  const forkFlush = jest.fn(async () => undefined)
  const findOne = jest.fn(async (entity: { name?: string } | string, where: unknown) => {
    const name = typeof entity === 'string' ? entity : entity?.name ?? ''
    const rows = tables[name] ?? []
    const filter = typeof where === 'string' ? { id: where } : (where as Record<string, unknown>)
    return rows.find((row) => matches(row, filter)) ?? null
  })
  const persist = jest.fn(() => ({ flush }))
  const create = jest.fn((_entity: unknown, data: Row) => ({ ...data }))
  const forkEm = { findOne, flush: forkFlush, persist, create }
  const em = {
    findOne,
    flush,
    persist,
    create,
    fork: jest.fn(() => forkEm),
  }
  return { em: em as unknown as EntityManager, flush, forkFlush, persist, instance }
}

const container = { resolve: jest.fn(() => undefined) } as unknown as AwilixContainer

function complete(em: EntityManager, overrides: Partial<Parameters<typeof completeUserTask>[2]> = {}) {
  return completeUserTask(em, container, {
    taskId: TASK_ID,
    formData: { approved: true },
    userId: USER,
    scope: { tenantId: TENANT, organizationId: ORG },
    ...overrides,
  })
}

function vetoGuard(overrides: Partial<TaskCompletionGuard> = {}): TaskCompletionGuard {
  return {
    id: 'host.signed-contract',
    evaluate: jest.fn(async () => ({
      ok: false as const,
      code: 'CONTRACT_NOT_SIGNED',
      messageKey: 'host.tasks.contractNotSigned',
      message: 'The contract must be signed first',
    })),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  clearTaskCompletionGuards()
  findDefinitionForInstance.mockImplementation(async () => ({
    definition: {
      steps: [{ stepId: 'review', stepType: 'USER_TASK', userTaskConfig: { formKey: 'contract-review' } }],
      transitions: [],
    },
  }))
})

describe('registry', () => {
  test('merges by module id: re-registering a module replaces only its own guards', () => {
    registerTaskCompletionGuards([{ moduleId: 'a', guards: [vetoGuard({ id: 'a.one' })] }])
    registerTaskCompletionGuards([{ moduleId: 'b', guards: [vetoGuard({ id: 'b.one' })] }])
    registerTaskCompletionGuards([{ moduleId: 'a', guards: [vetoGuard({ id: 'a.two' })] }])

    expect(getTaskCompletionGuards().map((entry) => entry.guard.id).sort()).toEqual(['a.two', 'b.one'])
  })

  test('selects on workflow id, step id and form key; an omitted selector matches anything', () => {
    const target = {
      workflowId: 'contract-approval',
      workflowInstanceId: INSTANCE_ID,
      stepId: 'review',
      formKey: 'contract-review',
    }
    expect(taskCompletionGuardApplies(vetoGuard(), target)).toBe(true)
    expect(taskCompletionGuardApplies(vetoGuard({ workflowId: 'contract-approval', stepId: ['review', 'sign'] }), target)).toBe(true)
    expect(taskCompletionGuardApplies(vetoGuard({ formKey: 'contract-review' }), target)).toBe(true)
    expect(taskCompletionGuardApplies(vetoGuard({ workflowId: 'other' }), target)).toBe(false)
    expect(taskCompletionGuardApplies(vetoGuard({ stepId: 'sign' }), target)).toBe(false)
    expect(taskCompletionGuardApplies(vetoGuard({ formKey: 'x' }), { ...target, formKey: null })).toBe(false)
  })
})

describe('completeUserTask with completion guards', () => {
  test('a vetoing guard blocks the direct call with its own code and mutates nothing', async () => {
    const task = makeTask()
    const { em, flush, persist } = makeEm(task)
    registerTaskCompletionGuards([{ moduleId: 'host', guards: [vetoGuard()] }])

    const failure = await complete(em).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TaskCompletionBlockedError)
    expect(failure).toBeInstanceOf(UserTaskError)
    expect(isTaskCompletionBlockedError(failure)).toBe(true)
    expect(failure).toMatchObject({
      code: 'CONTRACT_NOT_SIGNED',
      status: 409,
      guardId: 'host.signed-contract',
      messageKey: 'host.tasks.contractNotSigned',
    })
    expect((failure as TaskCompletionBlockedError).body).toEqual({
      error: 'The contract must be signed first',
      code: 'CONTRACT_NOT_SIGNED',
      guardId: 'host.signed-contract',
      messageKey: 'host.tasks.contractNotSigned',
    })
    expect(task.status).toBe('PENDING')
    expect(task.completedBy).toBeUndefined()
    expect(flush).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(exitStep).not.toHaveBeenCalled()
  })

  test('hands the guard the trusted scope, the resolved selectors and the submission', async () => {
    const evaluate = jest.fn(async (_input: TaskCompletionGuardInput) => ({ ok: true as const }))
    const { em } = makeEm(makeTask())
    registerTaskCompletionGuards([
      { moduleId: 'host', guards: [{ id: 'host.inspect', workflowId: 'contract-approval', evaluate }] },
    ])

    await complete(em)

    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate.mock.calls[0][0]).toMatchObject({
      mode: 'complete',
      tenantId: TENANT,
      organizationId: ORG,
      userId: USER,
      workflowId: 'contract-approval',
      workflowInstanceId: INSTANCE_ID,
      stepId: 'review',
      formKey: 'contract-review',
      formData: { approved: true },
      decisionId: null,
      task: expect.objectContaining({ id: TASK_ID, status: 'PENDING' }),
    })
  })

  test('a passing guard lets the completion through', async () => {
    const task = makeTask()
    const { em } = makeEm(task)
    registerTaskCompletionGuards([
      { moduleId: 'host', guards: [{ id: 'host.ok', evaluate: async () => ({ ok: true }) }] },
    ])

    await complete(em)

    expect(task.status).toBe('COMPLETED')
    expect(exitStep).toHaveBeenCalledTimes(1)
  })

  test('a guard selecting another workflow does not apply', async () => {
    const task = makeTask()
    const { em } = makeEm(task)
    const guard = vetoGuard({ workflowId: 'some-other-workflow' })
    registerTaskCompletionGuards([{ moduleId: 'host', guards: [guard] }])

    await complete(em)

    expect(guard.evaluate).not.toHaveBeenCalled()
    expect(task.status).toBe('COMPLETED')
  })

  test('a throwing guard fails closed without leaking its error', async () => {
    const task = makeTask()
    const { em, flush } = makeEm(task)
    registerTaskCompletionGuards([
      {
        moduleId: 'host',
        guards: [{ id: 'host.broken', evaluate: async () => { throw new Error('db password=secret') } }],
      },
    ])

    const failure = await complete(em).catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: TASK_COMPLETION_GUARD_FAILED_CODE, guardId: 'host.broken', status: 409 })
    expect((failure as Error).message).not.toContain('secret')
    expect(task.status).toBe('PENDING')
    expect(flush).not.toHaveBeenCalled()
  })

  test('a malformed answer blocks, and a missing code falls back to the generic one', async () => {
    const { em } = makeEm(makeTask())
    registerTaskCompletionGuards([
      { moduleId: 'host', guards: [{ id: 'host.sloppy', evaluate: async () => ({}) as never }] },
    ])

    await expect(complete(em)).rejects.toMatchObject({ code: TASK_COMPLETION_BLOCKED_CODE })
  })

  test('runs guards by priority and stops at the first veto', async () => {
    const later = vetoGuard({ id: 'host.later', priority: 90 })
    const first = vetoGuard({
      id: 'host.first',
      priority: 10,
      evaluate: jest.fn(async () => ({ ok: false as const, code: 'FIRST' })),
    })
    const { em } = makeEm(makeTask())
    registerTaskCompletionGuards([{ moduleId: 'host', guards: [later, first] }])

    await expect(complete(em)).rejects.toMatchObject({ code: 'FIRST', guardId: 'host.first' })
    expect(later.evaluate).not.toHaveBeenCalled()
  })

  test('regression: with no guard registered completion is unchanged and loads nothing extra', async () => {
    const task = makeTask()
    const { em } = makeEm(task)

    await complete(em)

    expect(task.status).toBe('COMPLETED')
    expect(task.completedBy).toBe(USER)
    expect(task.formData).toEqual({ approved: true })
    expect(exitStep).toHaveBeenCalledTimes(1)
    const lookups = (em.findOne as jest.Mock).mock.calls.map(([entity]) => (entity as { name: string }).name)
    expect(lookups).toEqual(['UserTask', 'WorkflowInstance', 'StepInstance'])
  })
})

describe('evaluateTaskCompletionGuards preview', () => {
  test('evaluates on a fork in preview mode and never flushes', async () => {
    const task = makeTask()
    const { em, flush, forkFlush } = makeEm(task)
    const evaluate = jest.fn(async (input: TaskCompletionGuardInput) => {
      expect(input.em).not.toBe(em)
      return { ok: false as const, code: 'CONTRACT_NOT_SIGNED', messageKey: 'host.tasks.contractNotSigned' }
    })
    registerTaskCompletionGuards([{ moduleId: 'host', guards: [{ id: 'host.preview', evaluate }] }])

    const block = await evaluateTaskCompletionGuards(em, container, task as unknown as UserTask, {
      mode: 'preview',
      userId: USER,
    })

    expect(block).toEqual({
      guardId: 'host.preview',
      code: 'CONTRACT_NOT_SIGNED',
      messageKey: 'host.tasks.contractNotSigned',
      message: null,
    })
    expect(evaluate.mock.calls[0][0]).toMatchObject({ mode: 'preview', formData: null, decisionId: null })
    expect(flush).not.toHaveBeenCalled()
    expect(forkFlush).not.toHaveBeenCalled()
    expect(task.status).toBe('PENDING')
  })

  test('returns null without touching the database when nothing is registered', async () => {
    const task = makeTask()
    const { em } = makeEm(task)

    const block = await evaluateTaskCompletionGuards(em, container, task as unknown as UserTask, {
      mode: 'preview',
      userId: USER,
    })

    expect(block).toBeNull()
    expect(em.findOne).not.toHaveBeenCalled()
  })
})
