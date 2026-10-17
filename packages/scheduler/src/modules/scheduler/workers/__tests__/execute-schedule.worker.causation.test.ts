import { createQueue } from '@open-mercato/queue'
import { CAUSATION_META_KEY, MISSING_CAUSATION_REF, runJobInCausation } from '@open-mercato/queue/causation'
import {
  createCausationEnvelope,
  getAmbientCausation,
  primaryCause,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { ScheduledJob } from '../../data/entities'
import { registerSchedulerSafeCommands } from '../../lib/scheduler-safe-commands'
import executeScheduleWorker from '../execute-schedule.worker'

registerModules([
  {
    id: 'causation_test_module',
    workers: [
      {
        id: 'causation_test_module:workers:example',
        queue: 'causation-example',
        concurrency: 1,
        handler: async () => {},
      },
    ],
  },
] as never)

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

const observedEventCausation: Array<{ eventId: string; causation: CausationEnvelope | null }> = []
const emitSchedulerEvent = jest.fn(async (eventId: string) => {
  observedEventCausation.push({ eventId, causation: getAmbientCausation() })
})

jest.mock('../../events', () => ({
  emitSchedulerEvent: (...args: unknown[]) => emitSchedulerEvent(...(args as [string])),
}))

const scheduleId = '22222222-2222-4222-8222-222222222222'

function buildSchedule(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const schedule = new ScheduledJob()
  schedule.id = scheduleId
  schedule.name = 'Causation probe'
  schedule.scopeType = 'organization'
  schedule.tenantId = 'tenant-a'
  schedule.organizationId = 'org-a'
  schedule.isEnabled = true
  schedule.targetType = 'command'
  schedule.targetCommand = 'scheduler.test.causation-probe'
  schedule.targetPayload = {}
  schedule.scheduleType = 'cron'
  schedule.scheduleValue = '* * * * *'
  schedule.timezone = 'UTC'
  schedule.sourceType = 'user'
  schedule.createdByUserId = 'user-a'
  schedule.createdAt = new Date('2026-10-08T00:00:00.000Z')
  schedule.updatedAt = new Date('2026-10-08T00:00:00.000Z')
  Object.assign(schedule, overrides)
  return schedule
}

function runWorker(schedule: ScheduledJob, payloadOverrides: Record<string, unknown> = {}) {
  const em = {
    findOne: jest.fn(async () => schedule),
    flush: jest.fn(async () => undefined),
  }
  const rbacService = {
    tenantHasFeature: jest.fn(async () => true),
    userHasAllFeatures: jest.fn(async () => true),
  }
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
    {
      jobId: 'worker-job-1',
      attemptNumber: 1,
      resolve: jest.fn((name: string) => {
        if (name === 'em') return em
        if (name === 'rbacService') return rbacService
        throw new Error(`Unexpected dependency: ${name}`)
      }),
    } as never,
  )
}

const EXECUTION_QUEUE = 'scheduler-execution'

