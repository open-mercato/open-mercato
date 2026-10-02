import { z } from 'zod'
import { createQueue } from '@open-mercato/queue'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { ScheduledJob } from '../../data/entities'
import { registerSchedulerSafeCommands } from '../../lib/scheduler-safe-commands'
import { registerSchedulerQueuePayloadSchema } from '../../lib/safeQueueTargets'
import executeScheduleWorker from '../execute-schedule.worker'

registerModules([
  {
    id: 'next_run_test_module',
    workers: [
      {
        id: 'next_run_test_module:workers:example',
        queue: 'next-run-example',
        concurrency: 1,
        handler: async () => {},
      },
      {
        id: 'next_run_test_module:workers:strict',
        queue: 'next-run-strict',
        concurrency: 1,
        handler: async () => {},
      },
      {
        id: 'next_run_test_module:workers:gated',
        queue: 'next-run-gated',
        concurrency: 1,
        schedulerSafe: true,
        schedulerRequiredFeatures: ['next_run.gated'],
        handler: async () => {},
      },
    ],
  },
] as never)

registerSchedulerQueuePayloadSchema('next-run-strict', z.object({}).strict())

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
  parseRedisUrl: jest.fn(() => ({ host: 'localhost', port: 6379 })),
}))

const emitSchedulerEvent = jest.fn(async () => undefined)

jest.mock('../../events', () => ({
  emitSchedulerEvent: (...args: unknown[]) => emitSchedulerEvent(...(args as [])),
}))

const mockGetJobScheduler = jest.fn()
const mockBullQueueClose = jest.fn(async () => undefined)
const mockBullQueueDisconnect = jest.fn(async () => undefined)
const mockBullQueueConstructor = jest.fn(() => ({
  getJobScheduler: mockGetJobScheduler,
  on: jest.fn(),
  close: mockBullQueueClose,
  disconnect: mockBullQueueDisconnect,
}))

jest.mock('bullmq', () => ({
  Queue: mockBullQueueConstructor,
}))

const scheduleId = '22222222-2222-4222-8222-222222222222'
const staleNextRunAt = new Date('2026-01-01T00:00:00.000Z')
const bullmqNextMillis = Date.UTC(2030, 0, 1, 6, 0, 0)
const bullmqNextRunAt = new Date(bullmqNextMillis)

function buildCommandSchedule(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const schedule = new ScheduledJob()
  schedule.id = scheduleId
  schedule.name = 'Next run schedule'
  schedule.scopeType = 'organization'
  schedule.tenantId = 'tenant-a'
  schedule.organizationId = 'org-a'
  schedule.isEnabled = true
  schedule.targetType = 'command'
  schedule.targetCommand = 'scheduler.test.next-run'
  schedule.targetPayload = {}
  schedule.scheduleType = 'cron'
  schedule.scheduleValue = '0 6 * * *'
  schedule.timezone = 'Europe/Warsaw'
  schedule.sourceType = 'user'
  schedule.createdByUserId = 'user-a'
  schedule.nextRunAt = staleNextRunAt
  Object.assign(schedule, overrides)
  return schedule
}

function buildQueueSchedule(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return buildCommandSchedule({
    targetType: 'queue',
    targetQueue: 'next-run-example',
    targetCommand: null,
    sourceType: 'module',
    createdByUserId: null,
    sourceModule: 'next_run_test_module',
    targetPayload: { connectionId: 'connection-id' },
    scheduleType: 'interval',
    scheduleValue: '15m',
    timezone: 'UTC',
    ...overrides,
  })
}

function buildWorkerContext(schedule: ScheduledJob | null) {
  const execute = jest.fn(async () => ({ affectedRows: 1 }))
  const em = {
    findOne: jest.fn(async () => schedule),
    flush: jest.fn(async () => undefined),
    getConnection: jest.fn(() => ({ execute })),
  }
  const rbacService = {
    tenantHasFeature: jest.fn(async () => true),
    userHasAllFeatures: jest.fn(async () => true),
  }
  return {
    context: {
      jobId: `repeat:schedule-${scheduleId}:1893477600000`,
      attemptNumber: 1,
      queueName: 'scheduler-execution',
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbacService
        throw new Error(`Unexpected dependency: ${name}`)
      }),
    },
    em,
    execute,
    rbacService,
  }
}

