/**
 * Step failures outside the executor main loop (#8791).
 *
 * Only `executeWorkflow` used to turn a rejected transition into a failed run.
 * Every other place a step gets entered — task completion, the SLA-breach
 * route, signal / timer / condition resumes and the async-activity resume —
 * dropped the `{ success: false }` and left the run non-terminal with no error,
 * which also put it out of reach of retry and bulk replay.
 *
 * Each entry point here is driven against the REAL `handleTransitionFailure`
 * and `completeWorkflow`, so the assertions are on the run's own state.
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../../events', () => {
  const actual = jest.requireActual('../../events') as Record<string, unknown>
  return { ...actual, emitWorkflowsEvent: jest.fn() }
})

jest.mock('../compensation-handler', () => ({
  compensateWorkflow: jest.fn(),
}))

jest.mock('../activity-executor', () => {
  const actual = jest.requireActual('../activity-executor') as Record<string, unknown>
  return {
    ...actual,
    enqueueTaskSlaJob: jest.fn(),
    enqueueConditionCheckJob: jest.fn(),
    enqueueTimerJob: jest.fn(),
  }
})

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitWorkflowsEvent } from '../../events'
import * as transitionHandler from '../transition-handler'
import * as stepHandler from '../step-handler'
import * as workflowExecutor from '../workflow-executor'
import { completeUserTask } from '../task-handler'
import { runTaskSlaJob } from '../task-sla'
import { sendSignal, SignalError } from '../signal-handler'
import { fireTimer, TimerError } from '../timer-handler'
import { evaluateWaitCondition, ConditionWaitError } from '../condition-handler'
import { SLA_BREACH_TRANSITION_KIND } from '../breach-routing'
import { ERROR_TRANSITION_KIND, WORKFLOW_ERROR_CONTEXT_KEY } from '../error-routing'
import type { TransitionExecutionResult } from '../transition-handler'

const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const definitionId = '00000000-0000-4000-8000-000000000003'
const instanceId = '00000000-0000-4000-8000-000000000004'
const stepInstanceId = '00000000-0000-4000-8000-000000000005'
const taskId = '00000000-0000-4000-8000-000000000006'
const userId = '00000000-0000-4000-8000-000000000007'

const STEP_FAILURE = 'Invalid user task deadline: not-a-duration'

type Row = Record<string, any>

type World = {
  instance: Row
  definition: Row
  stepInstance: Row
  task: Row | null
  events: Row[]
}

function entityName(entity: unknown): string {
  return (entity as { name?: string })?.name ?? ''
}

function makeEm(world: World): jest.Mocked<EntityManager> {
  const em: Record<string, unknown> = {}
  const findOne = jest.fn(async (entity: unknown, where: unknown) => {
    const id = typeof where === 'string' ? where : (where as { id?: unknown } | null)?.id
    const pick = (row: Row | null) => (row && (id === undefined || id === row.id) ? row : null)
    switch (entityName(entity)) {
      case 'WorkflowInstance': {
        const status = (where as { status?: unknown } | null)?.status
        if (typeof status === 'string' && status !== world.instance.status) return null
        return pick(world.instance)
      }
      case 'WorkflowDefinition':
        return pick(world.definition)
      case 'StepInstance':
        return pick(world.stepInstance)
      case 'UserTask':
        return pick(world.task)
      default:
        return null
    }
  })
  Object.assign(em, {
    findOne,
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn((entity: unknown, data: Row) => {
      const row = { ...data }
      if (entityName(entity) === 'WorkflowEvent') world.events.push(row)
      return row
    }),
    persist: jest.fn(() => em),
    flush: jest.fn(async () => undefined),
    nativeUpdate: jest.fn(async () => 1),
    transactional: jest.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback(em)),
    fork: jest.fn(() => em),
  })
  return em as unknown as jest.Mocked<EntityManager>
}

function makeInstance(overrides: Row = {}): Row {
  return {
    id: instanceId,
    definitionId,
    workflowId: 'out-of-loop',
    version: 1,
    status: 'PAUSED',
    currentStepId: 'waiting',
    context: {},
    metadata: {},
    tenantId,
    organizationId,
    startedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    retryCount: 0,
    waitVersion: 0,
    ...overrides,
  }
}

function makeDefinition(waitingStep: Row, extraTransitions: Row[] = []): Row {
  return {
    id: definitionId,
    workflowId: 'out-of-loop',
    version: 1,
    enabled: true,
    tenantId,
    organizationId,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'waiting', stepName: 'Waiting', ...waitingStep },
        { stepId: 'next', stepName: 'Next', stepType: 'USER_TASK' },
        { stepId: 'recover', stepName: 'Recover', stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't_start', fromStepId: 'start', toStepId: 'waiting', trigger: 'auto' },
        { transitionId: 't_next', fromStepId: 'waiting', toStepId: 'next', trigger: 'auto' },
        { transitionId: 't_end', fromStepId: 'next', toStepId: 'end', trigger: 'auto' },
        ...extraTransitions,
      ],
    },
  }
}

function makeStepInstance(overrides: Row = {}): Row {
  return {
    id: stepInstanceId,
    workflowInstanceId: instanceId,
    branchInstanceId: null,
    stepId: 'waiting',
    stepName: 'Waiting',
    status: 'ACTIVE',
    enteredAt: new Date(Date.now() - 1000),
    tenantId,
    organizationId,
    ...overrides,
  }
}

const stepFailure: TransitionExecutionResult = { success: false, error: STEP_FAILURE }

function eventTypes(world: World): string[] {
  return world.events.map((event) => event.eventType as string)
}

function expectRunFailed(world: World): void {
  expect(world.instance.status).toBe('FAILED')
  expect(world.instance.errorMessage).toBe(STEP_FAILURE)
  expect(world.instance.completedAt).toBeInstanceOf(Date)
  expect(eventTypes(world)).toContain('WORKFLOW_FAILED')
  expect(emitWorkflowsEvent).toHaveBeenCalledWith(
    'workflows.instance.failed',
    expect.objectContaining({ id: instanceId, status: 'FAILED' }),
    expect.anything()
  )
}

/**
 * A stand-in for `executeTransition` entering a step that fails: the cursor
 * advances onto the destination before the step's own failure is reported,
 * exactly as `transition-handler` does.
 */
