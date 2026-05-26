import handler, { POLL_CHANNEL_MAX_ATTEMPTS, metadata, type PollChannelJobPayload } from '../poll-channel'
import type { QueuedJob } from '@open-mercato/queue'

const enqueueMock = jest.fn(async () => 'next-job')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

const emitMock = jest.fn(async () => undefined)
jest.mock('../../events', () => {
  return {
    emitCommunicationChannelsEvent: (...args: unknown[]) => emitMock(...args),
    eventsConfig: { emit: (...args: unknown[]) => emitMock(...args) },
  }
})

describe('poll-channel worker metadata', () => {
  it('targets the poll queue with concurrency 10', () => {
    expect(metadata.queue).toBe('communication-channels-poll')
    expect(metadata.id).toBe('communication_channels:poll-channel')
    expect(metadata.concurrency).toBe(10)
  })

  it('exposes max-attempts constant', () => {
    expect(POLL_CHANNEL_MAX_ATTEMPTS).toBe(3)
  })
})

describe('poll-channel worker behaviour', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
    emitMock.mockClear()
  })

  function makeJob(
    payload: Partial<PollChannelJobPayload> = {},
  ): QueuedJob<PollChannelJobPayload> {
    return {
      id: 'job-1',
      createdAt: new Date().toISOString(),
      payload: {
        channelId: '11111111-1111-1111-1111-111111111111',
        scope: {
          tenantId: '22222222-2222-2222-2222-222222222222',
          organizationId: '33333333-3333-3333-3333-333333333333',
        },
        attempt: 1,
        ...payload,
      },
    }
  }

  function makeCtx(channel: any, adapter: any, fetchHistoryImpl?: () => Promise<any>) {
    const em = {
      findOne: jest.fn(async () => channel),
      flush: jest.fn(async () => undefined),
    }
    const ctx = {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'communication-channels-poll',
      resolve: ((name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'commandBus') return { execute: jest.fn(async () => ({ result: {}, logEntry: null })) }
        if (name === 'integrationCredentialsService') return { resolve: async () => ({}) }
        return null
      }) as <T>(name: string) => T,
    }
    if (adapter && fetchHistoryImpl) {
      adapter.fetchHistory = fetchHistoryImpl
    }
    return { ctx, em }
  }

  it('skips when channel is inactive', async () => {
    const channel = { id: 'c', isActive: false, status: 'connected', providerKey: 'imap' }
    const { ctx } = makeCtx(channel, { fetchHistory: jest.fn() })
    await handler(makeJob(), ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when channel.status !== "connected"', async () => {
    const channel = { id: 'c', isActive: true, status: 'requires_reauth', providerKey: 'imap' }
    const { ctx } = makeCtx(channel, { fetchHistory: jest.fn() })
    await handler(makeJob(), ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when adapter has no fetchHistory', async () => {
    const channel = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'imap',
      capabilities: { realtimePush: false },
    }
    const { ctx } = makeCtx(channel, { providerKey: 'imap' }) // no fetchHistory
    await handler(makeJob(), ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips push-only providers (realtimePush !== false)', async () => {
    const channel = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'slack',
      capabilities: { realtimePush: true },
    }
    const { ctx } = makeCtx(channel, { providerKey: 'slack', fetchHistory: jest.fn() })
    await handler(makeJob(), ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('marks channel requires_reauth + emits event on 401 error', async () => {
    const channel = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'gmail',
      channelType: 'email',
      capabilities: { realtimePush: false },
      lastError: null,
    }
    const err = new Error('Unauthorized') as Error & { status?: number }
    err.status = 401
    const { ctx } = makeCtx(channel, { providerKey: 'gmail' }, async () => {
      throw err
    })
    await handler(makeJob(), ctx)
    expect(channel.status).toBe('requires_reauth')
    expect(channel.lastError).toBe('Unauthorized')
    expect(emitMock).toHaveBeenCalledWith(
      'communication_channels.channel.requires_reauth',
      expect.objectContaining({ channelId: 'c' }),
      expect.objectContaining({ persistent: true }),
    )
  })

  it('re-enqueues on transient failure when attempts remain', async () => {
    const channel = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'imap',
      capabilities: { realtimePush: false },
      lastError: null,
    }
    const err = new Error('connect ETIMEDOUT')
    const { ctx } = makeCtx(channel, { providerKey: 'imap' }, async () => {
      throw err
    })
    await handler(makeJob({ attempt: 1 }), ctx)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [payload, options] = enqueueMock.mock.calls[0]
    expect((payload as PollChannelJobPayload).attempt).toBe(2)
    expect((options as { delayMs: number })?.delayMs).toBeGreaterThan(0)
    // Status stays 'connected' so the scheduler keeps it in rotation.
    expect(channel.status).toBe('connected')
  })

  it('marks channel status=error on permanent failure', async () => {
    const channel = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'imap',
      capabilities: { realtimePush: false },
      lastError: null,
    }
    const err = new Error('Invalid configuration') as Error & { status?: number }
    err.status = 422
    const { ctx } = makeCtx(channel, { providerKey: 'imap' }, async () => {
      throw err
    })
    await handler(makeJob({ attempt: 1 }), ctx)
    expect(channel.status).toBe('error')
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('updates lastPolledAt + clears lastError on a successful poll', async () => {
    const beforePoll = new Date(Date.now() - 60 * 1000)
    const channel: any = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'imap',
      channelType: 'email',
      capabilities: { realtimePush: false },
      lastPolledAt: beforePoll,
      lastError: 'previous error',
    }
    const { ctx } = makeCtx(channel, { providerKey: 'imap' }, async () => ({
      messages: [], // no inbound messages this tick
    }))
    await handler(makeJob(), ctx)
    expect(channel.lastError).toBeNull()
    expect(channel.lastPolledAt?.getTime() ?? 0).toBeGreaterThan(beforePoll.getTime())
  })
})
