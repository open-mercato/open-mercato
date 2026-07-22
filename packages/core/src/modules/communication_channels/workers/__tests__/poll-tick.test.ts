import handler, { metadata, type PollTickPayload } from '../poll-tick'
import type { QueuedJob } from '@open-mercato/queue'

const enqueueMock = jest.fn(async () => 'next-job')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

describe('poll-tick worker metadata', () => {
  it('targets the poll-tick queue with concurrency 1 (single-flight)', () => {
    expect(metadata.queue).toBe('communication-channels-poll-tick')
    expect(metadata.id).toBe('communication_channels:poll-tick')
    expect(metadata.concurrency).toBe(1)
  })
})

describe('poll-tick worker enumeration', () => {
  beforeEach(() => enqueueMock.mockClear())

  function makeJob(): QueuedJob<PollTickPayload> {
    return {
      id: 'tick-1',
      createdAt: new Date().toISOString(),
      payload: {
        scope: {
          tenantId: '22222222-2222-2222-2222-222222222222',
          organizationId: '33333333-3333-3333-3333-333333333333',
        },
      },
    }
  }

  /**
   * Build a ctx whose `em.find` returns `connectedChannels` on the first
   * call (the status='connected' enumeration) and `errorChannels` on the
   * second call (the Spec B § auto-recovery sweep for status='error').
   * Defaults to empty for the error pool.
   */
  function makeCtx(connectedChannels: any[], errorChannels: any[] = []) {
    let callCount = 0
    const em = {
      find: jest.fn(async () => {
        const result = callCount === 0 ? connectedChannels : errorChannels
        callCount += 1
        return result
      }),
      flush: jest.fn(async () => undefined),
    }
    return {
      jobId: 'tick-1',
      attemptNumber: 1,
      queueName: 'communication-channels-poll-tick',
      resolve: ((name: string) => {
        if (name === 'em') return { fork: () => em }
        return null
      }) as <T>(name: string) => T,
    }
  }

  /**
   * Build a ctx whose `em.find` faithfully honours the auto-recovery predicate
   * (status='error' AND (lastPolledAt IS NULL OR lastPolledAt < recoverCutoff)),
   * so recovery tests actually exercise the filter instead of passing vacuously.
   */
  function makeRecoveryCtx(errorChannels: any[]) {
    const em = {
      find: jest.fn(async (_entity: unknown, where: any) => {
        if (where?.status === 'connected') return []
        if (where?.status !== 'error') return []
        const orClauses: any[] = Array.isArray(where?.$or) ? where.$or : []
        const allowsNull = orClauses.some((clause) => clause?.lastPolledAt === null)
        const cutoff: Date | undefined = orClauses
          .map((clause) => clause?.lastPolledAt?.$lt)
          .find((value): value is Date => value instanceof Date)
        return errorChannels.filter(
          (channel) =>
            (channel.lastPolledAt == null && allowsNull) ||
            (cutoff != null && channel.lastPolledAt != null && channel.lastPolledAt < cutoff),
        )
      }),
      flush: jest.fn(async () => undefined),
    }
    return {
      jobId: 'tick-1',
      attemptNumber: 1,
      queueName: 'communication-channels-poll-tick',
      resolve: ((name: string) => {
        if (name === 'em') return { fork: () => em }
        return null
      }) as <T>(name: string) => T,
    }
  }

  it('enqueues a job for each due channel', async () => {
    const now = Date.now()
    const channels = [
      // Due — last polled 5 minutes ago, interval 60s.
      {
        id: 'c1',
        pollIntervalSeconds: 60,
        lastPolledAt: new Date(now - 5 * 60 * 1000),
        tenantId: 't',
        organizationId: 'o',
      },
      // Due — never polled.
      {
        id: 'c2',
        pollIntervalSeconds: 60,
        lastPolledAt: null,
        tenantId: 't',
        organizationId: 'o',
      },
    ]
    await handler(makeJob(), makeCtx(channels))
    expect(enqueueMock).toHaveBeenCalledTimes(2)
  })

  it('skips channels not yet due', async () => {
    const now = Date.now()
    const channels = [
      // Polled 5s ago with 60s interval — not yet due.
      {
        id: 'c1',
        pollIntervalSeconds: 60,
        lastPolledAt: new Date(now - 5 * 1000),
        tenantId: 't',
      },
    ]
    await handler(makeJob(), makeCtx(channels))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips channels with null or zero poll interval (push-only)', async () => {
    const channels = [
      { id: 'c1', pollIntervalSeconds: null, lastPolledAt: null, tenantId: 't' },
      { id: 'c2', pollIntervalSeconds: 0, lastPolledAt: null, tenantId: 't' },
    ]
    await handler(makeJob(), makeCtx(channels))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // Spec B § Auto-recovery sweep — channels in `status='error'` whose last poll
  // attempt (`lastPolledAt`) is older than `OM_CHANNEL_AUTO_RECOVER_MINUTES`
  // (default 30 min) get one retry per tick. On success, `poll-channel` flips
  // them back to 'connected' so the operator doesn't have to manually reconnect.
  it('auto-recovers status="error" channels whose lastPolledAt is past the cutoff', async () => {
    const now = Date.now()
    const errorChannels = [
      {
        id: 'c-err',
        pollIntervalSeconds: 60,
        lastPolledAt: new Date(now - 45 * 60 * 1000), // 45 min ago > 30 min cutoff
        status: 'error',
        tenantId: 't',
        organizationId: 'o',
      },
    ]
    await handler(makeJob(), makeRecoveryCtx(errorChannels))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({ channelId: 'c-err' })
  })

  it('does NOT recover a status="error" channel polled within the cutoff window', async () => {
    const errorChannels = [
      {
        id: 'c-err-recent',
        pollIntervalSeconds: 60,
        lastPolledAt: new Date(Date.now() - 60 * 1000), // 1 min ago < 30 min cutoff
        status: 'error',
        tenantId: 't',
        organizationId: 'o',
      },
    ]
    await handler(makeJob(), makeRecoveryCtx(errorChannels))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // Regression: a channel that fails its FIRST poll has `lastPolledAt = null`.
  // A bare `$lt` would exclude it forever; the sweep must still recover it.
  it('auto-recovers a status="error" channel that never polled (lastPolledAt null)', async () => {
    const errorChannels = [
      {
        id: 'c-fresh-err',
        pollIntervalSeconds: 60,
        lastPolledAt: null,
        status: 'error',
        tenantId: 't',
        organizationId: 'o',
      },
    ]
    await handler(makeJob(), makeRecoveryCtx(errorChannels))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({ channelId: 'c-fresh-err' })
  })

  // Regression: OM_CHANNEL_AUTO_RECOVER_MINUTES=0 means "recover on the next
  // tick" (used by TC-CHANNEL-EMAIL-027). The old `> 0` guard coerced 0 → 30 min.
  it('recovers immediately when OM_CHANNEL_AUTO_RECOVER_MINUTES=0', async () => {
    const previous = process.env.OM_CHANNEL_AUTO_RECOVER_MINUTES
    process.env.OM_CHANNEL_AUTO_RECOVER_MINUTES = '0'
    try {
      const errorChannels = [
        {
          id: 'c-err-recent',
          pollIntervalSeconds: 60,
          // 1 min ago: inside the 30-min default window, but with cutoff=now it qualifies.
          lastPolledAt: new Date(Date.now() - 60 * 1000),
          status: 'error',
          tenantId: 't',
          organizationId: 'o',
        },
      ]
      await handler(makeJob(), makeRecoveryCtx(errorChannels))
      expect(enqueueMock).toHaveBeenCalledTimes(1)
    } finally {
      if (previous === undefined) delete process.env.OM_CHANNEL_AUTO_RECOVER_MINUTES
      else process.env.OM_CHANNEL_AUTO_RECOVER_MINUTES = previous
    }
  })

  it('does not throw when no channels are due (no-op tick)', async () => {
    await expect(handler(makeJob(), makeCtx([]))).resolves.toBeUndefined()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // FINDING 1 regression — a persistently-failing error channel must be retried
  // at most once per recovery window. poll-channel leaves `lastPolledAt`
  // untouched on failure, so the tick bumps it to `now` as it enqueues the
  // recovery job; the channel then falls back under `recoverCutoff` and is NOT
  // re-selected on the immediately-following tick until the window elapses.
  it('retries an error channel once then backs off on the next tick (no re-enqueue every tick)', async () => {
    // A single shared channel object so a `lastPolledAt` bump in tick 1 is
    // visible to tick 2. The error-pool `find` honours the `recoverCutoff`
    // ($lt on lastPolledAt) the handler passes — faithfully simulating the DB
    // filter so the bump actually backs the channel off.
    const channel = {
      id: 'c-err',
      pollIntervalSeconds: 60,
      lastPolledAt: new Date(Date.now() - 60 * 60 * 1000), // 60 min ago > 30 min cutoff
      status: 'error',
      tenantId: 't',
      organizationId: 'o',
    }
    const em = {
      find: jest.fn(async (_entity: unknown, where: any) => {
        // Pool (1): status='connected' — none here.
        if (where?.status === 'connected') return []
        // Pool (2): status='error' AND (lastPolledAt IS NULL OR lastPolledAt < recoverCutoff).
        const orClauses: any[] = Array.isArray(where?.$or) ? where.$or : []
        const cutoff: Date | undefined = orClauses
          .map((clause) => clause?.lastPolledAt?.$lt)
          .find((value): value is Date => value instanceof Date)
        const matches =
          channel.lastPolledAt == null || (cutoff != null && channel.lastPolledAt < cutoff)
        return matches ? [channel] : []
      }),
      flush: jest.fn(async () => undefined),
    }
    const ctx = {
      jobId: 'tick-1',
      attemptNumber: 1,
      queueName: 'communication-channels-poll-tick',
      resolve: ((name: string) => {
        if (name === 'em') return { fork: () => em }
        return null
      }) as <T>(name: string) => T,
    }

    // Tick 1: channel is stale → recovery job enqueued + `lastPolledAt` bumped.
    await handler(makeJob(), ctx)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock.mock.calls[0][0]).toMatchObject({ channelId: 'c-err' })

    // Tick 2 (immediately after): the bump put `lastPolledAt` ~now, so the
    // channel is no longer past the cutoff → NOT re-enqueued.
    enqueueMock.mockClear()
    await handler(makeJob(), ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
