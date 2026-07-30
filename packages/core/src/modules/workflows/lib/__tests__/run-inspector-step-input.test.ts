import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { StepInstance, type WorkflowDefinition, type WorkflowInstance } from '../../data/entities'

/**
 * The run inspector shows a step's `StepInstance.inputData`. It used to be seeded
 * only from the workflow trigger data (null for a manually-started run), so an
 * INVOKE_AGENT step showed `Input: null` even though the agent received a real,
 * interpolated payload. handleAutomatedStep now captures the resolved
 * `config.input` onto `inputData` — this test locks that in.
 *
 * Only `executeActivities` is mocked (so the step parks without a live agent
 * bridge); `interpolateVariables` stays real, so the assertion proves the exact
 * value the agent runs on is what the inspector will display.
 */
jest.mock('../activity-executor', () => {
  const actual = jest.requireActual('../activity-executor') as Record<string, unknown>
  return { __esModule: true, ...actual, executeActivities: jest.fn() }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executeActivities } = require('../activity-executor') as { executeActivities: jest.Mock }
import { executeStep } from '../step-handler'

const tenantId = '00000000-0000-4000-8000-000000000001'
const orgId = '00000000-0000-4000-8000-000000000002'

describe('run inspector — INVOKE_AGENT step input capture', () => {
  let mockEm: jest.Mocked<EntityManager>
  let createdStepInstance: any

  const definition: Partial<WorkflowDefinition> = {
    id: 'def-1',
    workflowId: 'wf-1',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'step_klient',
          stepName: 'Klient',
          stepType: 'AUTOMATED',
          activities: [
            {
              activityId: 'invoke_klient',
              activityName: 'Invoke Klient',
              activityType: 'INVOKE_AGENT',
              config: {
                agentId: 'lighthouse.klient',
                input: { client_identifiers: '{{context.client_identifiers}}' },
                onResult: { autoApproveThreshold: 1 },
              },
            },
          ],
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [],
    },
    tenantId,
    organizationId: orgId,
  }

  const instance: Partial<WorkflowInstance> = {
    id: 'inst-1',
    definitionId: 'def-1',
    workflowId: 'wf-1',
    status: 'RUNNING',
    currentStepId: 'step_klient',
    context: {},
    tenantId,
    organizationId: orgId,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    createdStepInstance = undefined
    mockEm = {
      findOne: jest.fn().mockResolvedValue(definition),
      find: jest.fn(),
      create: jest.fn((entity: any, data: any) => {
        const row = { ...data }
        if (entity === StepInstance) createdStepInstance = row
        return row
      }),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn(),
      nativeDelete: jest.fn(),
    } as any

    // The agent proposal routes to a human → the step parks on the signal. The
    // input capture runs before this, so the parked step already carries it.
    executeActivities.mockResolvedValue([
      {
        activityId: 'invoke_klient',
        activityName: 'Invoke Klient',
        activityType: 'INVOKE_AGENT',
        success: true,
        async: false,
        retryCount: 0,
        executionTimeMs: 1,
        output: { __park: { signalName: 'agent_orchestrator.proposal.ready' }, proposalId: 'p1' },
      },
    ])
  })

  test('persists the resolved agent input onto the step instance', async () => {
    const result = await executeStep(
      mockEm,
      instance as WorkflowInstance,
      'step_klient',
      { workflowContext: { client_identifiers: { nip: '5272961101', regon: '388921133' } } } as any,
      {},
    )

    expect(result.status).toBe('WAITING')
    expect(executeActivities).toHaveBeenCalledTimes(1)
    // Not the trigger data (null) — the interpolated agent input.
    expect(createdStepInstance.inputData).toEqual({
      client_identifiers: { nip: '5272961101', regon: '388921133' },
    })
  })
})
