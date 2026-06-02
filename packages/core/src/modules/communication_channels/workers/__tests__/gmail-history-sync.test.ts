import handler, { metadata, type GmailHistorySyncJobPayload } from '../gmail-history-sync'
import type { QueuedJob } from '@open-mercato/queue'
import { CommunicationChannel, ChannelIngestDeadLetter } from '../../data/entities'
import { PUSH_STATE_KEYS } from '../../lib/push-state'

const enqueueMock = jest.fn(async () => 'next-job')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

describe('gmail-history-sync worker metadata', () => {
  it('targets the gmail-history-sync queue with concurrency 5', () => {
    expect(metadata.queue).toBe('communication-channels-gmail-history-sync')
    expect(metadata.id).toBe('communication_channels:gmail-history-sync')
    expect(metadata.concurrency).toBe(5)
  })
})

describe('gmail-history-sync worker behaviour', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
  })

  function makeJob(
    payload: Partial<GmailHistorySyncJobPayload> = {},
  ): QueuedJob<GmailHistorySyncJobPayload> {
    return {
      id: 'job-1',
      createdAt: new Date().toISOString(),
      payload: {
        channelId: '11111111-1111-1111-1111-111111111111',
        scope: {
          tenantId: '22222222-2222-2222-2222-222222222222',
          organizationId: '33333333-3333-3333-3333-333333333333',
        },
        notification: { emailAddress: 'inbox@example.com', historyId: '4242' },
        ...payload,
      },
    }
  }

  /**
   * Builds the job context. The channel load (findOneWithDecryption →
   * em.findOne(CommunicationChannel, ...)) resolves to `channel`; the
   * dead-letter dedup pre-check (writeIngestDeadLetter → em.findOne(
   * ChannelIngestDeadLetter, ...)) uses the injectable `deadLetterLookup`
   * (defaults to "no existing row"). Same dispatch-by-entity convention as
   * poll-channel.test.ts.
   */
  function makeCtx(
    channel: any,
    adapter: any,
    ingestExecuteImpl?: (...args: any[]) => Promise<any>,
    deadLetterLookup: jest.Mock = jest.fn(async () => null),
  ) {
    const em = {
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
      queueName: 'communication-channels-gmail-history-sync',
      resolve: ((name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'channelAdapterRegistry') return { get: () => adapter }
        if (name === 'commandBus')
          return { execute: ingestExecuteImpl ?? jest.fn(async () => ({ result: {}, logEntry: null })) }
        if (name === 'integrationCredentialsService') return { resolve: async () => ({}) }
        return null
      }) as <T>(name: string) => T,
    }
    return { ctx, em, deadLetterLookup }
  }

  function baseChannel(overrides: Record<string, unknown> = {}) {
    return {
      id: '11111111-1111-1111-1111-111111111111',
      isActive: true,
      status: 'connected',
      providerKey: 'gmail',
      channelType: 'email',
      userId: null,
      credentialsRef: null,
      channelState: {},
      lastPolledAt: null,
      ...overrides,
    }
  }

  // (a) early-returns when the channel is missing.
  it('skips when channel is not found', async () => {
    const applyPushNotification = jest.fn()
    const { ctx } = makeCtx(null, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob(), ctx)
    expect(applyPushNotification).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (a) early-returns when the channel is inactive.
  it('skips when channel is inactive', async () => {
    const applyPushNotification = jest.fn()
    const channel = baseChannel({ isActive: false })
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob(), ctx)
    expect(applyPushNotification).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (a) early-returns when status !== 'connected'.
  it('skips when channel.status !== "connected"', async () => {
    const applyPushNotification = jest.fn()
    const channel = baseChannel({ status: 'requires_reauth' })
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob(), ctx)
    expect(applyPushNotification).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (a) early-returns when the adapter does not implement applyPushNotification.
  it('skips when adapter does not support applyPushNotification', async () => {
    const channel = baseChannel()
    const { ctx } = makeCtx(channel, { providerKey: 'gmail' }) // no applyPushNotification
    await handler(makeJob(), ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (b) a transient failure from applyPushNotification RE-THROWS so the queue retries.
  it('re-throws a transient applyPushNotification failure (queue retries)', async () => {
    const channel = baseChannel()
    const err = new Error('connect ETIMEDOUT')
    const applyPushNotification = jest.fn(async () => {
      throw err
    })
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await expect(handler(makeJob(), ctx)).rejects.toBe(err)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (b inverse) a PERMANENT applyPushNotification failure is swallowed (no throw, no re-enqueue).
  it('swallows a permanent applyPushNotification failure without throwing', async () => {
    const channel = baseChannel()
    const err = new Error('Forbidden') as Error & { status?: number }
    err.status = 403
    const applyPushNotification = jest.fn(async () => {
      throw err
    })
    const { ctx, em } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await expect(handler(makeJob(), ctx)).resolves.toBeUndefined()
    expect(enqueueMock).not.toHaveBeenCalled()
    // Permanent push failure returns before any cursor persistence.
    expect(em.flush).not.toHaveBeenCalled()
  })

  // (b, per-message) a transient ingest failure RE-THROWS so the queue retries the job.
  it('re-throws a transient ingest failure (queue retries from a safe point)', async () => {
    const channel = baseChannel()
    const applyPushNotification = jest.fn(async () => ({
      messages: [{ externalMessageId: 'ext-1', body: 'x', subject: 's' }],
      nextCursor: undefined,
      hasMore: false,
    }))
    const ingestExecute = jest.fn(async () => {
      throw new Error('read ECONNRESET')
    })
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification }, ingestExecute)
    await expect(handler(makeJob(), ctx)).rejects.toThrow(/ECONNRESET/)
  })

  // (c) a PERMANENT parse/ingest failure for a single message routes to the
  // dead-letter table rather than throwing the whole job.
  it('writes a dead-letter on a permanent ingest failure (does not throw)', async () => {
    const channel = baseChannel()
    const applyPushNotification = jest.fn(async () => ({
      messages: [{ externalMessageId: 'ext-1', body: 'x', subject: 's' }],
      nextCursor: undefined,
      hasMore: false,
    }))
    // No transient code/status → classified permanent → dead-letter.
    const ingestExecute = jest.fn(async () => {
      throw new Error('malformed MIME body')
    })
    const { ctx, em } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification }, ingestExecute)
    await expect(handler(makeJob(), ctx)).resolves.toBeUndefined()
    expect(em.create).toHaveBeenCalledWith(
      ChannelIngestDeadLetter,
      expect.objectContaining({
        channelId: '11111111-1111-1111-1111-111111111111',
        externalMessageId: 'ext-1',
        errorMessage: expect.stringContaining('malformed MIME'),
      }),
    )
    expect(em.persist).toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (f) idempotency: a duplicate inbound that permanently fails the SAME
  // (channelId, externalMessageId) does not create a second dead-letter row.
  it('does NOT insert a duplicate dead-letter for the same (channelId, externalMessageId) on replay', async () => {
    const channel = baseChannel()
    const applyPushNotification = jest.fn(async () => ({
      messages: [{ externalMessageId: 'ext-1', body: 'x', subject: 's' }],
      nextCursor: undefined,
      hasMore: false,
    }))
    const ingestExecute = jest.fn(async () => {
      throw new Error('malformed MIME body')
    })
    const deadLetterLookup = jest.fn(async () => ({ id: 'dead-1', externalMessageId: 'ext-1' }))
    const { ctx, em } = makeCtx(
      channel,
      { providerKey: 'gmail', applyPushNotification },
      ingestExecute,
      deadLetterLookup,
    )
    await expect(handler(makeJob(), ctx)).resolves.toBeUndefined()
    expect(deadLetterLookup).toHaveBeenCalledTimes(1)
    expect(em.create).not.toHaveBeenCalledWith(ChannelIngestDeadLetter, expect.anything())
  })

  // (f) idempotency at the ingest layer: a duplicate inbound reported by the
  // command does NOT throw and does NOT dead-letter (the command no-ops).
  it('treats a command-reported duplicate as a no-op (no throw, no dead-letter)', async () => {
    const channel = baseChannel()
    const applyPushNotification = jest.fn(async () => ({
      messages: [{ externalMessageId: 'ext-1', body: 'x', subject: 's' }],
      nextCursor: undefined,
      hasMore: false,
    }))
    const ingestExecute = jest.fn(async () => ({ result: { status: 'duplicate' as const }, logEntry: null }))
    const { ctx, em } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification }, ingestExecute)
    await expect(handler(makeJob(), ctx)).resolves.toBeUndefined()
    expect(ingestExecute).toHaveBeenCalledTimes(1)
    expect(em.create).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // Happy path: dispatches each message through the ingest command with the
  // canonical command id and the correct per-message input.
  it('dispatches each message through the ingest command', async () => {
    const channel = baseChannel()
    const applyPushNotification = jest.fn(async () => ({
      messages: [
        { externalMessageId: 'ext-1', body: 'a', subject: 's1' },
        { externalMessageId: 'ext-2', body: 'b', subject: 's2' },
      ],
      nextCursor: undefined,
      hasMore: false,
    }))
    const ingestExecute = jest.fn(async () => ({ result: { status: 'created' as const }, logEntry: null }))
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification }, ingestExecute)
    await handler(makeJob(), ctx)
    expect(ingestExecute).toHaveBeenCalledTimes(2)
    expect(ingestExecute.mock.calls[0][0]).toBe('communication_channels.message.ingest_inbound')
    const firstInput = (ingestExecute.mock.calls[0][1] as any).input
    expect(firstInput.providerKey).toBe('gmail')
    expect(firstInput.channelId).toBe('11111111-1111-1111-1111-111111111111')
    expect(firstInput.message.externalMessageId).toBe('ext-1')
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (d) multi-page drain: hasMore + nextCursor re-enqueues with an incremented
  // drainPage and a delay.
  it('re-enqueues with an incremented drainPage when hasMore + nextCursor', async () => {
    const channel = baseChannel()
    const nextCursor = Buffer.from(JSON.stringify({ historyId: '5000' })).toString('base64')
    const applyPushNotification = jest.fn(async () => ({
      messages: [],
      nextCursor,
      hasMore: true,
    }))
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob({ drainPage: 3 }), ctx)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [payload, options] = enqueueMock.mock.calls[0]
    expect((payload as GmailHistorySyncJobPayload).drainPage).toBe(4)
    expect((payload as GmailHistorySyncJobPayload).channelId).toBe(
      '11111111-1111-1111-1111-111111111111',
    )
    expect((options as { delayMs: number })?.delayMs).toBeGreaterThan(0)
  })

  // (d) drain starts at page 0 when drainPage is omitted from the payload.
  it('re-enqueues at drainPage=1 when drainPage is omitted', async () => {
    const channel = baseChannel()
    const nextCursor = Buffer.from(JSON.stringify({ historyId: '5000' })).toString('base64')
    const applyPushNotification = jest.fn(async () => ({
      messages: [],
      nextCursor,
      hasMore: true,
    }))
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob(), ctx) // no drainPage
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect((enqueueMock.mock.calls[0][0] as GmailHistorySyncJobPayload).drainPage).toBe(1)
  })

  // (d) drain cap: at MAX_DRAIN_PAGES the worker STOPS re-enqueueing (no unbounded loop).
  it('stops re-enqueueing once the drain page cap is reached', async () => {
    const channel = baseChannel()
    const nextCursor = Buffer.from(JSON.stringify({ historyId: '5000' })).toString('base64')
    const applyPushNotification = jest.fn(async () => ({
      messages: [],
      nextCursor,
      hasMore: true,
    }))
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    // drainPage 100 === MAX_DRAIN_PAGES → the `drainPage < MAX_DRAIN_PAGES` guard
    // is false, so no further re-enqueue (loop is bounded).
    await handler(makeJob({ drainPage: 100 }), ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (d) hasMore is true but nextCursor is absent → no re-enqueue (both required).
  it('does not re-enqueue when hasMore is true but nextCursor is missing', async () => {
    const channel = baseChannel()
    const applyPushNotification = jest.fn(async () => ({
      messages: [],
      nextCursor: undefined,
      hasMore: true,
    }))
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob(), ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // (e) preservePushState: a completed drain (decoded cursor omits the
  // mid-drain resumption token) must NOT retain a stale pendingHistoryPageToken,
  // but MUST carry the hub-owned push-state keys forward.
  it('carries push-state keys forward and drops a stale pendingHistoryPageToken on cursor merge', async () => {
    const channel = baseChannel({
      channelState: {
        pendingHistoryPageToken: 'STALE-mid-drain-token',
        pushStatus: 'active',
        pubsubTopic: 'projects/p/topics/gmail-push',
        watchExpirationMs: 9999999999,
      },
    })
    // Decoded cursor for a COMPLETED drain: advances historyId, omits the
    // resumption token and the push keys (JSON.stringify drops undefined).
    const decodedCursor = { historyId: '6000' }
    const nextCursor = Buffer.from(JSON.stringify(decodedCursor)).toString('base64')
    const applyPushNotification = jest.fn(async () => ({
      messages: [],
      nextCursor,
      hasMore: false,
    }))
    const { ctx, em } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob(), ctx)

    expect(em.flush).toHaveBeenCalled()
    const merged = channel.channelState as Record<string, unknown>
    // Sync cursor advanced.
    expect(merged.historyId).toBe('6000')
    // Stale mid-drain resumption token NOT retained (the full-replace contract).
    expect(merged.pendingHistoryPageToken).toBeUndefined()
    // Hub-owned push keys carried forward.
    expect(merged.pushStatus).toBe('active')
    expect(merged.pubsubTopic).toBe('projects/p/topics/gmail-push')
    expect(merged.watchExpirationMs).toBe(9999999999)
    // lastPolledAt stamped on a successful cursor persist.
    expect(channel.lastPolledAt).toBeInstanceOf(Date)
    // Sanity: the push keys we asserted are the contract keys.
    expect(PUSH_STATE_KEYS).toEqual(
      expect.arrayContaining(['pushStatus', 'pubsubTopic', 'watchExpirationMs']),
    )
  })

  // (e cont.) a present push key in the decoded cursor wins over the previous
  // state (preservePushState only backfills MISSING keys).
  it('lets a push-state key present in the decoded cursor override the previous value', async () => {
    const channel = baseChannel({
      channelState: { pushStatus: 'active', pubsubTopic: 'old-topic' },
    })
    const decodedCursor = { historyId: '6000', pubsubTopic: 'new-topic' }
    const nextCursor = Buffer.from(JSON.stringify(decodedCursor)).toString('base64')
    const applyPushNotification = jest.fn(async () => ({
      messages: [],
      nextCursor,
      hasMore: false,
    }))
    const { ctx } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob(), ctx)
    const merged = channel.channelState as Record<string, unknown>
    expect(merged.pubsubTopic).toBe('new-topic')
    expect(merged.pushStatus).toBe('active')
  })

  // No nextCursor at all → channelState is left untouched and no flush occurs.
  it('does not persist channelState when the page has no nextCursor', async () => {
    const channel = baseChannel({ channelState: { pushStatus: 'active' } })
    const applyPushNotification = jest.fn(async () => ({
      messages: [],
      nextCursor: undefined,
      hasMore: false,
    }))
    const { ctx, em } = makeCtx(channel, { providerKey: 'gmail', applyPushNotification })
    await handler(makeJob(), ctx)
    expect(em.flush).not.toHaveBeenCalled()
    expect(channel.channelState).toEqual({ pushStatus: 'active' })
    expect(channel.lastPolledAt).toBeNull()
  })
})