function failingTransition(world: World, result: TransitionExecutionResult = stepFailure) {
  return jest.fn(async (...args: unknown[]) => {
    world.instance.currentStepId = args[4] as string
    return result
  })
}

describe('step failures outside the executor main loop (#8791)', () => {
  let world: World
  let em: jest.Mocked<EntityManager>
  let executeWorkflowDi: jest.Mock
  let exitStep: jest.Mock
  let findValidTransitions: jest.Mock
  let executeTransition: jest.Mock
  let container: AwilixContainer

  function buildContainer(): AwilixContainer {
    return {
      resolve: jest.fn((token: string) => {
        switch (token) {
          case 'eventLogger':
            return {
              logWorkflowEvent: async (_em: unknown, event: Row) => {
                world.events.push(event)
                return event
              },
            }
          case 'stepHandler':
            return { exitStep }
          case 'transitionHandler':
            return { findValidTransitions, executeTransition }
          case 'workflowExecutor':
            return { executeWorkflow: executeWorkflowDi, completeWorkflow: workflowExecutor.completeWorkflow }
          default:
            throw new Error(`Unexpected DI token in test: ${token}`)
        }
      }),
    } as unknown as AwilixContainer
  }

  function setup(waitingStep: Row, options: { extraTransitions?: Row[]; instance?: Row; stepInstance?: Row; task?: Row | null } = {}) {
    world = {
      instance: makeInstance(options.instance),
      definition: makeDefinition(waitingStep, options.extraTransitions),
      stepInstance: makeStepInstance(options.stepInstance),
      task: options.task ?? null,
      events: [],
    }
    em = makeEm(world)
    mockFindOneWithDecryption.mockImplementation(((emArg: EntityManager, entity: unknown, where: unknown) =>
      emArg.findOne(entity as never, where as never)) as never)
    mockFindWithDecryption.mockResolvedValue([] as never)
    executeTransition = failingTransition(world)
    findValidTransitions = jest.fn(async () => [
      {
        isValid: true,
        transition: { transitionId: 't_next', fromStepId: 'waiting', toStepId: 'next', trigger: 'auto' },
      },
    ])
    container = buildContainer()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    executeWorkflowDi = jest.fn(async () => ({}))
    exitStep = jest.fn(async () => undefined)
    ;(emitWorkflowsEvent as jest.Mock).mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('USER_TASK completion', () => {
    const task = (): Row => ({
      id: taskId,
      tenantId,
      organizationId,
      workflowInstanceId: instanceId,
      stepInstanceId,
      taskName: 'Approve',
      status: 'PENDING',
      assignedTo: userId,
      assignedToRoles: null,
      claimedBy: null,
      branchInstanceId: null,
      formSchema: null,
      updatedAt: new Date(),
    })

    function spyOnEngine() {
      jest.spyOn(stepHandler, 'exitStep').mockResolvedValue(undefined as never)
      jest.spyOn(transitionHandler, 'findValidTransitions').mockImplementation(findValidTransitions as never)
      return jest.spyOn(workflowExecutor, 'executeWorkflow').mockResolvedValue({} as never)
    }

    test('fails the run when the step entered after the task fails', async () => {
      setup({ stepType: 'USER_TASK' }, { task: task() })
      const executeWorkflow = spyOnEngine()
      jest.spyOn(transitionHandler, 'executeTransition').mockImplementation(executeTransition as never)

      await completeUserTask(em, container, {
        taskId,
        formData: {},
        userId,
        scope: { tenantId, organizationId },
      })

      expect(world.task?.status).toBe('COMPLETED')
      expectRunFailed(world)
      expect(executeWorkflow).not.toHaveBeenCalled()
    })

    test('follows a wired error route out of the failed step and keeps the run going', async () => {
      setup(
        { stepType: 'USER_TASK' },
        {
          task: task(),
          extraTransitions: [
            { transitionId: 't_recover', fromStepId: 'next', toStepId: 'recover', trigger: 'auto', kind: ERROR_TRANSITION_KIND },
          ],
        }
      )
      const executeWorkflow = spyOnEngine()
      const transitionSpy = jest
        .spyOn(transitionHandler, 'executeTransition')
        .mockImplementation(async (_em, _container, instance, _from, toStepId) => {
          ;(instance as Row).currentStepId = toStepId
          if (toStepId === 'next') {
            return {
              success: false,
              error: STEP_FAILURE,
              failedStepId: 'next',
              errorRoute: { transitionId: 't_recover', toStepId: 'recover' },
            }
          }
          return { success: true, nextStepId: toStepId }
        })

      await completeUserTask(em, container, {
        taskId,
        formData: {},
        userId,
        scope: { tenantId, organizationId },
      })

      expect(transitionSpy).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'next',
        'recover',
        expect.objectContaining({ transitionId: 't_recover' })
      )
      expect(world.instance.status).not.toBe('FAILED')
      expect(world.instance.context[WORKFLOW_ERROR_CONTEXT_KEY]).toMatchObject({ stepId: 'next', message: STEP_FAILURE })
      expect(eventTypes(world)).toContain('ERROR_ROUTED')
      expect(executeWorkflow).toHaveBeenCalledWith(em, container, instanceId, { userId })
    })

    test('parks the run for triage when the failed step carries a failure-queue directive', async () => {
      setup({ stepType: 'USER_TASK' }, { task: task() })
      spyOnEngine()
      jest.spyOn(transitionHandler, 'executeTransition').mockImplementation(
        failingTransition(world, {
          success: false,
          error: STEP_FAILURE,
          failedStepId: 'next',
          parkForAttention: true,
        }) as never
      )

      await completeUserTask(em, container, {
        taskId,
        formData: {},
        userId,
        scope: { tenantId, organizationId },
      })

      expect(world.instance.status).toBe('PAUSED')
      expect(world.instance.metadata.attention).toMatchObject({ reason: 'ERROR_DIRECTIVE', stepId: 'next' })
      expect(eventTypes(world)).toContain('ERROR_PARKED')
    })
  })

  test('SLA-breach route: fails the run when the breach target step fails', async () => {
    setup(
      { stepType: 'USER_TASK' },
      {
        task: {
          id: taskId,
          taskName: 'Approve',
          status: 'PENDING',
          assignedTo: userId,
          assignedToRoles: null,
          claimedBy: null,
          entityBindings: null,
          updatedAt: new Date(),
        },
        extraTransitions: [
          { transitionId: 't_breach', fromStepId: 'waiting', toStepId: 'next', trigger: 'auto', kind: SLA_BREACH_TRANSITION_KIND },
        ],
      }
    )

    const outcome = await runTaskSlaJob(em, container, {
      userTaskId: taskId,
      stepInstanceId,
      workflowInstanceId: instanceId,
      phase: 'breach',
      deadlineAt: new Date(Date.now() - 1000).toISOString(),
      tenantId,
      organizationId,
    })

    expect(outcome).toBe('breached')
    expect(executeTransition).toHaveBeenCalled()
    expectRunFailed(world)
    expect(executeWorkflowDi).not.toHaveBeenCalled()
  })

  test('signal resume: fails the run, then still reports TRANSITION_FAILED to the caller', async () => {
    setup({ stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: 'approved' } })

    const delivery = sendSignal(em, container, {
      instanceId,
      signalName: 'approved',
      payload: {},
      userId,
      tenantId,
      organizationId,
    })

    await expect(delivery).rejects.toMatchObject({
      name: 'SignalError',
      code: 'TRANSITION_FAILED',
      details: { error: STEP_FAILURE },
    })
    await expect(delivery).rejects.toBeInstanceOf(SignalError)
    expectRunFailed(world)
    expect(executeWorkflowDi).not.toHaveBeenCalled()
  })

  test('timer resume: fails the run, then still reports TRANSITION_FAILED to the caller', async () => {
    setup({ stepType: 'WAIT_FOR_TIMER', config: { duration: 'PT5M' } })

    const fired = fireTimer(em, container, {
      instanceId,
      stepInstanceId,
      tenantId,
      organizationId,
    })

    await expect(fired).rejects.toMatchObject({ code: 'TRANSITION_FAILED', details: { error: STEP_FAILURE } })
    await expect(fired).rejects.toBeInstanceOf(TimerError)
    expectRunFailed(world)
    expect(executeWorkflowDi).not.toHaveBeenCalled()
  })

  test('timer resume: a wired error route is followed instead of failing', async () => {
    setup(
      { stepType: 'WAIT_FOR_TIMER', config: { duration: 'PT5M' } },
      {
        extraTransitions: [
          { transitionId: 't_recover', fromStepId: 'next', toStepId: 'recover', trigger: 'auto', kind: ERROR_TRANSITION_KIND },
        ],
      }
    )
    executeTransition = failingTransition(world, {
      success: false,
      error: STEP_FAILURE,
      failedStepId: 'next',
      errorRoute: { transitionId: 't_recover', toStepId: 'recover' },
    })
    container = buildContainer()
    const routeSpy = jest
      .spyOn(transitionHandler, 'executeTransition')
      .mockResolvedValue({ success: true, nextStepId: 'recover' })

    await fireTimer(em, container, { instanceId, stepInstanceId, tenantId, organizationId })

    expect(routeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'next',
      'recover',
      expect.objectContaining({ transitionId: 't_recover' })
    )
    expect(world.instance.status).not.toBe('FAILED')
    expect(eventTypes(world)).toContain('ERROR_ROUTED')
    expect(executeWorkflowDi).toHaveBeenCalledWith(em, container, instanceId, expect.anything())
  })

  test('condition resume: fails the run, then still reports TRANSITION_FAILED to the caller', async () => {
    setup(
      {
        stepType: 'WAIT_FOR_CONDITION',
        config: {
          condition: { operator: 'AND', rules: [{ field: 'payment.status', operator: '==', value: 'captured' }] },
          timeout: 'PT30M',
        },
      },
      {
        instance: { context: { payment: { status: 'captured' } } },
        stepInstance: { stepType: 'WAIT_FOR_CONDITION' },
      }
    )

    const evaluation = evaluateWaitCondition(em, container, {
      instanceId,
      stepInstanceId,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      attempt: 1,
      tenantId,
      organizationId,
    })

    await expect(evaluation).rejects.toMatchObject({ code: 'TRANSITION_FAILED', details: { error: STEP_FAILURE } })
    await expect(evaluation).rejects.toBeInstanceOf(ConditionWaitError)
    expectRunFailed(world)
    expect(executeWorkflowDi).not.toHaveBeenCalled()
  })

  describe('async-activity resume', () => {
    function setupWaiting(waitingStep: Row = { stepType: 'AUTOMATED' }) {
      setup(waitingStep, {
        instance: {
          status: 'WAITING_FOR_ACTIVITIES',
          pendingTransition: { toStepId: 'next', activityResults: [], timestamp: new Date() },
        },
      })
    }

    test('fails the run when the resumed step fails instead of ignoring the result', async () => {
      setupWaiting()
      const executeStep = jest
        .spyOn(stepHandler, 'executeStep')
        .mockResolvedValue({ status: 'FAILED', error: STEP_FAILURE })

      await workflowExecutor.resumeWorkflowAfterActivities(em, container, instanceId)

      expect(executeStep).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: instanceId }),
        'next',
        expect.anything(),
        container
      )
      expectRunFailed(world)
    })

    test('honours a failure-queue directive on the resumed step', async () => {
      setupWaiting()
      ;(world.definition.definition.steps as Row[]).find((step) => step.stepId === 'next')!.errorDirective = {
        mode: 'failureQueue',
      }
      jest.spyOn(stepHandler, 'executeStep').mockResolvedValue({ status: 'FAILED', error: STEP_FAILURE })

      await workflowExecutor.resumeWorkflowAfterActivities(em, container, instanceId)

      expect(world.instance.status).toBe('PAUSED')
      expect(world.instance.metadata.attention).toMatchObject({ reason: 'ERROR_DIRECTIVE', stepId: 'next' })
      expect(eventTypes(world)).toContain('ERROR_PARKED')
    })

    test('continueWithFallback advances with the fallback value instead of failing', async () => {
      setupWaiting()
      ;(world.definition.definition.steps as Row[]).find((step) => step.stepId === 'next')!.errorDirective = {
        mode: 'continueWithFallback',
        fallbackValue: { ok: false },
      }
      jest.spyOn(stepHandler, 'executeStep').mockResolvedValue({ status: 'FAILED', error: STEP_FAILURE })
      const loop = jest.spyOn(workflowExecutor, 'executeWorkflow')

      await workflowExecutor.resumeWorkflowAfterActivities(em, container, instanceId).catch(() => undefined)

      expect(world.instance.status).not.toBe('FAILED')
      expect(world.instance.context.next).toEqual({ ok: false })
      expect(eventTypes(world)).toContain('ERROR_DIRECTIVE_APPLIED')
      loop.mockRestore()
    })
  })
})
