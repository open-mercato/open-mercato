/**
 * A synchronous 90-day WAIT that ends a transition must park the run, not fail
 * it: the transition handler opts into `queueLongInlineWaits`, so the real
 * activity executor queues the WAIT with its full delay and the transition
 * pauses in WAITING_FOR_ACTIVITIES until the queued job resumes it.
 */

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

const enqueueMock = jest.fn().mockResolvedValue('job-ninety-days')

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: () => ({ enqueue: (...args: unknown[]) => enqueueMock(...args) }),
}))

jest.mock('../event-logger', () => ({
  logWorkflowEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const stub = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: () => stub }
  return { createLogger: () => stub }
})

jest.mock('../../../business_rules/lib/rule-evaluator')
jest.mock('../../../business_rules/lib/rule-engine')
jest.mock('../step-handler')

import { executeTransition } from '../transition-handler'
import * as stepHandler from '../step-handler'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

describe('executeTransition with a synchronous 90-day WAIT ending the transition', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('parks the run in WAITING_FOR_ACTIVITIES with the WAIT queued for its full delay', async () => {
    const definition = {
      id: 'definition-1',
      workflowId: 'long-hold',
      workflowName: 'Long Hold',
      version: 1,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          {
            transitionId: 'start-to-end',
            fromStepId: 'start',
            toStepId: 'end',
            trigger: 'auto',
            activities: [
              { activityId: 'hold', activityName: 'hold', activityType: 'WAIT', config: { duration: 'P90D' } },
            ],
          },
        ],
      },
    } as unknown as WorkflowDefinition

    const em = {
      findOne: jest.fn().mockResolvedValue(definition),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(function persist(this: unknown) {
        return this
      }),
      flush: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager
    const container = { resolve: jest.fn() } as unknown as AwilixContainer

    const instance = {
      id: 'instance-1',
      definitionId: 'definition-1',
      workflowId: 'long-hold',
      currentStepId: 'start',
      status: 'RUNNING',
      context: {},
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      version: 1,
      isDryRun: false,
      startedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as WorkflowInstance

    const result = await executeTransition(em, container, instance, 'start', 'end', {
      workflowContext: {},
      transitionId: 'start-to-end',
    })

    expect(result.success).toBe(true)
    expect(result.pausedForActivities).toBe(true)
    expect(instance.status).toBe('WAITING_FOR_ACTIVITIES')
    expect(instance.currentStepId).toBe('start')
    expect(instance.context).toEqual(
      expect.objectContaining({
        _pendingAsyncActivities: [{ activityId: 'hold', jobId: 'job-ninety-days' }],
      })
    )
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][1]).toEqual({ delayMs: NINETY_DAYS_MS })
    expect(stepHandler.executeStep).not.toHaveBeenCalled()
  })
})
