/**
 * The enabling fix: a tolerated failure must leave durable evidence.
 *
 * `handleAutomatedStep` REPORTS a failed sync activity as `{status:'FAILED'}`
 * instead of throwing, so `executeStep`'s catch never ran and the `StepInstance`
 * row stayed ACTIVE for ever with no `STEP_FAILED` event. Two consequences, both
 * pinned here:
 *
 *  1. there was nothing durable for a run verdict to be computed from, and
 *  2. `POST /api/workflows/instances/[id]/rerun-step` refused that step with 409
 *     `WORKFLOW_STEP_STILL_PARKED` — rerun-from-step could not rerun exactly the
 *     step it exists for. That refusal must now be an acceptance.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { WorkflowInstance, StepInstance } from '../../data/entities'
import { resolveRerunEligibility } from '../rerun-from-step'

jest.mock('../find-definition', () => ({
  findDefinitionForInstance: jest.fn(),
  findWorkflowDefinition: jest.fn(),
}))

jest.mock('../activity-executor', () => ({
  executeActivities: jest.fn(),
  executeActivity: jest.fn(),
  INVOKE_AGENT_ENQUEUE_DELAY_MS: 0,
}))

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const definitionId = '00000000-0000-4000-8000-000000000003'
const instanceId = '00000000-0000-4000-8000-000000000004'

const definition = {
  id: definitionId,
  workflowId: 'order-approval',
  workflowName: 'Order Approval',
  version: 1,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'set_status', stepName: 'Set Status', stepType: 'AUTOMATED', activities: [
        { activityId: 'a1', activityName: 'Set Order to Pending Approval', activityType: 'UPDATE_ENTITY', config: {} },
      ] },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [],
  },
  tenantId,
  organizationId,
}

describe('tolerated failure leaves durable evidence', () => {
  let mockEm: jest.Mocked<EntityManager>
  let created: Array<Record<string, any>>

  const buildInstance = (): WorkflowInstance =>
    ({
      id: instanceId,
      definitionId,
      workflowId: 'order-approval',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'set_status',
      context: {},
      tenantId,
      organizationId,
      startedAt: new Date(),
      retryCount: 0,
      isDryRun: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as WorkflowInstance

  const loggedEvents = (): Array<{ eventType: string; eventData?: any }> =>
    created.filter((payload): payload is { eventType: string; eventData?: any } =>
      typeof payload?.eventType === 'string')

  const stepRows = (): Array<Record<string, any>> =>
    created.filter((payload) => typeof payload?.stepId === 'string' && payload?.status !== undefined)

  beforeEach(() => {
    jest.clearAllMocks()
    created = []
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((_entity: unknown, data: any) => {
        created.push({ id: `row-${created.length + 1}`, ...data })
        return created[created.length - 1]
      }),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn(),
    } as any

    const findDefinition = jest.requireMock('../find-definition') as {
      findDefinitionForInstance: jest.Mock
    }
    findDefinition.findDefinitionForInstance.mockResolvedValue(definition as never)
  })

  test('a failed sync activity marks the step instance FAILED and logs STEP_FAILED', async () => {
    const activityExecutor = jest.requireMock('../activity-executor') as { executeActivities: jest.Mock }
    activityExecutor.executeActivities.mockResolvedValue([
      {
        activityId: 'a1',
        activityName: 'Set Order to Pending Approval',
        activityType: 'UPDATE_ENTITY',
        success: false,
        async: false,
        error: 'No acting user for a system-originated order',
        retryCount: 0,
      },
    ] as never)

    const { executeStep } = await import('../step-handler')
    const result = await executeStep(mockEm, buildInstance(), 'set_status', { workflowContext: {} })

    expect(result.status).toBe('FAILED')

    const stepRow = stepRows().find((row) => row.stepId === 'set_status')
    expect(stepRow).toBeDefined()
    // Before the fix this stayed 'ACTIVE' for ever.
    expect(stepRow?.status).toBe('FAILED')
    expect(stepRow?.exitedAt).toBeInstanceOf(Date)
    expect(stepRow?.errorData?.error).toContain('No acting user')

    const failedEvents = loggedEvents().filter((event) => event.eventType === 'STEP_FAILED')
    expect(failedEvents).toHaveLength(1)
    expect(failedEvents[0].eventData?.stepId).toBe('set_status')
  })

  test('rerun-from-step now ACCEPTS the step it exists for (was 409 WORKFLOW_STEP_STILL_PARKED)', async () => {
    const activityExecutor = jest.requireMock('../activity-executor') as { executeActivities: jest.Mock }
    activityExecutor.executeActivities.mockResolvedValue([
      {
        activityId: 'a1',
        activityName: 'Set Order to Pending Approval',
        activityType: 'UPDATE_ENTITY',
        success: false,
        async: false,
        error: 'No acting user for a system-originated order',
        retryCount: 0,
      },
    ] as never)

    const { executeStep } = await import('../step-handler')
    await executeStep(mockEm, buildInstance(), 'set_status', { workflowContext: {} })

    const stepRow = stepRows().find((row) => row.stepId === 'set_status') as unknown as StepInstance

    const eligibility = resolveRerunEligibility({
      instanceStatus: 'PAUSED',
      stepId: 'set_status',
      definitionSteps: [{ stepId: 'set_status', stepType: 'AUTOMATED' }],
      stepExecutions: [
        {
          id: stepRow.id,
          stepId: stepRow.stepId,
          stepType: stepRow.stepType,
          status: stepRow.status,
          enteredAt: stepRow.enteredAt,
        },
      ],
    })

    expect(eligibility.ok).toBe(true)
  })

  // `handleAutomatedStep` swallows a THROWING activity executor into the same
  // reported `{status:'FAILED'}`, so this path had the identical symptom.
  test('a throwing activity executor also marks the row FAILED, exactly once', async () => {
    const activityExecutor = jest.requireMock('../activity-executor') as { executeActivities: jest.Mock }
    activityExecutor.executeActivities.mockRejectedValue(new Error('boom') as never)

    const instance = buildInstance()
    mockEm.findOne.mockImplementation(async (_entity: unknown, where: any) => {
      if (where?.status === 'ACTIVE') {
        return created.find((row) => row.stepId === where.stepId && row.status === 'ACTIVE') ?? null
      }
      return null
    })

    const { executeStep } = await import('../step-handler')
    const result = await executeStep(mockEm, instance, 'set_status', { workflowContext: {} })

    expect(result.status).toBe('FAILED')
    expect(stepRows().find((row) => row.stepId === 'set_status')?.status).toBe('FAILED')
    expect(loggedEvents().filter((event) => event.eventType === 'STEP_FAILED')).toHaveLength(1)
  })
})