function runWorker(
  schedule: ScheduledJob,
  harness: ReturnType<typeof buildWorkerContext>,
  payloadOverrides: Record<string, unknown> = {},
) {
  return executeScheduleWorker(
    {
      id: 'queued-job-1',
      payload: {
        scheduleId,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
        scopeType: schedule.scopeType,
        ...payloadOverrides,
      },
      createdAt: new Date().toISOString(),
    },
    harness.context as never,
  )
}

function expectNextRunWrite(
  execute: jest.Mock,
  timing: { scheduleType: string; scheduleValue: string; timezone: string },
) {
  expect(execute).toHaveBeenCalledTimes(1)
  const [sql, params, method] = execute.mock.calls[0] as [string, unknown[], string]
  expect(sql).toMatch(/^update scheduled_jobs\s+set next_run_at = \?/)
  expect(params).toEqual([
    bullmqNextRunAt,
    scheduleId,
    timing.scheduleType,
    timing.scheduleValue,
    timing.timezone,
    bullmqNextRunAt,
    bullmqNextRunAt,
  ])
  expect(method).toBe('run')
}

const cronTiming = { scheduleType: 'cron', scheduleValue: '0 6 * * *', timezone: 'Europe/Warsaw' }
const intervalTiming = { scheduleType: 'interval', scheduleValue: '15m', timezone: 'UTC' }

