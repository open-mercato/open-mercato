import handler, { POLL_CHANNEL_MAX_ATTEMPTS, metadata, type PollChannelJobPayload } from '../poll-channel'
import type { QueuedJob } from '@open-mercato/queue'
import { ChannelIngestDeadLetter } from '../../data/entities'

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

  function makeCtx(
    channel: any,
    adapter: any,
    fetchHistoryImpl?: () => Promise<any>,
    ingestExecuteImpl?: (...args: any[]) => Promise<any>,
    deadLetterLookup: jest.Mock = jest.fn(async () => null),
  ) {
    const em = {
      // The channel load resolves to `channel`; the dead-letter dedup pre-check
      // (writeIngestDeadLetter → em.findOne(ChannelIngestDeadLetter, ...)) uses
      // the injectable `deadLetterLookup` (defaults to "no existing row").
      findOne: jest.fn(async (entity: unknown) =>
        entity === ChannelIngestDeadLetter ? deadLetterLookup() : channel,
      ),
      flush: jest.fn(async () => undefined),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      persist: jest.fn(),
    }
    const ctx = {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'communication-channels-poll',
      resolve: ((name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'commandBus')
          return { execute: ingestExecuteImpl ?? jest.fn(async () => ({ result: {}, logEntry: null })) }
        if (name === 'integrationCredentialsService') return { resolve: async () => ({}) }
        return null
      }) as <T>(name: string) => T,
    }
    if (adapter && fetchHistoryImpl) {
      adapter.fetchHistory = fetchHistoryImpl
    }
    return { ctx, em, deadLetterLookup }
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

  // TC-CHANNEL-EMAIL-028 — a permanently-unprocessable message must not stall
  // the channel: it lands in the dead-letter table and the cursor advances.
  it('writes a dead-letter and advances the cursor on a PERMANENT ingest failure', async () => {
    const beforePoll = new Date(Date.now() - 60 * 1000)
    const channel: any = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'imap',
      channelType: 'email',
      capabilities: { realtimePush: false },
      lastError: null,
      lastPolledAt: beforePoll,
      channelState: null,
    }
    // No transient code/status → classified permanent → dead-letter.
    const ingestExecute = jest.fn(async () => {
      throw new Error('malformed MIME body')
    })
    const { ctx, em } = makeCtx(
      channel,
      { providerKey: 'imap' },
      async () => ({
        messages: [{ externalMessageId: 'ext-1', body: 'x', subject: 's' }],
        nextCursor: undefined,
        hasMore: false,
      }),
      ingestExecute,
    )
    await handler(makeJob(), ctx)
    expect(em.create).toHaveBeenCalledWith(
      ChannelIngestDeadLetter,
      expect.objectContaining({
        channelId: 'c',
        externalMessageId: 'ext-1',
        errorMessage: expect.stringContaining('malformed MIME'),
      }),
    )
    expect(em.persist).toHaveBeenCalled()
    // Cursor advanced (not stalled): status stays connected, no retry enqueue,
    // lastPolledAt moved forward past the bad message.
    expect(channel.status).toBe('connected')
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(channel.lastPolledAt?.getTime() ?? 0).toBeGreaterThan(beforePoll.getTime())
  })

  // FINDING 2 regression — a replayed page that permanently fails the SAME
  // (channelId, externalMessageId) must not insert a duplicate dead-letter row.
  // writeIngestDeadLetter checks for an existing row first and no-ops if found.
  it('does NOT insert a duplicate dead-letter for the same (channelId, externalMessageId) on replay', async () => {
    const beforePoll = new Date(Date.now() - 60 * 1000)
    const channel: any = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'imap',
      channelType: 'email',
      capabilities: { realtimePush: false },
      lastError: null,
      lastPolledAt: beforePoll,
      channelState: null,
    }
    const ingestExecute = jest.fn(async () => {
      throw new Error('malformed MIME body')
    })
    // Dedup pre-check reports the row already exists (written by a prior poll).
    const deadLetterLookup = jest.fn(async () => ({ id: 'dead-1', externalMessageId: 'ext-1' }))
    const { ctx, em } = makeCtx(
      channel,
      { providerKey: 'imap' },
      async () => ({
        messages: [{ externalMessageId: 'ext-1', body: 'x', subject: 's' }],
        nextCursor: undefined,
        hasMore: false,
      }),
      ingestExecute,
      deadLetterLookup,
    )
    await handler(makeJob(), ctx)
    // The existence check ran; no second dead-letter row was created/persisted.
    expect(deadLetterLookup).toHaveBeenCalledTimes(1)
    expect(em.create).not.toHaveBeenCalledWith(ChannelIngestDeadLetter, expect.anything())
    // Cursor still advances so the poison message does not stall the channel.
    expect(channel.status).toBe('connected')
    expect(channel.lastPolledAt?.getTime() ?? 0).toBeGreaterThan(beforePoll.getTime())
  })

  it('aborts WITHOUT advancing the cursor on a TRANSIENT ingest failure (no dead-letter)', async () => {
    const beforePoll = new Date(Date.now() - 60 * 1000)
    const channel: any = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'imap',
      channelType: 'email',
      capabilities: { realtimePush: false },
      lastError: null,
      lastPolledAt: beforePoll,
      channelState: null,
    }
    const ingestExecute = jest.fn(async () => {
      throw new Error('read ECONNRESET')
    })
    // A concrete cursor that a SUCCESSFUL poll would persist — proving the abort
    // path holds BOTH lastPolledAt and channelState, not just lastPolledAt.
    const advancedCursor = Buffer.from(JSON.stringify({ uidNext: 999 })).toString('base64')
    const { ctx, em } = makeCtx(
      channel,
      { providerKey: 'imap' },
      async () => ({
        messages: [{ externalMessageId: 'ext-1', body: 'x', subject: 's' }],
        nextCursor: advancedCursor,
        hasMore: false,
      }),
      ingestExecute,
    )
    await handler(makeJob(), ctx)
    expect(em.create).not.toHaveBeenCalled()
    expect(channel.lastError).toBe('transient_ingest_failure')
    // Cursor held so the next tick re-fetches (idempotent at the DB layer): both
    // lastPolledAt and the channelState cursor stay at their pre-poll values.
    expect(channel.lastPolledAt).toBe(beforePoll)
    expect(channel.channelState).toBeNull()
  })

  // F7 regression — a transient Postgres error (deadlock / serialization) during
  // ingest MUST classify as transient so the loop aborts WITHOUT advancing the
  // cursor. Treating it as permanent would dead-letter the message and advance
  // the cursor, silently losing inbound mail.
  it('treats a Postgres deadlock during ingest as transient (no dead-letter, cursor held)', async () => {
    const beforePoll = new Date(Date.now() - 60 * 1000)
    const channel: any = {
      id: 'c',
      isActive: true,
      status: 'connected',
      providerKey: 'imap',
      channelType: 'email',
      capabilities: { realtimePush: false },
      lastError: null,
      lastPolledAt: beforePoll,
      channelState: null,
    }
    const ingestExecute = jest.fn(async () => {
      const err = new Error('deadlock detected') as Error & { code?: string }
      err.code = '40P01'
      throw err
    })
    const advancedCursor = Buffer.from(JSON.stringify({ uidNext: 999 })).toString('base64')
    const { ctx, em } = makeCtx(
      channel,
      { providerKey: 'imap' },
      async () => ({
        messages: [{ externalMessageId: 'ext-1', body: 'x', subject: 's' }],
        nextCursor: advancedCursor,
        hasMore: false,
      }),
      ingestExecute,
    )
    await handler(makeJob(), ctx)
    // NOT dead-lettered, and the cursor is held (no mail loss).
    expect(em.create).not.toHaveBeenCalled()
    expect(channel.lastError).toBe('transient_ingest_failure')
    expect(channel.lastPolledAt).toBe(beforePoll)
    expect(channel.channelState).toBeNull()
  })
})
