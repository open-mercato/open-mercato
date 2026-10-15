/**
 * Error routes + per-step error directives (spec 5.9)
 *
 * Covers the pure resolver, the transition-handler directive application
 * (including the `continueOnActivityFailure` alias), the executor's error-route
 * following and failure-queue park, and the regression that a definition with
 * no error configuration keeps producing the legacy failure trace.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  ERROR_TRANSITION_KIND,
  WORKFLOW_ERROR_CONTEXT_KEY,
  excludeErrorTransitions,
  findErrorTransition,
  isErrorTransition,
  resolveStepFailureHandling,
  validateErrorRoutes,
} from '../error-routing'
import * as transitionHandler from '../transition-handler'
import * as workflowExecutor from '../workflow-executor'
import * as activityExecutor from '../activity-executor'
import * as stepHandler from '../step-handler'
import * as ruleEvaluator from '../../../business_rules/lib/rule-evaluator'
import { compensateWorkflow } from '../compensation-handler'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

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

type DefinitionData = {
  steps: Array<Record<string, unknown>>
  transitions: Array<Record<string, unknown>>
}

function makeDefinition(data: DefinitionData): WorkflowDefinition {
  return {
    id: testDefinitionId,
    workflowId: 'error-workflow',
    workflowName: 'Error Workflow',
    version: 1,
    enabled: true,
    definition: data,
    tenantId: testTenantId,
    organizationId: testOrgId,
  } as unknown as WorkflowDefinition
}

function makeInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: testInstanceId,
    definitionId: testDefinitionId,
    workflowId: 'error-workflow',
    version: 1,
    status: 'RUNNING',
    currentStepId: 'risky',
    context: {},
    tenantId: testTenantId,
    organizationId: testOrgId,
    startedAt: new Date(),
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as WorkflowInstance
}

const baseSteps = [
  { stepId: 'start', stepName: 'Start', stepType: 'START' },
  { stepId: 'risky', stepName: 'Risky', stepType: 'AUTOMATED' },
  { stepId: 'recover', stepName: 'Recover', stepType: 'AUTOMATED' },
  { stepId: 'end', stepName: 'End', stepType: 'END' },
]

function createdEventTypes(em: jest.Mocked<EntityManager>): string[] {
  return em.create.mock.calls
    .map(([, payload]) => (payload as { eventType?: string })?.eventType)
    .filter((eventType): eventType is string => typeof eventType === 'string')
}

describe('error routing — pure resolver', () => {
  const definition: DefinitionData = {
    steps: [
      ...baseSteps.map((step) =>
        step.stepId === 'risky'
          ? { ...step, errorDirective: { mode: 'continueWithFallback', fallbackValue: { ok: false } } }
          : step
      ),
    ],
    transitions: [
      { transitionId: 't_start_risky', fromStepId: 'start', toStepId: 'risky', trigger: 'auto' },
      { transitionId: 't_risky_end', fromStepId: 'risky', toStepId: 'end', trigger: 'auto' },
      {
        transitionId: 't_risky_recover',
        fromStepId: 'risky',
        toStepId: 'recover',
        trigger: 'auto',
        kind: ERROR_TRANSITION_KIND,
      },
    ],
  }

  test('recognizes error transitions and filters them out of normal routing', () => {
    expect(isErrorTransition({ kind: 'error' })).toBe(true)
    expect(isErrorTransition({ kind: 'normal' })).toBe(false)
    expect(isErrorTransition({})).toBe(false)
    expect(excludeErrorTransitions(definition.transitions).map((t) => t.transitionId)).toEqual([
      't_start_risky',
      't_risky_end',
    ])
  })

  test('a wired error route wins over the step directive', () => {
    const handling = resolveStepFailureHandling(definition, 'risky')
    expect(handling.kind).toBe('route')
    expect(handling.kind === 'route' && handling.transition.toStepId).toBe('recover')
  })

  test('picks the highest-priority error route', () => {
    const withTwo: DefinitionData = {
      steps: baseSteps,
      transitions: [
        { transitionId: 'low', fromStepId: 'risky', toStepId: 'end', trigger: 'auto', kind: 'error', priority: 1 },
        { transitionId: 'high', fromStepId: 'risky', toStepId: 'recover', trigger: 'auto', kind: 'error', priority: 9 },
      ],
    }
    expect(findErrorTransition(withTwo, 'risky')?.transitionId).toBe('high')
  })

  test('falls back to the step directive, then to fail', () => {
    const withoutRoute: DefinitionData = {
      steps: definition.steps,
      transitions: definition.transitions.filter((t) => t.kind !== ERROR_TRANSITION_KIND),
    }
    expect(resolveStepFailureHandling(withoutRoute, 'risky')).toEqual({
      kind: 'continue',
      fallbackValue: { ok: false },
    })
    expect(resolveStepFailureHandling(withoutRoute, 'recover')).toEqual({ kind: 'fail' })
    expect(resolveStepFailureHandling(null, 'risky')).toEqual({ kind: 'fail' })
  })

  test('maps failureQueue to a park and an unknown directive mode to fail', () => {
    const parked: DefinitionData = {
      steps: [{ stepId: 'risky', errorDirective: { mode: 'failureQueue' } }],
      transitions: [],
    }
    expect(resolveStepFailureHandling(parked, 'risky')).toEqual({ kind: 'park' })

    const nonsense: DefinitionData = {
      steps: [{ stepId: 'risky', errorDirective: { mode: 'explode' } }],
      transitions: [],
    }
    expect(resolveStepFailureHandling(nonsense, 'risky')).toEqual({ kind: 'fail' })
  })

  test('flags an error route colliding with a normal route on the same pair', () => {
    const colliding: DefinitionData = {
      steps: baseSteps,
      transitions: [
        { transitionId: 'normal', fromStepId: 'risky', toStepId: 'recover', trigger: 'auto' },
        { transitionId: 'err', fromStepId: 'risky', toStepId: 'recover', trigger: 'auto', kind: 'error' },
      ],
    }
    const issues = validateErrorRoutes(colliding)
    expect(issues.map((issue) => issue.code)).toEqual(['ERROR_ROUTE_DUPLICATE_TARGET'])
    expect(validateErrorRoutes(definition)).toEqual([])
  })

  test('flags an error route pointing at an unknown step', () => {
    const dangling: DefinitionData = {
      steps: baseSteps,
      transitions: [
        { transitionId: 'err', fromStepId: 'risky', toStepId: 'ghost', trigger: 'auto', kind: 'error' },
      ],
    }
    expect(validateErrorRoutes(dangling).map((issue) => issue.code)).toEqual([
      'ERROR_ROUTE_UNKNOWN_TARGET',
    ])
  })
})

describe('error routing — transition handler', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((_entity: unknown, payload: unknown) => payload),
      persist: jest.fn(function persist(this: unknown) {
        return this
      }),
      flush: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>
    mockContainer = { resolve: jest.fn(() => { throw new Error('no service') }) } as unknown as jest.Mocked<AwilixContainer>
    ;(ruleEvaluator.evaluateConditions as jest.Mock).mockResolvedValue(true)
  })

  test('surfaces the wired error route instead of a bare failure when a step fails', async () => {
    const definition = makeDefinition({
      steps: baseSteps,
      transitions: [
        { transitionId: 't_start_risky', fromStepId: 'start', toStepId: 'risky', trigger: 'auto' },
        {
          transitionId: 't_risky_recover',
          fromStepId: 'risky',
          toStepId: 'recover',
          trigger: 'auto',
          kind: ERROR_TRANSITION_KIND,
        },
      ],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    mockEm.findOne.mockResolvedValue(definition)
    ;(stepHandler.executeStep as jest.Mock).mockResolvedValue({ status: 'FAILED', error: 'boom' })

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'risky',
      { workflowContext: {} }
    )

    expect(result.success).toBe(false)
    expect(result.failedStepId).toBe('risky')
    expect(result.errorRoute).toEqual({ transitionId: 't_risky_recover', toStepId: 'recover' })
    expect(result.parkForAttention).toBeUndefined()
  })

  test('continueWithFallback advances past a failed step and lands the fallback in context', async () => {
    const definition = makeDefinition({
      steps: baseSteps.map((step) =>
        step.stepId === 'risky'
          ? { ...step, errorDirective: { mode: 'continueWithFallback', fallbackValue: { score: 0 } } }
          : step
      ),
      transitions: [
        { transitionId: 't_start_risky', fromStepId: 'start', toStepId: 'risky', trigger: 'auto' },
      ],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    mockEm.findOne.mockResolvedValue(definition)
    ;(stepHandler.executeStep as jest.Mock).mockResolvedValue({ status: 'FAILED', error: 'boom' })

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'risky',
      { workflowContext: {} }
    )

    expect(result.success).toBe(true)
    expect(instance.context.risky).toEqual({ score: 0 })
    expect(createdEventTypes(mockEm)).toContain('ERROR_DIRECTIVE_APPLIED')
  })

  test('failureQueue asks the executor to park instead of failing', async () => {
    const definition = makeDefinition({
      steps: baseSteps.map((step) =>
        step.stepId === 'risky' ? { ...step, errorDirective: { mode: 'failureQueue' } } : step
      ),
      transitions: [
        { transitionId: 't_start_risky', fromStepId: 'start', toStepId: 'risky', trigger: 'auto' },
      ],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    mockEm.findOne.mockResolvedValue(definition)
    ;(stepHandler.executeStep as jest.Mock).mockResolvedValue({ status: 'FAILED', error: 'boom' })

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'risky',
      { workflowContext: {} }
    )

    expect(result.success).toBe(false)
    expect(result.parkForAttention).toBe(true)
    expect(result.failedStepId).toBe('risky')
  })

  test('continueWithFallback is the directive form of continueOnActivityFailure', async () => {
    const definition = makeDefinition({
      steps: baseSteps.map((step) =>
        step.stepId === 'start'
          ? { ...step, errorDirective: { mode: 'continueWithFallback', fallbackValue: 'fallback' } }
          : step
      ),
      transitions: [
        {
          transitionId: 't_start_risky',
          fromStepId: 'start',
          toStepId: 'risky',
          trigger: 'auto',
          activities: [
            { activityId: 'a1', activityName: 'Notify', activityType: 'SEND_EMAIL', config: {} },
          ],
        },
      ],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    mockEm.findOne.mockResolvedValue(definition)
    ;(activityExecutor.executeActivities as jest.Mock).mockResolvedValue([
      { success: false, activityId: 'a1', activityType: 'SEND_EMAIL', activityName: 'Notify', error: 'smtp down' },
    ])
    ;(stepHandler.executeStep as jest.Mock).mockResolvedValue({ status: 'COMPLETED' })

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'risky',
      { workflowContext: {} }
    )

    expect(result.success).toBe(true)
    expect(instance.context.start).toBe('fallback')
    expect(createdEventTypes(mockEm)).toContain('ERROR_DIRECTIVE_APPLIED')
  })

  test('the legacy continueOnActivityFailure flag keeps its exact behavior', async () => {
    const definition = makeDefinition({
      steps: baseSteps,
      transitions: [
        {
          transitionId: 't_start_risky',
          fromStepId: 'start',
          toStepId: 'risky',
          trigger: 'auto',
          continueOnActivityFailure: true,
          activities: [
            { activityId: 'a1', activityName: 'Notify', activityType: 'SEND_EMAIL', config: {} },
          ],
        },
      ],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    mockEm.findOne.mockResolvedValue(definition)
    ;(activityExecutor.executeActivities as jest.Mock).mockResolvedValue([
      { success: false, activityId: 'a1', activityType: 'SEND_EMAIL', activityName: 'Notify', error: 'smtp down' },
    ])
    ;(stepHandler.executeStep as jest.Mock).mockResolvedValue({ status: 'COMPLETED' })

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'risky',
      { workflowContext: {} }
    )

    expect(result.success).toBe(true)
    expect(instance.context.start).toBeUndefined()
    expect(createdEventTypes(mockEm)).not.toContain('ERROR_DIRECTIVE_APPLIED')
  })

  test('a definition without error configuration fails exactly as before', async () => {
    const definition = makeDefinition({
      steps: baseSteps,
      transitions: [
        { transitionId: 't_start_risky', fromStepId: 'start', toStepId: 'risky', trigger: 'auto' },
      ],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    mockEm.findOne.mockResolvedValue(definition)
    ;(stepHandler.executeStep as jest.Mock).mockResolvedValue({ status: 'FAILED', error: 'boom' })

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'risky',
      { workflowContext: {} }
    )

    expect(result).toEqual({ success: false, error: 'boom' })
    expect(createdEventTypes(mockEm)).not.toContain('ERROR_DIRECTIVE_APPLIED')
  })
})

describe('error routing — executor', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>

  const compensatableTransition = {
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

  function primeEm(definition: WorkflowDefinition, instance: WorkflowInstance): void {
    mockEm.findOne.mockImplementation(async (_entity: unknown, where: unknown) => {
      const id = (where as { id?: string })?.id
      if (id === testInstanceId) return instance
      if (id === testDefinitionId) return definition
      return null
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((_entity: unknown, payload: unknown) => payload),
      persist: jest.fn(function persist(this: unknown) {
        return this
      }),
      flush: jest.fn(),
      transactional: jest.fn(async (callback: (trx: EntityManager) => Promise<unknown>) => callback(mockEm)),
    } as unknown as jest.Mocked<EntityManager>
    mockContainer = { resolve: jest.fn() } as unknown as jest.Mocked<AwilixContainer>
    ;(ruleEvaluator.evaluateConditions as jest.Mock).mockResolvedValue(true)
    ;(compensateWorkflow as jest.Mock).mockResolvedValue({
      status: 'COMPENSATED',
      compensatedActivities: 1,
      totalActivities: 1,
    })
  })

  test('follows the error route instead of failing the instance', async () => {
    const definition = makeDefinition({
      steps: baseSteps,
      transitions: [
        { transitionId: 't_start_risky', fromStepId: 'start', toStepId: 'risky', trigger: 'auto' },
        {
          transitionId: 't_risky_recover',
          fromStepId: 'risky',
          toStepId: 'recover',
          trigger: 'auto',
          kind: ERROR_TRANSITION_KIND,
        },
      ],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    primeEm(definition, instance)

    const executeTransitionSpy = jest
      .spyOn(transitionHandler, 'executeTransition')
      .mockImplementation(async (_em, _container, _instance, fromStepId, toStepId) => {
        if (fromStepId === 'start') {
          instance.currentStepId = 'risky'
          return {
            success: false,
            error: 'boom',
            failedStepId: 'risky',
            errorRoute: { transitionId: 't_risky_recover', toStepId: 'recover' },
          }
        }
        instance.currentStepId = toStepId
        return { success: true, nextStepId: toStepId }
      })
    jest.spyOn(transitionHandler, 'findValidTransitions').mockImplementation(async (_em, _instance, fromStepId) => {
      const transition = definition.definition.transitions.find(
        (candidate: Record<string, unknown>) =>
          candidate.fromStepId === fromStepId && candidate.kind !== ERROR_TRANSITION_KIND
      )
      return transition ? [{ isValid: true, transition }] : []
    })

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

    expect(executeTransitionSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'risky',
      'recover',
      expect.anything()
    )
    expect(instance.status).toBe('RUNNING')
    expect(instance.context[WORKFLOW_ERROR_CONTEXT_KEY]).toMatchObject({ stepId: 'risky', message: 'boom' })
    expect(createdEventTypes(mockEm)).toContain('ERROR_ROUTED')
    expect(compensateWorkflow).not.toHaveBeenCalled()
    expect(result.events.some((event) => event.eventType === 'ERROR_ROUTED')).toBe(true)

    executeTransitionSpy.mockRestore()
  })

  test('parks the instance for triage on a failure-queue directive without compensating', async () => {
    const definition = makeDefinition({
      steps: baseSteps.map((step) =>
        step.stepId === 'risky' ? { ...step, errorDirective: { mode: 'failureQueue' } } : step
      ),
      transitions: [compensatableTransition],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    primeEm(definition, instance)

    jest.spyOn(transitionHandler, 'findValidTransitions').mockResolvedValue([
      { isValid: true, transition: compensatableTransition },
    ])
    const executeTransitionSpy = jest.spyOn(transitionHandler, 'executeTransition').mockResolvedValue({
      success: false,
      error: 'gateway timeout',
      failedStepId: 'risky',
      parkForAttention: true,
    })

    await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

    expect(instance.status).toBe('PAUSED')
    expect(instance.metadata?.attention).toMatchObject({
      reason: 'ERROR_DIRECTIVE',
      stepId: 'risky',
      error: 'gateway timeout',
    })
    expect(createdEventTypes(mockEm)).toContain('ERROR_PARKED')
    expect(compensateWorkflow).not.toHaveBeenCalled()

    executeTransitionSpy.mockRestore()
  })

  test('compensation still fires when the directive is fail', async () => {
    const definition = makeDefinition({
      steps: baseSteps.map((step) =>
        step.stepId === 'risky' ? { ...step, errorDirective: { mode: 'fail' } } : step
      ),
      transitions: [compensatableTransition],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    primeEm(definition, instance)

    jest.spyOn(transitionHandler, 'findValidTransitions').mockResolvedValue([
      { isValid: true, transition: compensatableTransition },
    ])
    const executeTransitionSpy = jest.spyOn(transitionHandler, 'executeTransition').mockResolvedValue({
      success: false,
      error: 'boom',
      failedStepId: 'risky',
    })

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

    expect(result.status).toBe('FAILED')
    expect(compensateWorkflow).toHaveBeenCalled()

    executeTransitionSpy.mockRestore()
  })

  test('a definition with no error configuration produces the legacy failure trace', async () => {
    const definition = makeDefinition({
      steps: baseSteps,
      transitions: [compensatableTransition],
    })
    const instance = makeInstance({ currentStepId: 'start' })
    primeEm(definition, instance)

    jest.spyOn(transitionHandler, 'findValidTransitions').mockResolvedValue([
      { isValid: true, transition: compensatableTransition },
    ])
    const executeTransitionSpy = jest.spyOn(transitionHandler, 'executeTransition').mockResolvedValue({
      success: false,
      error: 'boom',
    })

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

    expect(result.status).toBe('FAILED')
    expect(result.events.map((event) => event.eventType)).toEqual(['WORKFLOW_FAILED'])
    expect(createdEventTypes(mockEm).filter((eventType) => eventType.startsWith('ERROR_'))).toEqual([])
    expect(instance.context[WORKFLOW_ERROR_CONTEXT_KEY]).toBeUndefined()
    expect(compensateWorkflow).toHaveBeenCalled()

    executeTransitionSpy.mockRestore()
  })
})