describe('executeScheduleWorker nextRunAt sync (async strategy)', () => {
  const originalStrategy = process.env.QUEUE_STRATEGY
  const enqueue = jest.fn(async () => 'target-job-1')
  const close = jest.fn(async () => undefined)

  beforeAll(() => {
    registerSchedulerSafeCommands([
      { commandId: 'scheduler.test.next-run', requiredFeatures: ['scheduler.jobs.manage'] },
    ])
  })

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.QUEUE_STRATEGY = 'async'
    mockCommandExecute.mockResolvedValue({ result: { ok: true }, logEntry: null })
    mockGetJobScheduler.mockResolvedValue({ next: bullmqNextMillis, pattern: '0 6 * * *', tz: 'Europe/Warsaw' })
    ;(createQueue as jest.Mock).mockReturnValue({ enqueue, close })
  })

  afterAll(() => {
    if (originalStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalStrategy
  })

  it('writes the BullMQ next slot after a completed command run', async () => {
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expect(mockCommandExecute).toHaveBeenCalledTimes(1)
    expect(mockBullQueueConstructor).toHaveBeenCalledWith('scheduler-execution', expect.anything())
    expect(mockGetJobScheduler).toHaveBeenCalledWith(`schedule-${scheduleId}`)
    expect(mockBullQueueClose).toHaveBeenCalledTimes(1)
    expectNextRunWrite(harness.execute, cronTiming)
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
  })

  it('reads BullMQ only after the target has run', async () => {
    const order: string[] = []
    mockCommandExecute.mockImplementation(async () => {
      order.push('command')
      return { result: { ok: true }, logEntry: null }
    })
    mockGetJobScheduler.mockImplementation(async () => {
      order.push('read')
      return { next: bullmqNextMillis, pattern: '0 6 * * *', tz: 'Europe/Warsaw' }
    })
    const schedule = buildCommandSchedule()

    await runWorker(schedule, buildWorkerContext(schedule))

    expect(order).toEqual(['command', 'read'])
  })

  it('writes the BullMQ next slot after a completed queue-target run', async () => {
    mockGetJobScheduler.mockResolvedValue({ next: bullmqNextMillis, every: 900000, tz: 'UTC' })
    const schedule = buildQueueSchedule()
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expect(enqueue).toHaveBeenCalledTimes(1)
    expectNextRunWrite(harness.execute, intervalTiming)
  })

  it('writes the BullMQ next slot for a manual run too', async () => {
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness, { triggerType: 'manual', triggeredByUserId: 'user-b' })

    expect(mockCommandExecute).toHaveBeenCalledTimes(1)
    expectNextRunWrite(harness.execute, cronTiming)
  })

  it('writes the BullMQ next slot when the run is skipped for a missing required feature', async () => {
    const schedule = buildCommandSchedule({ requireFeature: 'some.feature' })
    const harness = buildWorkerContext(schedule)
    harness.rbacService.tenantHasFeature.mockResolvedValue(false)

    await runWorker(schedule, harness)

    expect(mockCommandExecute).not.toHaveBeenCalled()
    expect(emitSchedulerEvent).toHaveBeenCalledWith('scheduler.job.skipped', expect.objectContaining({ id: scheduleId }))
    expectNextRunWrite(harness.execute, cronTiming)
    expect(harness.em.flush).not.toHaveBeenCalled()
  })

  it('writes the BullMQ next slot when the queue target is refused as unapproved', async () => {
    mockGetJobScheduler.mockResolvedValue({ next: bullmqNextMillis, every: 900000, tz: 'UTC' })
    const schedule = buildQueueSchedule({ targetQueue: 'not-a-registered-queue' })
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expect(enqueue).not.toHaveBeenCalled()
    expectNextRunWrite(harness.execute, intervalTiming)
  })

  it('writes the BullMQ next slot when the stored payload is rejected by the queue target schema', async () => {
    mockGetJobScheduler.mockResolvedValue({ next: bullmqNextMillis, every: 900000, tz: 'UTC' })
    const schedule = buildQueueSchedule({ targetQueue: 'next-run-strict', targetPayload: { unexpected: true } })
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expect(enqueue).not.toHaveBeenCalled()
    expect(emitSchedulerEvent).toHaveBeenCalledWith('scheduler.job.skipped', expect.objectContaining({
      reason: 'Invalid payload for scheduler queue next-run-strict',
    }))
    expectNextRunWrite(harness.execute, intervalTiming)
  })

  it('writes the BullMQ next slot when the tenant lacks a feature the queue target requires', async () => {
    mockGetJobScheduler.mockResolvedValue({ next: bullmqNextMillis, every: 900000, tz: 'UTC' })
    const schedule = buildQueueSchedule({ targetQueue: 'next-run-gated' })
    const harness = buildWorkerContext(schedule)
    harness.rbacService.tenantHasFeature.mockResolvedValue(false)

    await runWorker(schedule, harness)

    expect(enqueue).not.toHaveBeenCalled()
    expect(emitSchedulerEvent).toHaveBeenCalledWith('scheduler.job.skipped', expect.objectContaining({
      reason: 'Tenant lacks feature required by scheduler queue next-run-gated: next_run.gated',
    }))
    expectNextRunWrite(harness.execute, intervalTiming)
  })

  it('writes the BullMQ next slot when the scheduled command is refused', async () => {
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)
    harness.rbacService.userHasAllFeatures.mockResolvedValue(false)

    await expect(runWorker(schedule, harness)).resolves.toBeUndefined()

    expect(mockCommandExecute).not.toHaveBeenCalled()
    expect(emitSchedulerEvent).toHaveBeenCalledWith('scheduler.job.failed', expect.objectContaining({ id: scheduleId }))
    expectNextRunWrite(harness.execute, cronTiming)
  })

  it('writes the BullMQ next slot when the target throws, and rethrows the target error unchanged', async () => {
    const failure = new Error('target exploded')
    mockCommandExecute.mockRejectedValue(failure)
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)

    await expect(runWorker(schedule, harness)).rejects.toBe(failure)

    expect(harness.em.flush).not.toHaveBeenCalled()
    expectNextRunWrite(harness.execute, cronTiming)
  })

  it('uses the timing loaded before the target ran, even if the entity is mutated during the run', async () => {
    const schedule = buildCommandSchedule()
    mockCommandExecute.mockImplementation(async () => {
      schedule.scheduleValue = '0 0 1 1 *'
      schedule.timezone = 'UTC'
      return { result: { ok: true }, logEntry: null }
    })
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expectNextRunWrite(harness.execute, cronTiming)
  })

  it('writes nothing when BullMQ has no scheduler for the schedule', async () => {
    mockGetJobScheduler.mockResolvedValue(undefined)
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expect(mockCommandExecute).toHaveBeenCalledTimes(1)
    expect(mockBullQueueClose).toHaveBeenCalledTimes(1)
    expect(harness.execute).not.toHaveBeenCalled()
  })

  it('writes nothing when the BullMQ scheduler carries a different timing than the run loaded', async () => {
    mockGetJobScheduler.mockResolvedValue({ next: bullmqNextMillis, pattern: '0 0 1 1 *', tz: 'Europe/Warsaw' })
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expect(mockGetJobScheduler).toHaveBeenCalledTimes(1)
    expect(harness.execute).not.toHaveBeenCalled()
  })

  it('keeps a completed run successful when the BullMQ read fails', async () => {
    mockGetJobScheduler.mockRejectedValue(new Error('redis unavailable'))
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)

    await expect(runWorker(schedule, harness)).resolves.toBeUndefined()

    expect(schedule.lastRunAt).toBeInstanceOf(Date)
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
    expect(mockBullQueueClose).toHaveBeenCalledTimes(1)
    expect(harness.execute).not.toHaveBeenCalled()
  })

  it('keeps a completed run successful when the nextRunAt write fails', async () => {
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)
    harness.execute.mockRejectedValue(new Error('connection terminated'))

    await expect(runWorker(schedule, harness)).resolves.toBeUndefined()

    expect(harness.execute).toHaveBeenCalledTimes(1)
    expect(emitSchedulerEvent).toHaveBeenCalledWith('scheduler.job.completed', expect.objectContaining({ id: scheduleId }))
  })

  it('rethrows the target error, not the sync error, when both fail', async () => {
    const failure = new Error('target exploded')
    mockCommandExecute.mockRejectedValue(failure)
    mockGetJobScheduler.mockRejectedValue(new Error('redis unavailable'))
    const schedule = buildCommandSchedule()

    await expect(runWorker(schedule, buildWorkerContext(schedule))).rejects.toBe(failure)
    expect(mockGetJobScheduler).toHaveBeenCalledTimes(1)
  })

  it('does not read BullMQ or write when the schedule does not exist', async () => {
    const harness = buildWorkerContext(null)

    await executeScheduleWorker(
      {
        id: 'queued-job-1',
        payload: { scheduleId, tenantId: 'tenant-a', organizationId: 'org-a', scopeType: 'organization' },
        createdAt: new Date().toISOString(),
      },
      harness.context as never,
    )

    expect(mockBullQueueConstructor).not.toHaveBeenCalled()
    expect(harness.execute).not.toHaveBeenCalled()
  })

  it('does not read BullMQ or write when the schedule is disabled', async () => {
    const schedule = buildCommandSchedule({ isEnabled: false })
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expect(mockCommandExecute).not.toHaveBeenCalled()
    expect(mockBullQueueConstructor).not.toHaveBeenCalled()
    expect(harness.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['scope type', { scopeType: 'tenant' }],
    ['tenant', { tenantId: 'tenant-b' }],
    ['organization', { organizationId: 'org-b' }],
    ['scope carried by a CLI-shaped payload', { scopeType: undefined, tenantId: undefined, organizationId: undefined }],
  ])('does not read BullMQ or write when the payload %s does not match the schedule', async (_label, payloadOverrides) => {
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)

    await expect(runWorker(schedule, harness, payloadOverrides)).rejects.toThrow(/mismatch/)

    expect(mockBullQueueConstructor).not.toHaveBeenCalled()
    expect(harness.execute).not.toHaveBeenCalled()
  })

  it('does not read BullMQ or write under the local strategy', async () => {
    process.env.QUEUE_STRATEGY = 'local'
    const schedule = buildCommandSchedule()
    const harness = buildWorkerContext(schedule)

    await runWorker(schedule, harness)

    expect(mockCommandExecute).toHaveBeenCalledTimes(1)
    expect(mockBullQueueConstructor).not.toHaveBeenCalled()
    expect(harness.execute).not.toHaveBeenCalled()
  })
})
