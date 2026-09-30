/** @jest-environment node */

const mockLoggerInstance = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}
mockLoggerInstance.child.mockImplementation(() => mockLoggerInstance)

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => mockLoggerInstance),
}))

jest.mock('../../lib/event-logger', () => ({
  logWorkflowEvent: jest.fn(async () => undefined),
}))

jest.mock('../../lib/workflow-executor', () => ({
  resumeWorkflowAfterActivities: jest.fn(async () => undefined),
}))

import { EntityManager } from '@mikro-orm/core'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { WorkflowInstance } from '../../data/entities'
import handleWorkflowActivityJob from '../workflow-activities.worker'
import { logWorkflowEvent } from '../../lib/event-logger'
import type { WorkflowActivityJob, WorkflowActivityJobActivity } from '../../lib/activity-queue-types'

const mockLogWorkflowEvent = logWorkflowEvent as jest.MockedFunction<typeof logWorkflowEvent>

describe('workflow-activities worker (registry dispatch)', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockInstance: WorkflowInstance
  let resolvables: Record<string, unknown>

  const makeCtx = (): JobContext & { resolve: <T = unknown>(name: string) => T } => ({
    jobId: 'job-1',
    attemptNumber: 1,
    queueName: 'workflow-activities',
    resolve: <T = unknown>(name: string): T => {
      if (name in resolvables) return resolvables[name] as T
      throw new Error(`not registered: ${name}`)
    },
  })

  const makePayload = (overrides: Partial<WorkflowActivityJobActivity>): WorkflowActivityJobActivity => ({
    workflowInstanceId: 'instance-1',
    stepInstanceId: 'step-instance-1',
    activityId: 'activity-1',
    activityName: 'Test Activity',
    activityType: 'SEND_EMAIL',
    activityConfig: {},
    workflowContext: {},
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    ...overrides,
  })

  const makeJob = (payload: WorkflowActivityJob): QueuedJob<WorkflowActivityJob> => ({
    id: 'job-1',
    payload,
    createdAt: new Date().toISOString(),
  })

  beforeEach(() => {
    jest.clearAllMocks()

    mockInstance = {
      id: 'instance-1',
      definitionId: 'definition-1',
      workflowId: 'test-workflow',
      version: 1,
      currentStepId: 'step-1',
      status: 'RUNNING',
      context: {},
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    } as WorkflowInstance

    mockEm = {
      findOne: jest.fn(async () => mockInstance),
    } as unknown as jest.Mocked<EntityManager>

    resolvables = { em: mockEm }
  })

  test('dispatches SEND_EMAIL through the registry', async () => {
    const send = jest.fn(async () => undefined)
    resolvables.emailService = { send }

    await handleWorkflowActivityJob(
      makeJob(
        makePayload({
          activityType: 'SEND_EMAIL',
          activityConfig: { to: 'user@example.com', subject: 'Hello', body: 'Hi' },
        })
      ),
      makeCtx()
    )

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@example.com', subject: 'Hello' })
    )
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({
        eventType: 'ACTIVITY_COMPLETED',
        eventData: expect.objectContaining({
          output: expect.objectContaining({ sent: true, via: 'emailService' }),
        }),
      })
    )
  })

  test('refuses SET_VARIABLE with the registry non-capable reason', async () => {
    await expect(
      handleWorkflowActivityJob(
        makeJob(
          makePayload({
            activityType: 'SET_VARIABLE',
            activityConfig: { assignments: [{ path: 'customer.priority', value: 'high' }] },
          })
        ),
        makeCtx()
      )
    ).rejects.toThrow(
      'Activity type SET_VARIABLE cannot run asynchronously (asyncResumeMergeDoesNotApplyAssignments)'
    )
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({ eventType: 'ACTIVITY_FAILED' })
    )
  })

  test('rejects an unknown activity type', async () => {
    await expect(
      handleWorkflowActivityJob(
        makeJob(makePayload({ activityType: 'UNKNOWN_TYPE' })),
        makeCtx()
      )
    ).rejects.toThrow('Unsupported activity type: UNKNOWN_TYPE')
  })
})
