/**
 * The verdict WRITE: `completeWorkflow` is the single site that stamps
 * `WorkflowInstance.outcome`, and the evidence it decides from is counted under
 * the run's own tenant + organization.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import * as workflowExecutor from '../workflow-executor'
import { collectRunOutcomeEvidence } from '../run-outcome-evidence'
import type { WorkflowInstance } from '../../data/entities'

jest.mock('../compensation-handler', () => ({
  compensateWorkflow: jest.fn(),
}))

jest.mock('../transition-handler', () => ({
  findValidTransitions: jest.fn(),
  executeTransition: jest.fn(),
}))

jest.mock('../find-definition', () => ({
  findDefinitionForInstance: jest.fn(async () => null),
  findWorkflowDefinition: jest.fn(async () => null),
}))

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const instanceId = '00000000-0000-4000-8000-000000000004'

describe('run outcome write site', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let instance: WorkflowInstance
  let counts: { failedSteps: number; activityFailed: number; skippedSteps: number }

  const makeInstance = (): WorkflowInstance =>
    ({
      id: instanceId,
      definitionId: '00000000-0000-4000-8000-000000000003',
      workflowId: 'order-approval',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'end',
      context: {},
      tenantId,
      organizationId,
      startedAt: new Date(),
      retryCount: 0,
      isDryRun: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as WorkflowInstance

  beforeEach(() => {
    jest.clearAllMocks()
    setGlobalEventBus({ emit: jest.fn(async () => {}) as never })
    counts = { failedSteps: 0, activityFailed: 0, skippedSteps: 0 }
    instance = makeInstance()

    mockEm = {
      findOne: jest.fn(async () => instance),
      find: jest.fn(async () => []),
      count: jest.fn(async (_entity: unknown, where: any) => {
        if (where?.status === 'FAILED') return counts.failedSteps
        if (where?.status === 'SKIPPED') return counts.skippedSteps
        const types: string[] = where?.eventType?.$in ?? []
        if (types.includes('ACTIVITY_FAILED')) return counts.activityFailed
        return 0
      }),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      persist: jest.fn(function persist(this: unknown) {
        return this
      }),
      flush: jest.fn(),
    } as never

    mockContainer = { resolve: jest.fn() } as never
  })

  test('a clean COMPLETED run is stamped success', async () => {
    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'COMPLETED')
    expect(instance.status).toBe('COMPLETED')
    expect(instance.outcome).toBe('success')
  })

  test('the order-approval shape: COMPLETED with swallowed activity failures is partial_failure', async () => {
    // Transition-level `continueOnActivityFailure` leaves NO failed step row —
    // the only evidence is the ACTIVITY_FAILED events.
    counts.activityFailed = 3

    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'COMPLETED')

    expect(instance.status).toBe('COMPLETED')
    expect(instance.outcome).toBe('partial_failure')
  })

  test('a COMPLETED run carrying a tolerated FAILED step is partial_failure', async () => {
    counts.failedSteps = 1

    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'COMPLETED')

    expect(instance.outcome).toBe('partial_failure')
  })

  test('a COMPLETED run with only a skipped step is success_with_warnings', async () => {
    counts.skippedSteps = 1

    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'COMPLETED')

    expect(instance.outcome).toBe('success_with_warnings')
  })

  test('a cancelled run is stamped cancelled and reads no evidence', async () => {
    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'CANCELLED')

    expect(instance.outcome).toBe('cancelled')
    expect(mockEm.count).not.toHaveBeenCalled()
  })

  test('a failed run is stamped failure and reads no evidence', async () => {
    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'FAILED', {
      error: 'boom',
    })

    expect(instance.outcome).toBe('failure')
    expect(mockEm.count).not.toHaveBeenCalled()
  })
})

describe('collectRunOutcomeEvidence', () => {
  const scoped = { id: instanceId, tenantId, organizationId }

  test('every evidence query is scoped by tenant AND organization', async () => {
    const count = jest.fn(async () => 0)
    const em = { count } as unknown as EntityManager

    await collectRunOutcomeEvidence(em, scoped, 'COMPLETED')

    expect(count).toHaveBeenCalledTimes(4)
    for (const call of count.mock.calls) {
      const where = (call as unknown as [unknown, Record<string, unknown>])[1]
      expect(where.workflowInstanceId).toBe(instanceId)
      expect(where.tenantId).toBe(tenantId)
      expect(where.organizationId).toBe(organizationId)
    }
  })

  test('a non-COMPLETED terminal status short-circuits without a query', async () => {
    const count = jest.fn(async () => 99)
    const em = { count } as unknown as EntityManager

    const evidence = await collectRunOutcomeEvidence(em, scoped, 'FAILED')

    expect(count).not.toHaveBeenCalled()
    expect(evidence).toEqual({
      terminalStatus: 'FAILED',
      failureEvidenceCount: 0,
      warningEvidenceCount: 0,
    })
  })
})
