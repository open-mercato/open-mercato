import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { createQueue } from '@open-mercato/queue'
import { ScheduledJob } from '../../data/entities'
import executeScheduleWorker from '../execute-schedule.worker'

const mockCommandExecute = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  CommandBus: jest.fn().mockImplementation(() => ({
    execute: mockCommandExecute,
  })),
}))

jest.mock('@open-mercato/queue', () => ({
  createQueue: jest.fn(),
}), { virtual: true })

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(() => 'redis://localhost:6379'),
}))

jest.mock('../../events', () => ({
  emitSchedulerEvent: jest.fn(async () => undefined),
}))

const scheduleId = '11111111-1111-4111-8111-111111111111'

function buildCommandSchedule(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const schedule = new ScheduledJob()
  schedule.id = scheduleId
  schedule.name = 'Scoped command'
  schedule.scopeType = 'organization'
  schedule.tenantId = 'tenant-a'
  schedule.organizationId = 'org-a'
  schedule.isEnabled = true
  schedule.targetType = 'command'
  schedule.targetCommand = 'scheduler.test.assert-tenant-scope'
  schedule.targetPayload = { checkedTenantId: 'tenant-b' }
  schedule.scheduleType = 'cron'
  schedule.scheduleValue = '* * * * *'
  schedule.timezone = 'UTC'
  schedule.sourceType = 'user'
  schedule.createdAt = new Date('2026-01-01T00:00:00.000Z')
  schedule.updatedAt = new Date('2026-01-01T00:00:00.000Z')
  Object.assign(schedule, overrides)
  return schedule
}

function buildWorkerContext(schedule: ScheduledJob) {
  const em = {
    findOne: jest.fn(async () => schedule),
    flush: jest.fn(async () => undefined),
  }
  const rbacService = {
    tenantHasFeature: jest.fn(async () => true),
  }
  return {
    context: {
      jobId: 'worker-job-1',
      attemptNumber: 1,
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbacService
        throw new Error(`Unexpected dependency: ${name}`)
      }),
    },
    em,
    rbacService,
  }
}

describe('executeScheduleWorker command scope', () => {
  afterEach(() => {
    mockCommandExecute.mockReset()
  })

  it('runs scheduled commands with schedule-bound tenant auth so command guards enforce tenant scope (#3899)', async () => {
    mockCommandExecute.mockImplementation(async (_commandId, { input, ctx }) => {
      ensureTenantScope(ctx, String((input as { checkedTenantId: string }).checkedTenantId))
      return { result: { ok: true }, logEntry: null }
    })

    const schedule = buildCommandSchedule()
    const { context, em } = buildWorkerContext(schedule)

    await expect(
      executeScheduleWorker(
        {
          id: 'queued-job-1',
          queue: 'scheduler-execution',
          payload: {
            scheduleId,
            tenantId: 'tenant-a',
            organizationId: 'org-a',
            scopeType: 'organization',
          },
          attempts: 0,
          createdAt: Date.now(),
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CrudHttpError)

    expect(em.flush).not.toHaveBeenCalled()
  })
})

describe('executeScheduleWorker queue target payload contract', () => {
  const enqueue = jest.fn(async () => 'target-job-1')
  const close = jest.fn(async () => undefined)

  function buildQueueSchedule(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
    return buildCommandSchedule({
      targetType: 'queue',
      targetQueue: 'example',
      targetCommand: null,
      targetPayload: { connectionId: 'connection-id', scope: 'organization' },
      ...overrides,
    })
  }

  function runWorker(schedule: ScheduledJob, jobId = 'worker-job-1', attemptNumber = 1) {
    const { context } = buildWorkerContext(schedule)
    return executeScheduleWorker(
      {
        id: 'queued-job-1',
        queue: 'scheduler-execution',
        payload: {
          scheduleId,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
          scopeType: schedule.scopeType,
        },
        attempts: 0,
        createdAt: Date.now(),
      },
      { ...context, jobId, attemptNumber },
    )
  }

  beforeEach(() => {
    enqueue.mockClear()
    close.mockClear()
    ;(createQueue as jest.Mock).mockReturnValue({ enqueue, close })
  })

  it('delivers the flat targetPayload contract with scheduler-owned fields applied last', async () => {
    const schedule = buildQueueSchedule({
      targetPayload: {
        connectionId: 'connection-id',
        scope: 'organization',
        tenantId: 'spoofed-tenant',
        payload: { nested: true },
      },
    })

    await runWorker(schedule)

    expect(enqueue).toHaveBeenCalledWith({
      connectionId: 'connection-id',
      scope: 'organization',
      payload: { nested: true },
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      _idempotencyKey: `scheduler-${scheduleId}-worker-job-1`,
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps one idempotency key across retries of the same logical firing', async () => {
    await runWorker(buildQueueSchedule(), 'worker-job-1', 1)
    await runWorker(buildQueueSchedule(), 'worker-job-1', 2)

    const firstKey = (enqueue.mock.calls[0][0] as Record<string, unknown>)._idempotencyKey
    const secondKey = (enqueue.mock.calls[1][0] as Record<string, unknown>)._idempotencyKey
    expect(firstKey).toBe(`scheduler-${scheduleId}-worker-job-1`)
    expect(secondKey).toBe(firstKey)
  })
})