describe('executeScheduleWorker causation', () => {
  const originalCausationFlag = process.env.OM_CAUSATION

  afterEach(() => {
    if (originalCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = originalCausationFlag
  })

  beforeAll(() => {
    registerSchedulerSafeCommands([
      {
        commandId: 'scheduler.test.causation-probe',
        requiredFeatures: ['scheduler.jobs.manage'],
      },
    ])
  })

  beforeEach(() => {
    mockCommandExecute.mockReset()
    emitSchedulerEvent.mockClear()
    observedEventCausation.length = 0
  })

  it('runs a command target inside a schedule frame and hands the same envelope to the command context', async () => {
    let ambientInCommand: CausationEnvelope | null = null
    let commandCtx: CommandRuntimeContext | null = null
    mockCommandExecute.mockImplementation(async (_commandId: string, options: { ctx: CommandRuntimeContext }) => {
      ambientInCommand = getAmbientCausation()
      commandCtx = options.ctx
      return { result: { ok: true }, logEntry: null }
    })

    await runWorker(buildSchedule())

    expect(ambientInCommand!.frames).toEqual([{ kind: 'schedule', id: scheduleId }])
    expect(commandCtx!.causation).toEqual(ambientInCommand)
    expect(observedEventCausation.map((entry) => entry.eventId)).toEqual([
      'scheduler.job.started',
      'scheduler.job.completed',
    ])
    for (const entry of observedEventCausation) {
      expect(entry.causation!.frames).toEqual([{ kind: 'schedule', id: scheduleId }])
      expect(entry.causation!.correlationId).toBe(ambientInCommand!.correlationId)
    }
    expect(getAmbientCausation()).toBeNull()
  })

  it('stacks the schedule frame on the envelope restored for a manual trigger and keeps its correlation', async () => {
    let ambientInCommand: CausationEnvelope | null = null
    let commandCtx: CommandRuntimeContext | null = null
    mockCommandExecute.mockImplementation(async (_commandId: string, options: { ctx: CommandRuntimeContext }) => {
      ambientInCommand = getAmbientCausation()
      commandCtx = options.ctx
      return { result: { ok: true }, logEntry: null }
    })
    const triggeringRequest = createCausationEnvelope([{ kind: 'user' }])

    await runJobInCausation(EXECUTION_QUEUE, { [CAUSATION_META_KEY]: triggeringRequest }, () =>
      runWorker(buildSchedule(), { triggerType: 'manual', triggeredByUserId: 'user-b' }),
    )

    const expectedFrames = [{ kind: 'user' }, { kind: 'schedule', id: scheduleId }]
    expect(ambientInCommand!.frames).toEqual(expectedFrames)
    expect(ambientInCommand!.correlationId).toBe(triggeringRequest.correlationId)
    expect(primaryCause(ambientInCommand)).toEqual({ kind: 'schedule', id: scheduleId })
    expect(commandCtx!.causation).toEqual(ambientInCommand)
    expect(observedEventCausation.map((entry) => entry.eventId)).toEqual([
      'scheduler.job.started',
      'scheduler.job.completed',
    ])
    for (const entry of observedEventCausation) {
      expect(entry.causation!.frames).toEqual(expectedFrames)
      expect(entry.causation!.correlationId).toBe(triggeringRequest.correlationId)
    }
    expect(getAmbientCausation()).toBeNull()
  })

  it('stacks the schedule frame on the missing-causation entry of a job delivered without an envelope', async () => {
    let ambientInCommand: CausationEnvelope | null = null
    let commandCtx: CommandRuntimeContext | null = null
    mockCommandExecute.mockImplementation(async (_commandId: string, options: { ctx: CommandRuntimeContext }) => {
      ambientInCommand = getAmbientCausation()
      commandCtx = options.ctx
      return { result: { ok: true }, logEntry: null }
    })

    await runJobInCausation(EXECUTION_QUEUE, undefined, () => runWorker(buildSchedule()))

    expect(ambientInCommand!.frames).toEqual([
      { kind: 'unknown', ref: MISSING_CAUSATION_REF },
      { kind: 'schedule', id: scheduleId },
    ])
    expect(primaryCause(ambientInCommand)).toEqual({ kind: 'schedule', id: scheduleId })
    expect(commandCtx!.causation).toEqual(ambientInCommand)
  })

  it('installs no envelope when causation is disabled', async () => {
    process.env.OM_CAUSATION = 'off'
    let ambientInCommand: CausationEnvelope | null | undefined
    let commandCtx: CommandRuntimeContext | null = null
    mockCommandExecute.mockImplementation(async (_commandId: string, options: { ctx: CommandRuntimeContext }) => {
      ambientInCommand = getAmbientCausation()
      commandCtx = options.ctx
      return { result: { ok: true }, logEntry: null }
    })

    await runJobInCausation(EXECUTION_QUEUE, undefined, () => runWorker(buildSchedule()))

    expect(ambientInCommand).toBeNull()
    expect(commandCtx!).not.toHaveProperty('causation')
    expect(observedEventCausation.map((entry) => entry.causation)).toEqual([null, null])
  })

  it('enqueues queue targets from inside the schedule frame', async () => {
    let ambientAtEnqueue: CausationEnvelope | null = null
    const enqueue = jest.fn(async () => {
      ambientAtEnqueue = getAmbientCausation()
      return 'target-job-1'
    })
    const close = jest.fn(async () => undefined)
    ;(createQueue as jest.Mock).mockReturnValue({ enqueue, close })

    await runWorker(
      buildSchedule({
        targetType: 'queue',
        targetQueue: 'causation-example',
        targetCommand: null,
        sourceType: 'module',
        sourceModule: 'causation_test_module',
        createdByUserId: null,
        targetPayload: {},
      }),
    )

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(ambientAtEnqueue!.frames).toEqual([{ kind: 'schedule', id: scheduleId }])
  })

  it('propagates command failures unchanged', async () => {
    const failure = new Error('command blew up')
    mockCommandExecute.mockRejectedValue(failure)

    await expect(runWorker(buildSchedule())).rejects.toBe(failure)
    expect(getAmbientCausation()).toBeNull()
  })

  it('rejects an invalid payload before any frame is opened', async () => {
    await expect(
      executeScheduleWorker(
        { id: 'queued-job-1', payload: {} as never, createdAt: new Date().toISOString() },
        { jobId: 'worker-job-1', attemptNumber: 1, resolve: jest.fn() } as never,
      ),
    ).rejects.toThrow('scheduleId is required in job payload')
    expect(mockCommandExecute).not.toHaveBeenCalled()
  })
})
