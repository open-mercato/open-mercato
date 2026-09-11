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

jest.mock('../event-logger', () => ({
  logWorkflowEvent: jest.fn(async () => undefined),
}))

jest.mock('../workflow-executor', () => ({
  resumeWorkflowAfterActivities: jest.fn(async () => undefined),
}))

import { z } from 'zod'
import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { JobContext, QueuedJob } from '@open-mercato/queue'
import { WorkflowInstance } from '../../data/entities'
import { createActivityWorkerHandler } from '../activity-worker-handler'
import { registerActivityType } from '../activity-registry'
import { logWorkflowEvent } from '../event-logger'
import type { WorkflowActivityJob, WorkflowActivityJobActivity } from '../activity-queue-types'

const mockLogWorkflowEvent = logWorkflowEvent as jest.MockedFunction<typeof logWorkflowEvent>

registerActivityType({
  id: 'TEST_NOT_ASYNC',
  icon: 'Ban',
  i18nKey: 'workflows.activities.types.TEST_NOT_ASYNC',
  configSchema: z.object({}),
  form: [],
  execute: async () => ({ ok: true }),
  async: { capable: false, reason: 'requiresRequestScope' },
})

describe('Activity Worker Handler (registry dispatch)', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let mockInstance: WorkflowInstance

  const jobCtx: JobContext = { jobId: 'job-1', attemptNumber: 1, queueName: 'workflow-activities' }

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

    mockContainer = {
      resolve: jest.fn(),
    } as unknown as jest.Mocked<AwilixContainer>
  })

  test('dispatches SEND_EMAIL through the registry', async () => {
    const send = jest.fn(async () => undefined)
    mockContainer.resolve.mockImplementation(((token: string) => {
      if (token === 'emailService') return { send }
      throw new Error(`not registered: ${token}`)
    }) as AwilixContainer['resolve'])

    const handler = createActivityWorkerHandler(mockEm, mockContainer)
    await handler(
      makeJob(
        makePayload({
          activityType: 'SEND_EMAIL',
          activityConfig: { to: 'user@example.com', subject: 'Hello', body: 'Hi' },
        })
      ),
      jobCtx
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

  test('dispatches EMIT_EVENT through the registry', async () => {
    const emitEvent = jest.fn(async () => undefined)
    mockContainer.resolve.mockImplementation(((token: string) => {
      if (token === 'eventBus') return { emitEvent }
      throw new Error(`not registered: ${token}`)
    }) as AwilixContainer['resolve'])

    const handler = createActivityWorkerHandler(mockEm, mockContainer)
    await handler(
      makeJob(
        makePayload({
          activityType: 'EMIT_EVENT',
          activityConfig: { eventName: 'example.thing.created', payload: { id: '1' } },
        })
      ),
      jobCtx
    )

    expect(emitEvent).toHaveBeenCalledWith(
      'example.thing.created',
      expect.objectContaining({ id: '1' }),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' })
    )
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({ eventType: 'ACTIVITY_COMPLETED' })
    )
  })

  test('WAIT completes immediately without re-sleeping the delay', async () => {
    const handler = createActivityWorkerHandler(mockEm, mockContainer)
    const startedAt = Date.now()

    await handler(
      makeJob(
        makePayload({
          activityType: 'WAIT',
          activityConfig: { duration: 'PT2H' },
        })
      ),
      jobCtx
    )

    expect(Date.now() - startedAt).toBeLessThan(1000)
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({
        eventType: 'ACTIVITY_COMPLETED',
        eventData: expect.objectContaining({ output: { waited: true, async: true } }),
      })
    )
  })

  test('rejects a non-async-capable type with the registry reason', async () => {
    const handler = createActivityWorkerHandler(mockEm, mockContainer)

    await expect(
      handler(makeJob(makePayload({ activityType: 'TEST_NOT_ASYNC' })), jobCtx)
    ).rejects.toThrow(
      'Activity type TEST_NOT_ASYNC cannot run asynchronously (requiresRequestScope)'
    )
    expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
      mockEm,
      expect.objectContaining({ eventType: 'ACTIVITY_FAILED' })
    )
  })

  test('rejects an unknown activity type', async () => {
    const handler = createActivityWorkerHandler(mockEm, mockContainer)

    await expect(
      handler(makeJob(makePayload({ activityType: 'UNKNOWN_TYPE' })), jobCtx)
    ).rejects.toThrow('Unsupported activity type: UNKNOWN_TYPE')
  })
})
