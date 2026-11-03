/**
 * A compensated run must have a terminal timestamp.
 *
 * `compensation-handler` flips the status to COMPENSATED (or back to FAILED on
 * a partial compensation) and `completeWorkflow` RETURNS on that path before its
 * own `completedAt` assignment. So a compensated run had no terminal instant at
 * all: it belonged to no KPI time window and its duration was unmeasurable.
 * The run-outcome write is where that hole is filled.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import * as workflowExecutor from '../workflow-executor'
import {
  WORKFLOW_TERMINAL_STATUSES,
  buildDefinitionMetrics,
} from '../metrics/definition-metrics'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

jest.mock('../compensation-handler', () => ({
  compensateWorkflow: jest.fn(),
}))

jest.mock('../transition-handler', () => ({
  findValidTransitions: jest.fn(),
  executeTransition: jest.fn(),
}))

jest.mock('../find-definition', () => ({
  findDefinitionForInstance: jest.fn(),
  findWorkflowDefinition: jest.fn(async () => null),
}))

jest.mock('../error-handler', () => ({
  scheduleWorkflowErrorHandler: jest.fn(async () => {}),
}))

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const instanceId = '00000000-0000-4000-8000-000000000004'

// A definition with a compensating activity, so `checkIfCompensationNeeded`
// takes the compensation branch.
const compensatingDefinition = {
  id: '00000000-0000-4000-8000-000000000003',
  workflowId: 'reserve-stock',
  version: 1,
  definition: {
    steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }],
    transitions: [
      {
        transitionId: 't1',
        fromStepId: 'start',
        toStepId: 'end',
        activities: [
          {
            activityId: 'a1',
            activityType: 'UPDATE_ENTITY',
            compensation: { activityId: 'a1_undo', activityType: 'UPDATE_ENTITY', config: {} },
          },
        ],
      },
    ],
  },
  tenantId,
  organizationId,
} as unknown as WorkflowDefinition

describe('compensated runs get a terminal timestamp', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let instance: WorkflowInstance

  beforeEach(() => {
    jest.clearAllMocks()
    setGlobalEventBus({ emit: jest.fn(async () => {}) as never })

    instance = {
      id: instanceId,
      definitionId: compensatingDefinition.id,
      workflowId: 'reserve-stock',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'start',
      context: {},
      tenantId,
      organizationId,
      startedAt: new Date('2026-07-30T09:00:00.000Z'),
      completedAt: null,
      retryCount: 0,
      isDryRun: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as WorkflowInstance

    mockEm = {
      findOne: jest.fn(async () => instance),
      find: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      persist: jest.fn(function persist(this: unknown) {
        return this
      }),
      flush: jest.fn(),
    } as never

    mockContainer = { resolve: jest.fn() } as never

    const findDefinition = jest.requireMock('../find-definition') as {
      findDefinitionForInstance: jest.Mock
    }
    findDefinition.findDefinitionForInstance.mockResolvedValue(compensatingDefinition as never)
  })

  test('a clean rollback lands COMPENSATED with a completedAt and the compensated verdict', async () => {
    const compensation = jest.requireMock('../compensation-handler') as { compensateWorkflow: jest.Mock }
    compensation.compensateWorkflow.mockImplementation(async () => {
      instance.status = 'COMPENSATED' as never
      return { status: 'COMPLETED', totalActivities: 1, compensatedActivities: 1, failedCompensations: [] }
    })

    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'FAILED', {
      error: 'stock reservation failed',
    })

    expect(instance.status).toBe('COMPENSATED')
    expect(instance.outcome).toBe('compensated')
    // Before this fix the compensating path returned before ANY timestamp was
    // written, so the run belonged to no KPI window.
    expect(instance.completedAt).toBeInstanceOf(Date)
  })

  test('a partial rollback (status back to FAILED) also gets its timestamp', async () => {
    const compensation = jest.requireMock('../compensation-handler') as { compensateWorkflow: jest.Mock }
    compensation.compensateWorkflow.mockImplementation(async () => {
      instance.status = 'FAILED' as never
      return { status: 'PARTIAL', totalActivities: 2, compensatedActivities: 1, failedCompensations: ['a2'] }
    })

    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'FAILED', {
      error: 'stock reservation failed',
    })

    expect(instance.status).toBe('FAILED')
    expect(instance.outcome).toBe('failure')
    expect(instance.completedAt).toBeInstanceOf(Date)
  })

  test('an already-recorded terminal instant is never moved', async () => {
    const recorded = new Date('2026-07-30T09:30:00.000Z')
    instance.completedAt = recorded

    const compensation = jest.requireMock('../compensation-handler') as { compensateWorkflow: jest.Mock }
    compensation.compensateWorkflow.mockImplementation(async () => {
      instance.status = 'COMPENSATED' as never
      return { status: 'COMPLETED', totalActivities: 1, compensatedActivities: 1, failedCompensations: [] }
    })

    await workflowExecutor.completeWorkflow(mockEm, mockContainer, instanceId, 'FAILED', {})

    expect(instance.completedAt).toBe(recorded)
  })
})

describe('a compensated run now belongs to a KPI window', () => {
  test('COMPENSATED is a terminal status', () => {
    expect([...WORKFLOW_TERMINAL_STATUSES]).toContain('COMPENSATED')
  })

  test('it is counted as its own number, in neither the success nor the failure bucket', () => {
    const metrics = buildDefinitionMetrics({
      runsStarted: 2,
      terminalRuns: [
        {
          status: 'COMPENSATED',
          outcome: 'compensated',
          startedAt: new Date('2026-07-30T09:00:00.000Z'),
          terminalAt: new Date('2026-07-30T09:05:00.000Z'),
        },
        {
          status: 'COMPLETED',
          outcome: 'success',
          startedAt: new Date('2026-07-30T09:00:00.000Z'),
          terminalAt: new Date('2026-07-30T09:01:00.000Z'),
        },
      ],
      completedTasks: [],
    })

    expect(metrics.runsTerminal).toBe(2)
    expect(metrics.runsCompensated).toBe(1)
    expect(metrics.runsCompleted).toBe(1)
    expect(metrics.runsFailed).toBe(0)
    expect(metrics.successRate).toBeCloseTo(0.5)
    // Its duration is now measurable, which it was not while it had no
    // terminal instant.
    expect(metrics.durationSampleCount).toBe(2)
  })
})
