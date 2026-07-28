/**
 * Workflow-level error handler (spec 5.9) — the engine construct, not an event
 * trigger. Covers the design note's own risk list: the handler receives
 * `{ failedStepId, error, contextSnapshot }`, the recursion guard holds,
 * scheduling happens before compensation with a pre-compensation snapshot, a
 * propagated branch failure schedules exactly one handler, and definitions
 * without a handler are unaffected.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  WORKFLOW_MAX_ERROR_HANDLER_DEPTH,
  readErrorHandlerDepth,
  runWorkflowErrorHandler,
  scheduleWorkflowErrorHandler,
} from '../error-handler'
import { readWorkflowErrorHandler, resolveStepFailureHandling } from '../error-routing'
import * as workflowExecutor from '../workflow-executor'
import * as transitionHandler from '../transition-handler'
import * as stepHandler from '../step-handler'
import * as ruleEvaluator from '../../../business_rules/lib/rule-evaluator'
import { compensateWorkflow } from '../compensation-handler'
import type { WorkflowActivityJobErrorHandler } from '../activity-queue-types'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

const enqueue = jest.fn<(job: unknown) => Promise<string>>()

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue })),
}))
jest.mock('../../../business_rules/lib/rule-evaluator')
jest.mock('../../../business_rules/lib/rule-engine')
jest.mock('../activity-executor')
jest.mock('../step-handler')
jest.mock('../compensation-handler', () => ({
  compensateWorkflow: jest.fn(),
}))

const testTenantId = '00000000-0000-4000-8000-000000000001'
const testOrgId = '00000000-0000-4000-8000-000000000002'
const testDefinitionId = '00000000-0000-4000-8000-000000000003'
const testInstanceId = '00000000-0000-4000-8000-000000000004'
const handlerInstanceId = '00000000-0000-4000-8000-000000000005'

const steps = [
  { stepId: 'start', stepName: 'Start', stepType: 'START' },
  { stepId: 'risky', stepName: 'Risky', stepType: 'AUTOMATED' },
  { stepId: 'handle', stepName: 'Handle', stepType: 'AUTOMATED' },
  { stepId: 'end', stepName: 'End', stepType: 'END' },
]

const failingTransition = {
  transitionId: 't_start_risky',
  fromStepId: 'start',
  toStepId: 'risky',
  trigger: 'auto',
  activities: [
    {
      activityId: 'a1',
      activityName: 'Charge',
      activityType: 'CALL_API',
      config: {},
      compensation: { activityId: 'refund' },
    },
  ],
}

function makeDefinition(errorHandler?: Record<string, unknown>): WorkflowDefinition {
  return {
    id: testDefinitionId,
    workflowId: 'handled-workflow',
    version: 1,
    enabled: true,
    definition: {
      steps,
      transitions: [failingTransition],
      ...(errorHandler ? { errorHandler } : {}),
    },
    tenantId: testTenantId,
    organizationId: testOrgId,
  } as unknown as WorkflowDefinition
}

function makeInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: testInstanceId,
    definitionId: testDefinitionId,
    workflowId: 'handled-workflow',
    version: 1,
    status: 'RUNNING',
    currentStepId: 'start',
    context: { orderId: 'ord-1' },
    tenantId: testTenantId,
    organizationId: testOrgId,
    startedAt: new Date(),
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as WorkflowInstance
}

function makeEm(definition: WorkflowDefinition, instance: WorkflowInstance): jest.Mocked<EntityManager> {
  const em = {
    findOne: jest.fn(async (_entity: unknown, where: unknown) => {
      const id = (where as { id?: string })?.id
      if (id === testInstanceId) return instance
      if (id === testDefinitionId) return definition
      return null
    }),
    find: jest.fn(),
    create: jest.fn((_entity: unknown, payload: unknown) => payload),
    persist: jest.fn(function persist(this: unknown) {
      return this
    }),
    flush: jest.fn(),
    transactional: jest.fn(async (callback: (trx: EntityManager) => Promise<unknown>) =>
      callback(em as unknown as EntityManager)
    ),
  } as unknown as jest.Mocked<EntityManager>
  return em
}

function createdEvents(em: jest.Mocked<EntityManager>): Array<Record<string, unknown>> {
  return em.create.mock.calls
    .map(([, payload]) => payload as Record<string, unknown>)
    .filter((payload) => typeof payload?.eventType === 'string')
}

describe('workflow-level error handler — configuration', () => {
  test('reads exactly one declared form', () => {
    expect(readWorkflowErrorHandler({ errorHandler: { workflowId: 'oops-handler' } })).toEqual({
      workflowId: 'oops-handler',
      version: undefined,
    })
    expect(readWorkflowErrorHandler({ errorHandler: { stepId: 'handle' } })).toEqual({ stepId: 'handle' })
    expect(readWorkflowErrorHandler({ errorHandler: { workflowId: 'a', stepId: 'b' } })).toBeNull()
    expect(readWorkflowErrorHandler({})).toBeNull()
  })

  test('the handler step is the last resort and never jumps a step to itself', () => {
    const definition = { steps, transitions: [], errorHandler: { stepId: 'handle' } }
    expect(resolveStepFailureHandling(definition, 'risky')).toEqual({ kind: 'handlerStep', stepId: 'handle' })
    expect(resolveStepFailureHandling(definition, 'handle')).toEqual({ kind: 'fail' })

    const withDirective = {
      ...definition,
      steps: steps.map((step) =>
        step.stepId === 'risky' ? { ...step, errorDirective: { mode: 'failureQueue' } } : step
      ),
    }
    expect(resolveStepFailureHandling(withDirective, 'risky')).toEqual({ kind: 'park' })
  })
})

describe('workflow-level error handler — scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    enqueue.mockResolvedValue('job-1')
  })

  test('passes the failure triple and the recursion depth to the queue job', async () => {
    const definition = makeDefinition({ workflowId: 'oops-handler', version: 2 })
    const instance = makeInstance({ currentStepId: 'risky', context: { orderId: 'ord-1' } })
    const em = makeEm(definition, instance)

    const scheduled = await scheduleWorkflowErrorHandler(em, instance, {
      failedStepId: 'risky',
      error: 'boom',
    })

    expect(scheduled).toBe(true)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      kind: 'workflow_error_handler',
      workflowInstanceId: testInstanceId,
      handlerWorkflowId: 'oops-handler',
      handlerVersion: 2,
      failedStepId: 'risky',
      error: 'boom',
      contextSnapshot: { orderId: 'ord-1' },
      depth: 1,
      tenantId: testTenantId,
      organizationId: testOrgId,
    })
    expect(createdEvents(em).map((event) => event.eventType)).toContain('ERROR_HANDLER_SCHEDULED')
  })

  test('the recursion guard stops a failing handler from scheduling another handler', async () => {
    const definition = makeDefinition({ workflowId: 'oops-handler' })
    const instance = makeInstance({
      metadata: {
        errorHandler: { depth: WORKFLOW_MAX_ERROR_HANDLER_DEPTH, forInstanceId: 'other', forStepId: 'risky' },
      },
    } as Partial<WorkflowInstance>)
    const em = makeEm(definition, instance)

    expect(readErrorHandlerDepth(instance)).toBe(WORKFLOW_MAX_ERROR_HANDLER_DEPTH)

    const scheduled = await scheduleWorkflowErrorHandler(em, instance, { failedStepId: 'risky', error: 'boom' })

    expect(scheduled).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
    const skipped = createdEvents(em).find((event) => event.eventType === 'ERROR_HANDLER_SKIPPED')
    expect(skipped?.eventData).toMatchObject({ reason: 'MAX_DEPTH' })
  })

  test('does nothing for a definition without a handler, or with the step form', async () => {
    const withoutHandler = makeEm(makeDefinition(), makeInstance())
    expect(await scheduleWorkflowErrorHandler(withoutHandler, makeInstance(), { error: 'boom' })).toBe(false)

    const stepForm = makeEm(makeDefinition({ stepId: 'handle' }), makeInstance())
    expect(await scheduleWorkflowErrorHandler(stepForm, makeInstance(), { error: 'boom' })).toBe(false)

    expect(enqueue).not.toHaveBeenCalled()
    expect(createdEvents(withoutHandler)).toEqual([])
  })
})

describe('workflow-level error handler — execution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    enqueue.mockResolvedValue('job-1')
  })

  test('starts the handler workflow with the triple as its context and a depth marker', async () => {
    const definition = makeDefinition({ workflowId: 'oops-handler' })
    const instance = makeInstance()
    const em = makeEm(definition, instance)
    const container = { resolve: jest.fn() } as unknown as jest.Mocked<AwilixContainer>

    const startWorkflowSpy = jest
      .spyOn(workflowExecutor, 'startWorkflow')
      .mockResolvedValue({ id: handlerInstanceId } as WorkflowInstance)
    const executeWorkflowSpy = jest
      .spyOn(workflowExecutor, 'executeWorkflow')
      .mockResolvedValue({ status: 'COMPLETED', events: [], executionTime: 0 } as never)

    const payload: WorkflowActivityJobErrorHandler = {
      kind: 'workflow_error_handler',
      workflowInstanceId: testInstanceId,
      handlerWorkflowId: 'oops-handler',
      failedStepId: 'risky',
      error: 'boom',
      contextSnapshot: { orderId: 'ord-1' },
      depth: 1,
      tenantId: testTenantId,
      organizationId: testOrgId,
    }

    const startedId = await runWorkflowErrorHandler(em, container, payload)

    expect(startedId).toBe(handlerInstanceId)
    expect(startWorkflowSpy).toHaveBeenCalledWith(
      em,
      expect.objectContaining({
        workflowId: 'oops-handler',
        initialContext: {
          failedStepId: 'risky',
          error: 'boom',
          contextSnapshot: { orderId: 'ord-1' },
        },
        metadata: expect.objectContaining({
          errorHandler: { depth: 1, forInstanceId: testInstanceId, forStepId: 'risky' },
        }),
        tenantId: testTenantId,
        organizationId: testOrgId,
      })
    )
    expect(executeWorkflowSpy).toHaveBeenCalledWith(em, container, handlerInstanceId)
    expect(createdEvents(em).map((event) => event.eventType)).toContain('ERROR_HANDLER_STARTED')

    startWorkflowSpy.mockRestore()
    executeWorkflowSpy.mockRestore()
  })

  test('refuses to start a handler for an instance outside the job scope', async () => {
    const em = makeEm(makeDefinition({ workflowId: 'oops-handler' }), makeInstance())
    const container = { resolve: jest.fn() } as unknown as jest.Mocked<AwilixContainer>
    const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')

    const started = await runWorkflowErrorHandler(em, container, {
      kind: 'workflow_error_handler',
      workflowInstanceId: 'ffffffff-0000-4000-8000-00000000ffff',
      handlerWorkflowId: 'oops-handler',
      failedStepId: 'risky',
      error: 'boom',
      contextSnapshot: {},
      depth: 1,
      tenantId: testTenantId,
      organizationId: testOrgId,
    })

    expect(started).toBeNull()
    expect(startWorkflowSpy).not.toHaveBeenCalled()

    startWorkflowSpy.mockRestore()
  })
})

describe('workflow-level error handler — engine integration', () => {
  let container: jest.Mocked<AwilixContainer>

  beforeEach(() => {
    jest.clearAllMocks()
    enqueue.mockResolvedValue('job-1')
    container = { resolve: jest.fn() } as unknown as jest.Mocked<AwilixContainer>
    ;(ruleEvaluator.evaluateConditions as jest.Mock).mockResolvedValue(true)
    ;(compensateWorkflow as jest.Mock).mockImplementation(async () => ({
      status: 'COMPENSATED',
      compensatedActivities: 1,
      totalActivities: 1,
    }))
  })

  test('schedules the handler before compensation and snapshots the pre-compensation context', async () => {
    const definition = makeDefinition({ workflowId: 'oops-handler' })
    const instance = makeInstance({ currentStepId: 'risky' })
    const em = makeEm(definition, instance)

    ;(compensateWorkflow as jest.Mock).mockImplementation(async () => {
      instance.context = { ...instance.context, compensated: true }
      return { status: 'COMPENSATED', compensatedActivities: 1, totalActivities: 1 }
    })

    await workflowExecutor.completeWorkflow(em, container, testInstanceId, 'FAILED', {
      error: 'boom',
      failedStepId: 'risky',
    })

    expect(enqueue).toHaveBeenCalledTimes(1)
    const job = enqueue.mock.calls[0][0] as WorkflowActivityJobErrorHandler
    expect(job.contextSnapshot).toEqual({ orderId: 'ord-1' })
    expect(job.failedStepId).toBe('risky')

    const eventTypes = createdEvents(em).map((event) => event.eventType)
    expect(eventTypes).toContain('ERROR_HANDLER_SCHEDULED')
    expect(compensateWorkflow).toHaveBeenCalled()
    const scheduledOrder = enqueue.mock.invocationCallOrder[0]
    const compensationOrder = (compensateWorkflow as jest.Mock).mock.invocationCallOrder[0]
    expect(scheduledOrder).toBeLessThan(compensationOrder)
  })

  test('a propagated branch failure schedules exactly one instance-level handler', async () => {
    const definition = makeDefinition({ workflowId: 'oops-handler' })
    const instance = makeInstance({ status: 'FORKED', currentStepId: 'risky' })
    const em = makeEm(definition, instance)

    jest.doMock('../parallel-handler', () => ({
      advanceBranches: jest.fn(async () => ({ outcome: 'failed', error: 'branch blew up' })),
    }))

    const result = await workflowExecutor.executeWorkflow(em, container, testInstanceId)

    expect(result.status).toBe('FAILED')
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect((enqueue.mock.calls[0][0] as WorkflowActivityJobErrorHandler).kind).toBe(
      'workflow_error_handler'
    )

    jest.dontMock('../parallel-handler')
  })

  test('definitions without a handler are unaffected', async () => {
    const definition = makeDefinition()
    const instance = makeInstance({ currentStepId: 'risky' })
    const em = makeEm(definition, instance)

    await workflowExecutor.completeWorkflow(em, container, testInstanceId, 'FAILED', { error: 'boom' })

    expect(enqueue).not.toHaveBeenCalled()
    expect(createdEvents(em).map((event) => event.eventType)).not.toContain('ERROR_HANDLER_SCHEDULED')
    expect(compensateWorkflow).toHaveBeenCalled()
  })

  test('the handler step form jumps the run to the handler step instead of failing', async () => {
    const definition = makeDefinition({ stepId: 'handle' })
    const instance = makeInstance({ currentStepId: 'start' })
    const em = makeEm(definition, instance)

    jest.spyOn(transitionHandler, 'findValidTransitions').mockResolvedValue([
      { isValid: true, transition: failingTransition },
    ])
    const executeTransitionSpy = jest.spyOn(transitionHandler, 'executeTransition').mockResolvedValue({
      success: false,
      error: 'boom',
      failedStepId: 'risky',
      errorHandlerStepId: 'handle',
    })
    ;(stepHandler.executeStep as jest.Mock).mockResolvedValue({ status: 'COMPLETED' })

    await workflowExecutor.executeWorkflow(em, container, testInstanceId)

    expect(stepHandler.executeStep).toHaveBeenCalledWith(
      expect.anything(),
      instance,
      'handle',
      expect.objectContaining({ workflowContext: expect.objectContaining({ __error: expect.anything() }) }),
      container
    )
    expect(instance.currentStepId).toBe('handle')
    expect(instance.status).toBe('RUNNING')
    expect(createdEvents(em).map((event) => event.eventType)).toContain('ERROR_HANDLER_STARTED')
    expect(compensateWorkflow).not.toHaveBeenCalled()

    executeTransitionSpy.mockRestore()
  })
})
