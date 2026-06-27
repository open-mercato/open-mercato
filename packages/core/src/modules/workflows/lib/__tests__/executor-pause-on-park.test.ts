/**
 * Regression tests for the "burst past a parked agent step" bug.
 *
 * An "Invoke Agent" node compiles to an AUTOMATED step carrying an INVOKE_AGENT
 * activity. At runtime that step enqueues an async agent job and PARKS the
 * instance (status PAUSED, SIGNAL_AWAITING). The executor loop used to key its
 * pause decision off the STEP TYPE only, so after a parked agent step it kept
 * advancing — taking the next auto-transition, parking the next agent step, etc.
 *
 * The fix makes pause detection key off the actual wait STATUS:
 *  - transition-handler surfaces `paused: true` when the destination step
 *    handler returns `{ status: 'WAITING' }`.
 *  - the executor loop bails (returns RUNNING, does not advance) on that flag,
 *    and as defense-in-depth when the instance status is PAUSED /
 *    WAITING_FOR_ACTIVITIES.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import * as workflowExecutor from '../workflow-executor'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

jest.mock('../transition-handler', () => ({
  findValidTransitions: jest.fn(),
  executeTransition: jest.fn(),
}))

jest.mock('../compensation-handler', () => ({
  compensateWorkflow: jest.fn(),
}))

type TransitionHandlerMock = {
  findValidTransitions: jest.Mock
  executeTransition: jest.Mock
}

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const definitionId = '00000000-0000-4000-8000-000000000003'
const instanceId = '00000000-0000-4000-8000-000000000004'

// START -> agent_1 (AUTOMATED/INVOKE_AGENT) -> agent_2 (AUTOMATED/INVOKE_AGENT) -> END
const twoAgentDefinition: Partial<WorkflowDefinition> = {
  id: definitionId,
  workflowId: 'two-agent-workflow',
  workflowName: 'Two Agent Workflow',
  version: 1,
  enabled: true,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'agent_1', stepName: 'Agent 1', stepType: 'AUTOMATED' },
      { stepId: 'agent_2', stepName: 'Agent 2', stepType: 'AUTOMATED' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 'start-to-agent_1', fromStepId: 'start', toStepId: 'agent_1', trigger: 'auto', priority: 0 },
      { transitionId: 'agent_1-to-agent_2', fromStepId: 'agent_1', toStepId: 'agent_2', trigger: 'auto', priority: 0 },
      { transitionId: 'agent_2-to-end', fromStepId: 'agent_2', toStepId: 'end', trigger: 'auto', priority: 0 },
    ],
  },
  tenantId,
  organizationId,
}

// START -> step_1 -> step_2 -> END, all plain AUTOMATED (no parking)
const plainChainDefinition: Partial<WorkflowDefinition> = {
  id: definitionId,
  workflowId: 'plain-chain-workflow',
  workflowName: 'Plain Chain Workflow',
  version: 1,
  enabled: true,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'step_1', stepName: 'Step 1', stepType: 'AUTOMATED' },
      { stepId: 'step_2', stepName: 'Step 2', stepType: 'AUTOMATED' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 'start-to-step_1', fromStepId: 'start', toStepId: 'step_1', trigger: 'auto', priority: 0 },
      { transitionId: 'step_1-to-step_2', fromStepId: 'step_1', toStepId: 'step_2', trigger: 'auto', priority: 0 },
      { transitionId: 'step_2-to-end', fromStepId: 'step_2', toStepId: 'end', trigger: 'auto', priority: 0 },
    ],
  },
  tenantId,
  organizationId,
}

describe('executor pause-on-park (INVOKE_AGENT regression)', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let transitionHandler: TransitionHandlerMock

  const buildInstance = (): WorkflowInstance =>
    ({
      id: instanceId,
      definitionId,
      workflowId: 'two-agent-workflow',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'start',
      context: {},
      tenantId,
      organizationId,
      startedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as WorkflowInstance

  // Logged WorkflowEvent rows (em.create payloads with an eventType).
  const loggedEvents = (): Array<{ eventType: string; eventData?: any }> =>
    mockEm.create.mock.calls
      .map((call) => call[1] as { eventType?: string; eventData?: any })
      .filter((payload): payload is { eventType: string; eventData?: any } => typeof payload?.eventType === 'string')

  beforeEach(() => {
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn(),
      transactional: jest.fn(async (callback: (trx: EntityManager) => Promise<unknown>) => callback(mockEm)),
    } as any

    mockContainer = { resolve: jest.fn() } as any

    transitionHandler = jest.requireMock('../transition-handler') as TransitionHandlerMock

    jest.clearAllMocks()
  })

  test('stops at the FIRST parked agent step and does NOT advance to the second', async () => {
    const instance = buildInstance()

    mockEm.findOne.mockImplementation(async (_entity: unknown, where: unknown) => {
      if ((where as Record<string, unknown>)?.id === instanceId) return instance
      if ((where as Record<string, unknown>)?.id === definitionId) return twoAgentDefinition as WorkflowDefinition
      return null
    })

    // Every step has exactly one valid auto-transition out of it.
    transitionHandler.findValidTransitions.mockImplementation(async (_em, inst: WorkflowInstance) => {
      const next: Record<string, string> = {
        start: 'agent_1',
        agent_1: 'agent_2',
        agent_2: 'end',
      }
      const toStepId = next[inst.currentStepId as string]
      if (!toStepId) return []
      return [
        {
          isValid: true,
          transition: {
            transitionId: `${inst.currentStepId}-to-${toStepId}`,
            fromStepId: inst.currentStepId,
            toStepId,
            trigger: 'auto',
          },
        },
      ]
    })

    // start -> agent_1 advances normally; the agent_1 step then PARKS: the step
    // handler set status PAUSED + logged SIGNAL_AWAITING, and the transition
    // surfaces `paused: true` with the cursor already on the parked step.
    transitionHandler.executeTransition.mockImplementation(
      async (_em, _container, inst: WorkflowInstance, _fromStepId: string, toStepId: string) => {
        inst.currentStepId = toStepId
        if (toStepId === 'agent_1') {
          // Simulate handleAutomatedStep's __park branch.
          inst.status = 'PAUSED' as any
          mockEm.create(undefined as any, { eventType: 'SIGNAL_AWAITING', eventData: { stepId: 'agent_1', reason: 'INVOKE_AGENT' } } as any)
          return { success: true, nextStepId: toStepId, paused: true }
        }
        return { success: true, nextStepId: toStepId }
      },
    )

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, instanceId)

    // The loop bailed at the parked agent step rather than running to END.
    expect(result.status).toBe('RUNNING')
    expect(result.currentStep).toBe('agent_1')
    expect(instance.status).toBe('PAUSED')

    // Only the first agent step ran a transition; it never advanced to agent_2/end.
    expect(transitionHandler.executeTransition).toHaveBeenCalledTimes(1)
    const transitionTargets = transitionHandler.executeTransition.mock.calls.map((call) => call[4])
    expect(transitionTargets).toEqual(['agent_1'])

    // Exactly one SIGNAL_AWAITING logged, and no transition advanced past agent_1.
    const events = loggedEvents()
    expect(events.filter((event) => event.eventType === 'SIGNAL_AWAITING')).toHaveLength(1)
    const advancedTransitions = events.filter(
      (event) => event.eventType === 'TRANSITION_EXECUTED' && event.eventData?.fromStepId === 'agent_1',
    )
    expect(advancedTransitions).toHaveLength(0)
  })

  test('regression: a plain AUTOMATED chain with no parking still runs straight through to COMPLETED', async () => {
    const instance = { ...buildInstance(), workflowId: 'plain-chain-workflow' } as WorkflowInstance

    mockEm.findOne.mockImplementation(async (_entity: unknown, where: unknown) => {
      if ((where as Record<string, unknown>)?.id === instanceId) return instance
      if ((where as Record<string, unknown>)?.id === definitionId) return plainChainDefinition as WorkflowDefinition
      return null
    })

    transitionHandler.findValidTransitions.mockImplementation(async (_em, inst: WorkflowInstance) => {
      const next: Record<string, string> = {
        start: 'step_1',
        step_1: 'step_2',
        step_2: 'end',
      }
      const toStepId = next[inst.currentStepId as string]
      if (!toStepId) return []
      return [
        {
          isValid: true,
          transition: {
            transitionId: `${inst.currentStepId}-to-${toStepId}`,
            fromStepId: inst.currentStepId,
            toStepId,
            trigger: 'auto',
          },
        },
      ]
    })

    transitionHandler.executeTransition.mockImplementation(
      async (_em, _container, inst: WorkflowInstance, _fromStepId: string, toStepId: string) => {
        inst.currentStepId = toStepId
        return { success: true, nextStepId: toStepId }
      },
    )

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, instanceId)

    expect(result.status).toBe('COMPLETED')
    expect(result.currentStep).toBe('end')
    // Drove all three transitions: start->step_1->step_2->end.
    expect(transitionHandler.executeTransition).toHaveBeenCalledTimes(3)
  })

  test('defense in depth: a PAUSED instance status at loop entry stops advancing', async () => {
    const instance = { ...buildInstance(), currentStepId: 'agent_1', status: 'PAUSED' } as WorkflowInstance

    mockEm.findOne.mockImplementation(async (_entity: unknown, where: unknown) => {
      if ((where as Record<string, unknown>)?.id === instanceId) return instance
      if ((where as Record<string, unknown>)?.id === definitionId) return twoAgentDefinition as WorkflowDefinition
      return null
    })

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, instanceId)

    expect(result.status).toBe('RUNNING')
    expect(result.currentStep).toBe('agent_1')
    // The guard fired before evaluating transitions out of the parked step.
    expect(transitionHandler.findValidTransitions).not.toHaveBeenCalled()
    expect(transitionHandler.executeTransition).not.toHaveBeenCalled()
  })
})

describe('executeTransitionForToken surfaces paused when the destination step parks', () => {
  // Real transition handler here (the executor suite above mocks it wholesale).
  let stepHandler: typeof import('../step-handler')
  let transitionHandler: typeof import('../transition-handler')
  let ruleEvaluator: typeof import('../../../business_rules/lib/rule-evaluator')

  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let executeStepSpy: jest.SpiedFunction<typeof import('../step-handler').executeStep>

  const parkDefinition = {
    id: definitionId,
    workflowId: 'two-agent-workflow',
    workflowName: 'Two Agent Workflow',
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'agent_1', stepName: 'Agent 1', stepType: 'AUTOMATED' },
        { stepId: 'agent_2', stepName: 'Agent 2', stepType: 'AUTOMATED' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { fromStepId: 'start', toStepId: 'agent_1' },
        { fromStepId: 'agent_1', toStepId: 'agent_2' },
      ],
    },
    enabled: true,
    tenantId,
    organizationId,
  } as unknown as WorkflowDefinition

  const buildInstance = (currentStepId: string): WorkflowInstance =>
    ({
      id: instanceId,
      definitionId,
      workflowId: 'two-agent-workflow',
      currentStepId,
      status: 'RUNNING',
      context: {},
      tenantId,
      organizationId,
      version: 1,
      startedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as WorkflowInstance

  beforeEach(() => {
    jest.resetModules()
    jest.unmock('../transition-handler')
    jest.unmock('../step-handler')
    jest.doMock('../../../business_rules/lib/rule-evaluator', () => ({ evaluateConditions: jest.fn() }))
    jest.doMock('../../../business_rules/lib/rule-engine', () => ({
      executeRuleByRuleId: jest.fn(),
      executeRules: jest.fn(),
    }))

    transitionHandler = require('../transition-handler')
    stepHandler = require('../step-handler')
    ruleEvaluator = require('../../../business_rules/lib/rule-evaluator')

    ;(ruleEvaluator.evaluateConditions as jest.Mock).mockResolvedValue(true)

    mockEm = {
      findOne: jest.fn(async () => parkDefinition),
      find: jest.fn(),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn(),
    } as any

    mockContainer = { resolve: jest.fn(() => { throw new Error('no eventBus') }) } as any

    executeStepSpy = jest.spyOn(stepHandler, 'executeStep')
  })

  afterEach(() => {
    executeStepSpy.mockRestore()
    jest.dontMock('../../../business_rules/lib/rule-evaluator')
    jest.dontMock('../../../business_rules/lib/rule-engine')
  })

  test('returns paused: true when the destination step handler returns WAITING', async () => {
    const instance = buildInstance('start')
    executeStepSpy.mockResolvedValue({ status: 'WAITING', waitReason: 'SIGNAL', outputData: {} })

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'agent_1',
      { workflowContext: {} },
    )

    expect(result.success).toBe(true)
    expect(result.nextStepId).toBe('agent_1')
    expect(result.paused).toBe(true)
    // The transition INTO the parked step still genuinely happened.
    expect(instance.currentStepId).toBe('agent_1')
  })

  test('returns paused falsy when the destination step completes normally', async () => {
    const instance = buildInstance('start')
    executeStepSpy.mockResolvedValue({ status: 'COMPLETED', outputData: {} })

    const result = await transitionHandler.executeTransition(
      mockEm,
      mockContainer,
      instance,
      'start',
      'agent_1',
      { workflowContext: {} },
    )

    expect(result.success).toBe(true)
    expect(result.paused).toBeFalsy()
  })
})
