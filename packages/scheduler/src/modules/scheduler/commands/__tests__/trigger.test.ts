export {}

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const enqueue = jest.fn()
const close = jest.fn()
const createQueue = jest.fn(() => ({ enqueue, close }))

// The bare `@open-mercato/queue` specifier is not resolvable under this package's
// jest moduleNameMapper (only its subpaths are), matching how the scheduler worker
// test mocks it.
jest.mock('@open-mercato/queue', () => ({ createQueue }), { virtual: true })

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn(() => 'redis://localhost:6379'),
}))

const SCHEDULE_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'

function loadTriggerCommand() {
  let trigger: any
  jest.isolateModules(() => {
    require('../trigger')
    trigger = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'scheduler.jobs.trigger')?.[0]
  })
  return trigger
}

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    name: 'Nightly report',
    scopeType: 'tenant',
    tenantId: 'tenant-a',
    organizationId: null,
    targetType: 'queue',
    targetQueue: 'reports',
    targetCommand: null,
    ...overrides,
  }
}

function makeEm(schedule: Record<string, unknown> | null) {
  return {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue(schedule),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

function makeCtx(auth: Record<string, unknown> | null, em: any) {
  return {
    auth,
    container: { resolve: jest.fn(() => em) },
    selectedOrganizationId: null,
  } as any
}

const tenantActor = { sub: ACTOR_ID, userId: ACTOR_ID, tenantId: 'tenant-a', orgId: null, isSuperAdmin: false }

describe('scheduler.jobs.trigger', () => {
  const previousStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env.QUEUE_STRATEGY = 'async'
    enqueue.mockResolvedValue('queue-job-1')
    close.mockResolvedValue(undefined)
  })

  afterAll(() => {
    if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = previousStrategy
  })

  it('is not undoable, so a manual trigger mints no undo token', () => {
    const trigger = loadTriggerCommand()
    expect(trigger).toBeDefined()
    expect(trigger.isUndoable).toBe(false)
    expect(trigger.undo).toBeUndefined()
    expect(trigger.redo).toBeUndefined()
  })

  it('enqueues the execution job and reports the queue job id', async () => {
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule())
    const ctx = makeCtx(tenantActor, em)

    const result = await trigger.execute({ id: SCHEDULE_ID }, ctx)

    expect(result).toMatchObject({
      scheduleId: SCHEDULE_ID,
      scheduleName: 'Nightly report',
      targetType: 'queue',
      target: 'reports',
      outcome: 'enqueued',
      queueJobId: 'queue-job-1',
      error: null,
    })
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: SCHEDULE_ID,
        triggerType: 'manual',
        triggeredByUserId: ACTOR_ID,
      }),
    )
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('reports a command schedule target by its command id', async () => {
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule({ targetType: 'command', targetQueue: null, targetCommand: 'scheduler.test.echo' }))

    const result = await trigger.execute({ id: SCHEDULE_ID }, makeCtx(tenantActor, em))

    expect(result).toMatchObject({ targetType: 'command', target: 'scheduler.test.echo', outcome: 'enqueued' })
  })

  it('leaves triggeredByUserId null for an API-key caller so the run keeps acting as the creator', async () => {
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule())
    const ctx = makeCtx({ sub: 'api-key-1', tenantId: 'tenant-a', orgId: null, isApiKey: true }, em)

    await trigger.execute({ id: SCHEDULE_ID }, ctx)

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ triggeredByUserId: null }))
  })

  it('returns not_found for a missing schedule without throwing', async () => {
    const trigger = loadTriggerCommand()
    const em = makeEm(null)

    const result = await trigger.execute({ id: SCHEDULE_ID }, makeCtx(tenantActor, em))

    expect(result.outcome).toBe('not_found')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('returns not_found for another tenant schedule, never confirming the id exists', async () => {
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule({ tenantId: 'tenant-b' }))

    const result = await trigger.execute({ id: SCHEDULE_ID }, makeCtx(tenantActor, em))

    expect(result.outcome).toBe('not_found')
    expect(result.scheduleName).toBeNull()
    expect(result.target).toBeNull()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('returns forbidden for a system-scoped schedule without super-admin', async () => {
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule({ scopeType: 'system', tenantId: null }))

    const result = await trigger.execute({ id: SCHEDULE_ID }, makeCtx(tenantActor, em))

    expect(result.outcome).toBe('forbidden')
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('allows a super admin to trigger a system-scoped schedule', async () => {
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule({ scopeType: 'system', tenantId: null }))
    const ctx = makeCtx({ ...tenantActor, isSuperAdmin: true }, em)

    const result = await trigger.execute({ id: SCHEDULE_ID }, ctx)

    expect(result.outcome).toBe('enqueued')
  })

  it('returns strategy_unsupported when the queue strategy is not async', async () => {
    delete process.env.QUEUE_STRATEGY
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule())

    const result = await trigger.execute({ id: SCHEDULE_ID }, makeCtx(tenantActor, em))

    expect(result).toMatchObject({ outcome: 'strategy_unsupported', queueJobId: null, error: null })
    // Access was granted, so the schedule's details are safe to record.
    expect(result.scheduleName).toBe('Nightly report')
    expect(createQueue).not.toHaveBeenCalled()
  })

  it('returns failed and still closes the queue when the enqueue rejects', async () => {
    enqueue.mockRejectedValue(new Error('redis unavailable'))
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule())

    const result = await trigger.execute({ id: SCHEDULE_ID }, makeCtx(tenantActor, em))

    expect(result).toMatchObject({ outcome: 'failed', queueJobId: null, error: 'redis unavailable' })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not fail a completed enqueue when closing the queue throws', async () => {
    close.mockRejectedValue(new Error('close failed'))
    const trigger = loadTriggerCommand()
    const em = makeEm(makeSchedule())

    const result = await trigger.execute({ id: SCHEDULE_ID }, makeCtx(tenantActor, em))

    expect(result.outcome).toBe('enqueued')
  })

  describe('buildLog', () => {
    it('records a successful trigger against the actor', async () => {
      const trigger = loadTriggerCommand()
      const ctx = makeCtx({ ...tenantActor, orgId: 'org-a' }, makeEm(makeSchedule()))
      const result = {
        scheduleId: SCHEDULE_ID,
        scheduleName: 'Nightly report',
        targetType: 'queue',
        target: 'reports',
        outcome: 'enqueued',
        queueJobId: 'queue-job-1',
        error: null,
      }

      const log = await trigger.buildLog({ input: { id: SCHEDULE_ID }, result, ctx, snapshots: {} })

      expect(log).toMatchObject({
        actionLabel: 'Trigger schedule',
        resourceKind: 'scheduler.job',
        resourceId: SCHEDULE_ID,
        tenantId: 'tenant-a',
        organizationId: 'org-a',
      })
      expect(log.payload).toEqual({
        scheduleName: 'Nightly report',
        targetType: 'queue',
        target: 'reports',
        outcome: 'enqueued',
        queueJobId: 'queue-job-1',
        error: null,
      })
    })

    it('records a refusal against the actor and discloses nothing about the row', async () => {
      const trigger = loadTriggerCommand()
      const ctx = makeCtx(tenantActor, makeEm(null))
      const result = {
        scheduleId: SCHEDULE_ID,
        scheduleName: null,
        targetType: null,
        target: null,
        outcome: 'not_found',
        queueJobId: null,
        error: null,
      }

      const log = await trigger.buildLog({ input: { id: SCHEDULE_ID }, result, ctx, snapshots: {} })

      // The requested id is recorded so that probing is traceable...
      expect(log.resourceId).toBe(SCHEDULE_ID)
      // ...but the scope is the caller's, never the target's, and no detail of the
      // row leaks into a trail the caller can read.
      expect(log.tenantId).toBe('tenant-a')
      expect(log.payload).toMatchObject({ outcome: 'not_found', scheduleName: null, target: null })
    })

    it('always returns metadata, so no outcome can silently skip the audit row', async () => {
      const trigger = loadTriggerCommand()
      const ctx = makeCtx(tenantActor, makeEm(null))
      const outcomes = ['enqueued', 'not_found', 'forbidden', 'strategy_unsupported', 'failed']

      for (const outcome of outcomes) {
        const log = await trigger.buildLog({
          input: { id: SCHEDULE_ID },
          result: { scheduleId: SCHEDULE_ID, scheduleName: null, targetType: null, target: null, outcome, queueJobId: null, error: null },
          ctx,
          snapshots: {},
        })
        expect(log?.skipLog).toBeUndefined()
        expect(log?.resourceKind).toBe('scheduler.job')
      }
    })
  })
})
