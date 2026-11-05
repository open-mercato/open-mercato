import handler, {
  OUTBOUND_DELIVERY_MAX_ATTEMPTS,
  metadata,
  type OutboundDeliveryPayload,
} from '../outbound-delivery'
import type { QueuedJob } from '@open-mercato/queue'

// Mock the queue helper so the worker doesn't actually re-enqueue to a real queue
// in unit tests. We assert the helper is invoked with the right shape.
const enqueueMock = jest.fn(async () => 'next-job-id')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

describe('outbound-delivery worker metadata', () => {
  it('targets the canonical outbound queue with concurrency 10', () => {
    expect(metadata.queue).toBe('communication-channels-outbound')
    expect(metadata.id).toBe('communication_channels:outbound-delivery')
    expect(metadata.concurrency).toBe(10)
  })

  it('exports a sensible max-attempts constant', () => {
    expect(OUTBOUND_DELIVERY_MAX_ATTEMPTS).toBe(3)
  })
})

describe('outbound-delivery worker behaviour', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
  })

  function makeJob(
    payload: Partial<OutboundDeliveryPayload> = {},
  ): QueuedJob<OutboundDeliveryPayload> {
    return {
      id: 'job-1',
      createdAt: new Date().toISOString(),
      payload: {
        messageId: '11111111-1111-1111-1111-111111111111',
        scope: {
          tenantId: '22222222-2222-2222-2222-222222222222',
          organizationId: '33333333-3333-3333-3333-333333333333',
        },
        attempt: 1,
        ...payload,
      },
    }
  }

  function makeCtx(execute: jest.Mock) {
    return {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'communication-channels-outbound',
      resolve: ((name: string) => {
        if (name === 'commandBus') return { execute }
        return null
      }) as <T>(name: string) => T,
    }
  }

  it('returns silently on `delivered`', async () => {
    const execute = jest.fn(async () => ({
      result: { status: 'delivered' as const, messageId: 'm', channelLinkId: 'l', externalMessageId: 'e', providerKey: 'p' },
      logEntry: null,
    }))
    await expect(handler(makeJob(), makeCtx(execute))).resolves.toBeUndefined()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('returns silently on `already_delivered`', async () => {
    const execute = jest.fn(async () => ({
      result: { status: 'already_delivered' as const, messageId: 'm', channelLinkId: 'l' },
      logEntry: null,
    }))
    await expect(handler(makeJob(), makeCtx(execute))).resolves.toBeUndefined()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('returns silently on `no_channel_link` (internal-only message)', async () => {
    const execute = jest.fn(async () => ({
      result: { status: 'no_channel_link' as const },
      logEntry: null,
    }))
    await expect(handler(makeJob(), makeCtx(execute))).resolves.toBeUndefined()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('re-enqueues on transient failure when attempts remain', async () => {
    const execute = jest.fn(async () => ({
      result: {
        status: 'failed' as const,
        messageId: 'm',
        channelLinkId: 'l',
        providerKey: 'p',
        error: 'rate limited',
        transient: true,
      },
      logEntry: null,
    }))
    await handler(makeJob({ attempt: 1 }), makeCtx(execute))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [payload, options] = enqueueMock.mock.calls[0]
    expect((payload as OutboundDeliveryPayload).attempt).toBe(2)
    expect((options as { delayMs: number })?.delayMs).toBeGreaterThan(0)
  })

  it('does NOT re-enqueue on permanent failure', async () => {
    const execute = jest.fn(async () => ({
      result: {
        status: 'failed' as const,
        messageId: 'm',
        channelLinkId: 'l',
        providerKey: 'p',
        error: 'invalid recipient',
        transient: false,
        requiresReauth: false,
      },
      logEntry: null,
    }))
    await handler(makeJob({ attempt: 1 }), makeCtx(execute))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('re-enqueues once with forceCredentialRefresh on a reauth (401) failure', async () => {
    const execute = jest.fn(async () => ({
      result: {
        status: 'failed' as const,
        messageId: 'm',
        channelLinkId: 'l',
        providerKey: 'gmail',
        error: '401 Unauthorized',
        transient: false,
        requiresReauth: true,
      },
      logEntry: null,
    }))
    await handler(makeJob({ attempt: 1 }), makeCtx(execute))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [payload] = enqueueMock.mock.calls[0]
    expect((payload as OutboundDeliveryPayload).forceCredentialRefresh).toBe(true)
    expect((payload as OutboundDeliveryPayload).attempt).toBe(2)
  })

  it('does NOT re-enqueue a reauth failure that already forced a refresh (no loop)', async () => {
    const execute = jest.fn(async () => ({
      result: {
        status: 'failed' as const,
        messageId: 'm',
        channelLinkId: 'l',
        providerKey: 'gmail',
        error: '401 Unauthorized',
        transient: false,
        requiresReauth: true,
      },
      logEntry: null,
    }))
    await handler(makeJob({ attempt: 2, forceCredentialRefresh: true }), makeCtx(execute))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('does NOT re-enqueue once MAX_ATTEMPTS reached, even for transient failure', async () => {
    const execute = jest.fn(async () => ({
      result: {
        status: 'failed' as const,
        messageId: 'm',
        channelLinkId: 'l',
        providerKey: 'p',
        error: 'timeout',
        transient: true,
      },
      logEntry: null,
    }))
    await handler(makeJob({ attempt: OUTBOUND_DELIVERY_MAX_ATTEMPTS }), makeCtx(execute))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('re-enqueues when commandBus.execute throws (infra blip) up to MAX_ATTEMPTS', async () => {
    const execute = jest.fn(async () => {
      throw new Error('DB connection lost')
    })
    await handler(makeJob({ attempt: 1 }), makeCtx(execute))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [payload] = enqueueMock.mock.calls[0]
    expect((payload as OutboundDeliveryPayload).attempt).toBe(2)
  })

  it('re-throws when commandBus.execute throws and MAX_ATTEMPTS reached', async () => {
    const execute = jest.fn(async () => {
      throw new Error('DB connection lost permanently')
    })
    await expect(
      handler(makeJob({ attempt: OUTBOUND_DELIVERY_MAX_ATTEMPTS }), makeCtx(execute)),
    ).rejects.toThrow('DB connection lost permanently')
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
