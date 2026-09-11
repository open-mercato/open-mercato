/**
 * Agent outcome routes (spec 7.2)
 *
 * Covers the pure resolver against the FIVE fixed disposition kinds §7.2
 * defines — deliberately not the selected agent's OUTCOME-schema enum, which
 * would need a per-value condition on each transition, i.e. exactly the context
 * string-matching §7.2 exists to remove — the canvas round trip, the executor's
 * declarative dispatch, and the regression that a definition declaring no
 * outcome routing produces the same trace it always did.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  AGENT_OUTCOME_KINDS,
  OUTCOME_TRANSITION_KIND,
  WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY,
  buildAgentOutcomeContextEntry,
  excludeOutcomeTransitions,
  findOutcomeTransition,
  listWiredOutcomes,
  mapDispositionToAgentOutcome,
  outcomeSourceHandleId,
  parseOutcomeSourceHandleId,
  readAgentOutcomeMarker,
  resolveAgentOutcomeHandling,
  validateOutcomeRoutes,
  type AgentOutcomeKind,
} from '../outcome-routing'
import { ERROR_TRANSITION_KIND } from '../error-routing'
import { definitionToGraph, graphToDefinition } from '../graph-utils'
import { findRouteKindDescriptorForHandle } from '../route-kinds'
import * as transitionHandler from '../transition-handler'
import * as workflowExecutor from '../workflow-executor'
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

const baseSteps = [
  { stepId: 'start', stepName: 'Start', stepType: 'START' },
  { stepId: 'agent', stepName: 'Agent', stepType: 'AUTOMATED' },
  { stepId: 'apply', stepName: 'Apply', stepType: 'AUTOMATED' },
  { stepId: 'review', stepName: 'Review', stepType: 'USER_TASK' },
  { stepId: 'end', stepName: 'End', stepType: 'END' },
]

function outcomeRoute(
  transitionId: string,
  toStepId: string,
  outcomeKind: string,
  extra: Record<string, unknown> = {},
) {
  return {
    transitionId,
    fromStepId: 'agent',
    toStepId,
    trigger: 'auto',
    kind: OUTCOME_TRANSITION_KIND,
    outcomeKind,
    ...extra,
  }
}

const normalRoutes = [
  { transitionId: 't_start_agent', fromStepId: 'start', toStepId: 'agent', trigger: 'auto' },
  { transitionId: 't_agent_apply', fromStepId: 'agent', toStepId: 'apply', trigger: 'auto' },
  { transitionId: 't_apply_end', fromStepId: 'apply', toStepId: 'end', trigger: 'auto' },
  { transitionId: 't_review_end', fromStepId: 'review', toStepId: 'end', trigger: 'auto' },
]

describe('agent outcome routing — the vocabulary is spec 7.2, not an OUTCOME enum', () => {
  test('declares exactly the five fixed disposition kinds', () => {
    expect(AGENT_OUTCOME_KINDS).toEqual([
      'approved',
      'researcher',
      'rejected',
      'guardrailBlocked',
      'error',
    ])
  })

  test('maps every disposition vocabulary the platform speaks onto those five', () => {
    expect(mapDispositionToAgentOutcome('auto_approved')).toBe('approved')
    expect(mapDispositionToAgentOutcome('approved')).toBe('approved')
    expect(mapDispositionToAgentOutcome('edited')).toBe('approved')
    expect(mapDispositionToAgentOutcome('researcher')).toBe('researcher')
    // An agent that looked and had nothing to propose takes the researcher handle —
    // NOT `rejected`: nothing was offered for a human to decline.
    expect(mapDispositionToAgentOutcome('none_proposed')).toBe('researcher')
    expect(mapDispositionToAgentOutcome('rejected')).toBe('rejected')
    expect(mapDispositionToAgentOutcome('guardrail_blocked')).toBe('guardrailBlocked')
    expect(mapDispositionToAgentOutcome('pending')).toBeNull()
    expect(mapDispositionToAgentOutcome(undefined)).toBeNull()
  })

  test('round-trips every outcome through its own source handle id', () => {
    for (const outcome of AGENT_OUTCOME_KINDS) {
      expect(parseOutcomeSourceHandleId(outcomeSourceHandleId(outcome))).toBe(outcome)
    }
    expect(parseOutcomeSourceHandleId('outcome:whatever')).toBeNull()
    expect(parseOutcomeSourceHandleId('error')).toBeNull()
  })
})

describe('agent outcome routing — pure resolver', () => {
  const wired = {
    steps: baseSteps,
    transitions: [
      ...normalRoutes,
      outcomeRoute('t_out_rejected', 'review', 'rejected'),
      outcomeRoute('t_out_guardrail', 'review', 'guardrailBlocked'),
    ],
  }

  test('keeps outcome routes out of normal routing', () => {
    expect(excludeOutcomeTransitions(wired.transitions).map((t) => t.transitionId)).toEqual([
      't_start_agent',
      't_agent_apply',
      't_apply_end',
      't_review_end',
    ])
  })

  test('lists the wired outcomes in the platform render order', () => {
    expect(listWiredOutcomes(wired, 'agent')).toEqual(['rejected', 'guardrailBlocked'])
    expect(listWiredOutcomes(wired, 'apply')).toEqual([])
  })

  test.each(['rejected', 'guardrailBlocked'] as AgentOutcomeKind[])(
    'routes a wired %s outcome to its own handle target',
    (outcome) => {
      const handling = resolveAgentOutcomeHandling(wired, 'agent', outcome)
      expect(handling).toMatchObject({ kind: 'route', outcome })
      expect(findOutcomeTransition(wired, 'agent', outcome)?.toStepId).toBe('review')
    },
  )

  test('picks the highest-priority route when an outcome has more than one', () => {
    const definition = {
      steps: baseSteps,
      transitions: [
        outcomeRoute('t_low', 'apply', 'rejected', { priority: 1 }),
        outcomeRoute('t_high', 'review', 'rejected', { priority: 9 }),
      ],
    }
    expect(findOutcomeTransition(definition, 'agent', 'rejected')?.transitionId).toBe('t_high')
  })

  test('an approved outcome with no wired handle stays on the default route', () => {
    expect(resolveAgentOutcomeHandling(wired, 'agent', 'approved')).toEqual({ kind: 'default' })
  })

  test('a step declaring NO outcome route keeps every outcome on the default route', () => {
    const legacy = { steps: baseSteps, transitions: normalRoutes }
    for (const outcome of AGENT_OUTCOME_KINDS) {
      expect(resolveAgentOutcomeHandling(legacy, 'agent', outcome)).toEqual({ kind: 'default' })
    }
  })

  test('an unwired non-approved outcome inherits the step error directive', () => {
    const handling = resolveAgentOutcomeHandling(wired, 'agent', 'researcher')
    expect(handling).toMatchObject({ kind: 'inherit', outcome: 'researcher' })
    if (handling.kind !== 'inherit') return
    expect(handling.handling).toEqual({ kind: 'fail' })
  })

  test('the inherited directive is the step error route when one is wired', () => {
    const withErrorRoute = {
      steps: baseSteps,
      transitions: [
        ...wired.transitions,
        {
          transitionId: 't_agent_error',
          fromStepId: 'agent',
          toStepId: 'review',
          trigger: 'auto',
          kind: ERROR_TRANSITION_KIND,
        },
      ],
    }
    const handling = resolveAgentOutcomeHandling(withErrorRoute, 'agent', 'error')
    expect(handling).toMatchObject({ kind: 'inherit' })
    if (handling.kind !== 'inherit') return
    expect(handling.handling).toMatchObject({ kind: 'route' })
  })

  test('reads the engine-owned marker only for the step that produced it', () => {
    const entry = buildAgentOutcomeContextEntry('agent', 'rejected', 'p1')
    const context = { [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: entry, disposition: 'approved' }
    expect(readAgentOutcomeMarker(context, 'agent')?.outcome).toBe('rejected')
    expect(readAgentOutcomeMarker(context, 'apply')).toBeNull()
    expect(readAgentOutcomeMarker({ disposition: 'rejected' }, 'agent')).toBeNull()
  })
})

describe('agent outcome routing — author-time checks', () => {
  test('flags an outcome route claiming a kind the platform does not define', () => {
    const issues = validateOutcomeRoutes({
      steps: baseSteps,
      transitions: [outcomeRoute('t_bogus', 'review', 'needsReview')],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'OUTCOME_ROUTE_UNKNOWN_KIND', transitionId: 't_bogus' })
  })

  test('flags two routes claiming the same outcome on one step', () => {
    const issues = validateOutcomeRoutes({
      steps: baseSteps,
      transitions: [
        outcomeRoute('t_first', 'review', 'rejected'),
        outcomeRoute('t_second', 'apply', 'rejected'),
      ],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'OUTCOME_ROUTE_DUPLICATE_KIND', transitionId: 't_second' })
  })

  test('the same outcome on two different steps is not a duplicate', () => {
    const issues = validateOutcomeRoutes({
      steps: baseSteps,
      transitions: [
        outcomeRoute('t_first', 'review', 'rejected'),
        { ...outcomeRoute('t_second', 'review', 'rejected'), fromStepId: 'apply' },
      ],
    })
    expect(issues).toEqual([])
  })

  test('says nothing about a definition with no outcome routes', () => {
    expect(validateOutcomeRoutes({ steps: baseSteps, transitions: normalRoutes })).toEqual([])
  })
})

describe('agent outcome routing — canvas round trip', () => {
  test('a newly drawn outcome handle immediately carries its discriminator', () => {
    const sourceHandle = outcomeSourceHandleId('rejected')
    const descriptor = findRouteKindDescriptorForHandle(sourceHandle)

    expect(descriptor?.kind).toBe(OUTCOME_TRANSITION_KIND)
    expect(descriptor?.discriminatorFields({ sourceHandle })).toEqual({
      outcomeKind: 'rejected',
    })
  })

  test.each(AGENT_OUTCOME_KINDS)('an %s route survives a Studio save', (outcome) => {
    const definition = {
      steps: baseSteps,
      transitions: [...normalRoutes, outcomeRoute('t_out', 'review', outcome)],
    } as any

    const { nodes, edges } = definitionToGraph(definition)
    const edge = edges.find((candidate) => candidate.id === 't_out')
    expect(edge?.sourceHandle).toBe(outcomeSourceHandleId(outcome))

    const persisted = graphToDefinition(nodes, edges).transitions.find(
      (transition: any) => transition.transitionId === 't_out',
    ) as any
    expect(persisted.kind).toBe(OUTCOME_TRANSITION_KIND)
    expect(persisted.outcomeKind).toBe(outcome)
  })

  test('a definition with no outcome routing carries no outcome fields at all', () => {
    const { nodes, edges } = definitionToGraph({ steps: baseSteps, transitions: normalRoutes } as any)
    for (const transition of graphToDefinition(nodes, edges).transitions as any[]) {
      expect(transition).not.toHaveProperty('kind')
      expect(transition).not.toHaveProperty('outcomeKind')
    }
  })
})

describe('agent outcome routing — executor', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>

  function makeDefinition(transitions: Array<Record<string, unknown>>): WorkflowDefinition {
    return {
      id: testDefinitionId,
      workflowId: 'agent-workflow',
      workflowName: 'Agent Workflow',
      version: 1,
      enabled: true,
      definition: { steps: baseSteps, transitions },
      tenantId: testTenantId,
      organizationId: testOrgId,
    } as unknown as WorkflowDefinition
  }

  function makeInstance(context: Record<string, unknown>): WorkflowInstance {
    return {
      id: testInstanceId,
      definitionId: testDefinitionId,
      workflowId: 'agent-workflow',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'agent',
      context,
      tenantId: testTenantId,
      organizationId: testOrgId,
      startedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as WorkflowInstance
  }

  function primeEm(definition: WorkflowDefinition, instance: WorkflowInstance): void {
    mockEm.findOne.mockImplementation(async (_entity: unknown, where: unknown) => {
      const id = (where as { id?: string })?.id
      if (id === testInstanceId) return instance
      if (id === testDefinitionId) return definition
      return null
    })
  }

  function createdEventTypes(): string[] {
    return mockEm.create.mock.calls
      .map(([, payload]) => (payload as { eventType?: string })?.eventType)
      .filter((eventType): eventType is string => typeof eventType === 'string')
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
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

  test('follows the wired outcome route instead of the default happy path', async () => {
    const definition = makeDefinition([
      ...normalRoutes,
      outcomeRoute('t_out_rejected', 'review', 'rejected'),
    ])
    const instance = makeInstance({
      [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: buildAgentOutcomeContextEntry('agent', 'rejected'),
    })
    primeEm(definition, instance)

    const executeTransition = jest
      .spyOn(transitionHandler, 'executeTransition')
      .mockImplementation(async (_em, _container, _instance, _from, toStepId) => {
        instance.currentStepId = toStepId
        instance.status = 'PAUSED'
        return { success: true, nextStepId: toStepId }
      })
    jest.spyOn(transitionHandler, 'findValidTransitions').mockResolvedValue([])

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

    expect(executeTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'agent',
      'review',
      expect.objectContaining({ transitionId: 't_out_rejected' }),
    )
    expect(result.events.some((event) => event.eventType === 'OUTCOME_ROUTED')).toBe(true)
    expect(createdEventTypes()).toContain('OUTCOME_ROUTED')
    // The marker is consumed, so a later loop cannot re-fire on a stale outcome.
    expect(instance.context[WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]).toBeUndefined()
  })

  test('an unwired outcome on a step that wired others fails the instance', async () => {
    const definition = makeDefinition([
      ...normalRoutes,
      outcomeRoute('t_out_rejected', 'review', 'rejected'),
    ])
    const instance = makeInstance({
      [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: buildAgentOutcomeContextEntry('agent', 'guardrailBlocked'),
    })
    primeEm(definition, instance)
    jest.spyOn(transitionHandler, 'findValidTransitions').mockResolvedValue([])

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

    expect(result.status).toBe('FAILED')
    expect(createdEventTypes()).toContain('OUTCOME_UNHANDLED')
  })

  test('an outcome on a step declaring none routes exactly as it always did', async () => {
    const definition = makeDefinition(normalRoutes)
    const instance = makeInstance({
      [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: buildAgentOutcomeContextEntry('agent', 'researcher'),
    })
    primeEm(definition, instance)

    const executeTransition = jest
      .spyOn(transitionHandler, 'executeTransition')
      .mockImplementation(async (_em, _container, _instance, _from, toStepId) => {
        instance.currentStepId = toStepId
        instance.status = 'PAUSED'
        return { success: true, nextStepId: toStepId }
      })
    jest
      .spyOn(transitionHandler, 'findValidTransitions')
      .mockImplementation(async (_em, _instance, fromStepId) => {
        const transition = normalRoutes.find((candidate) => candidate.fromStepId === fromStepId)
        return transition ? [{ isValid: true, transition } as any] : []
      })

    const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

    expect(result.events.some((event) => event.eventType === 'OUTCOME_ROUTED')).toBe(false)
    expect(executeTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'agent',
      'apply',
      expect.objectContaining({ transitionId: 't_agent_apply' }),
    )
  })
  // Regression: `sendSignal` advances a resumed instance ITSELF — it picks the
  // next transition and executes it before handing back to the executor — so a
  // dispatcher that only ran in the executor loop would send every
  // human-dispositioned proposal down the happy path while passing every
  // inline-resolution test.
  test('the resume path dispatches the outcome without going through the executor loop', async () => {
    const definition = makeDefinition([
      ...normalRoutes,
      outcomeRoute('t_out_rejected', 'review', 'rejected'),
    ])
    const instance = makeInstance({
      [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: buildAgentOutcomeContextEntry('agent', 'rejected'),
    })
    primeEm(definition, instance)

    const executeTransition = jest
      .spyOn(transitionHandler, 'executeTransition')
      .mockResolvedValue({ success: true, nextStepId: 'review' } as never)

    const dispatched = await workflowExecutor.dispatchAgentOutcomeForCurrentStep(
      mockEm,
      mockContainer,
      instance,
      definition.definition as never,
      { workflowContext: instance.context },
    )

    expect(dispatched).toMatchObject({ kind: 'routed', toStepId: 'review' })
    expect(executeTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'agent',
      'review',
      expect.objectContaining({ transitionId: 't_out_rejected' }),
    )
  })

  test('an inherited continue directive writes its fallback and resumes normal routing', async () => {
    const definition = makeDefinition([
      ...normalRoutes,
      outcomeRoute('t_out_rejected', 'review', 'rejected'),
    ])
    const agentStep = definition.definition.steps.find((step) => step.stepId === 'agent') as {
      errorDirective?: { mode: string; fallbackValue?: unknown }
    }
    agentStep.errorDirective = { mode: 'continueWithFallback', fallbackValue: { reviewed: false } }
    const instance = makeInstance({
      [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: buildAgentOutcomeContextEntry('agent', 'researcher'),
    })

    const dispatched = await workflowExecutor.dispatchAgentOutcomeForCurrentStep(
      mockEm,
      mockContainer,
      instance,
      definition.definition as never,
      { workflowContext: instance.context },
    )

    expect(dispatched).toEqual({ kind: 'default' })
    expect(instance.context.agent).toEqual({ reviewed: false })
    expect(createdEventTypes()).toContain('ERROR_DIRECTIVE_APPLIED')
  })

  test('an inherited failureQueue directive parks the instance for attention', async () => {
    const definition = makeDefinition([
      ...normalRoutes,
      outcomeRoute('t_out_rejected', 'review', 'rejected'),
    ])
    const agentStep = definition.definition.steps.find((step) => step.stepId === 'agent') as {
      errorDirective?: { mode: string }
    }
    agentStep.errorDirective = { mode: 'failureQueue' }
    const instance = makeInstance({
      [WORKFLOW_AGENT_OUTCOME_CONTEXT_KEY]: buildAgentOutcomeContextEntry('agent', 'researcher'),
    })

    const dispatched = await workflowExecutor.dispatchAgentOutcomeForCurrentStep(
      mockEm,
      mockContainer,
      instance,
      definition.definition as never,
      { workflowContext: instance.context },
    )

    expect(dispatched).toEqual({ kind: 'parked' })
    expect(instance.status).toBe('PAUSED')
    expect(instance.metadata).toMatchObject({ attention: { stepId: 'agent' } })
  })

  test('the resume path reports no dispatch when there is no marker', async () => {
    const definition = makeDefinition(normalRoutes)
    const instance = makeInstance({})
    primeEm(definition, instance)

    await expect(
      workflowExecutor.dispatchAgentOutcomeForCurrentStep(
        mockEm,
        mockContainer,
        instance,
        definition.definition as never,
        { workflowContext: instance.context },
      ),
    ).resolves.toBeNull()
  })
})
