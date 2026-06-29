import handler, { metadata } from '../reaction-processor'
import { REACTION_PROCESSOR_MAX_ATTEMPTS, type ReactionProcessorPayload } from '../../lib/reaction-processor-types'
import type { QueuedJob } from '@open-mercato/queue'

const enqueueMock = jest.fn(async () => 'next-job')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

describe('reaction-processor worker metadata', () => {
  it('targets the reactions queue with concurrency 10', () => {
    expect(metadata.queue).toBe('communication-channels-reactions')
    expect(metadata.id).toBe('communication_channels:reaction-processor')
    expect(metadata.concurrency).toBe(10)
  })

  it('exposes max-attempts constant', () => {
    expect(REACTION_PROCESSOR_MAX_ATTEMPTS).toBe(3)
  })
})

describe('reaction-processor worker dispatch', () => {
  beforeEach(() => enqueueMock.mockClear())

  function makeJob<P extends ReactionProcessorPayload>(payload: P): QueuedJob<P> {
    return { id: 'job', createdAt: new Date().toISOString(), payload }
  }

  function makeCtx(
    resolveFn: (name: string) => unknown,
  ): {
    jobId: string
    attemptNumber: number
    queueName: string
    resolve: <T>(name: string) => T
  } {
    return {
      jobId: 'job',
      attemptNumber: 1,
      queueName: 'communication-channels-reactions',
      resolve: resolveFn as <T>(name: string) => T,
    }
  }

  it('dispatches `inbound` kind to the commandBus with the canonical command id', async () => {
    const execute = jest.fn(async () => ({ result: { status: 'noop' as const }, logEntry: null }))
    const job = makeJob({
      kind: 'inbound',
      providerKey: 'slack',
      channelId: '11111111-1111-1111-1111-111111111111',
      channelType: 'chat',
      event: {
        externalMessageId: 'ext-1',
        emoji: '👍',
        userIdentifier: 'U1',
        action: 'added',
      },
      scope: { tenantId: '22222222-2222-2222-2222-222222222222', organizationId: null },
    })
    const ctx = makeCtx((name) => {
      if (name === 'commandBus') return { execute }
      return null
    })
    await handler(job, ctx)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toBe('communication_channels.reaction.process_inbound')
  })

  it('handles `outbound_send` calling adapter.sendReaction', async () => {
    const sendReaction = jest.fn(async () => undefined)
    const adapter = { providerKey: 'slack', sendReaction } as any
    const findOne = jest.fn().mockResolvedValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      isActive: true,
      providerKey: 'slack',
      credentialsRef: null,
    })
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => adapter }
      if (name === 'em') return { fork: () => ({ findOne }) }
      if (name === 'commandBus') return { execute: jest.fn() }
      return null
    })
    const job = makeJob({
      kind: 'outbound_send',
      providerKey: 'slack',
      channelId: '11111111-1111-1111-1111-111111111111',
      messageId: '22222222-2222-2222-2222-222222222222',
      reactionId: '33333333-3333-3333-3333-333333333333',
      emoji: '👍',
      conversationId: 'C123:1700000.000',
      scope: { tenantId: '44444444-4444-4444-4444-444444444444', organizationId: null },
    })
    await handler(job, ctx)
    expect(sendReaction).toHaveBeenCalledTimes(1)
    expect(enqueueMock).not.toHaveBeenCalled() // success → no retry
  })

  it('handles `outbound_remove` calling adapter.removeReaction', async () => {
    const removeReaction = jest.fn(async () => undefined)
    const adapter = { providerKey: 'slack', removeReaction } as any
    const findOne = jest.fn().mockResolvedValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      isActive: true,
      providerKey: 'slack',
      credentialsRef: null,
    })
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => adapter }
      if (name === 'em') return { fork: () => ({ findOne }) }
      return null
    })
    const job = makeJob({
      kind: 'outbound_remove',
      providerKey: 'slack',
      channelId: '11111111-1111-1111-1111-111111111111',
      messageId: '22222222-2222-2222-2222-222222222222',
      emoji: '👍',
      externalReactionId: 'ext-r-1',
      scope: { tenantId: '44444444-4444-4444-4444-444444444444', organizationId: null },
    })
    await handler(job, ctx)
    expect(removeReaction).toHaveBeenCalledTimes(1)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('re-enqueues on transient outbound failure with attempts remaining', async () => {
    const transient = new Error('connect ETIMEDOUT')
    const sendReaction = jest.fn(async () => {
      throw transient
    })
    const adapter = { providerKey: 'slack', sendReaction } as any
    const findOne = jest.fn().mockResolvedValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      isActive: true,
      providerKey: 'slack',
      credentialsRef: null,
    })
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => adapter }
      if (name === 'em') return { fork: () => ({ findOne }) }
      return null
    })
    const job = makeJob({
      kind: 'outbound_send',
      providerKey: 'slack',
      channelId: '11111111-1111-1111-1111-111111111111',
      messageId: '22222222-2222-2222-2222-222222222222',
      reactionId: '33333333-3333-3333-3333-333333333333',
      emoji: '👍',
      scope: { tenantId: '44444444-4444-4444-4444-444444444444', organizationId: null },
      attempt: 1,
    })
    await handler(job, ctx)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [retryPayload] = enqueueMock.mock.calls[0]
    expect((retryPayload as ReactionProcessorPayload).attempt).toBe(2)
  })

  it('does not re-enqueue on permanent failure', async () => {
    const permanent = new Error('invalid emoji') as Error & { status?: number }
    permanent.status = 400
    const sendReaction = jest.fn(async () => {
      throw permanent
    })
    const adapter = { providerKey: 'slack', sendReaction } as any
    const findOne = jest.fn().mockResolvedValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      isActive: true,
      providerKey: 'slack',
      credentialsRef: null,
    })
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => adapter }
      if (name === 'em') return { fork: () => ({ findOne }) }
      return null
    })
    const job = makeJob({
      kind: 'outbound_send',
      providerKey: 'slack',
      channelId: '11111111-1111-1111-1111-111111111111',
      messageId: '22222222-2222-2222-2222-222222222222',
      reactionId: '33333333-3333-3333-3333-333333333333',
      emoji: '👍',
      scope: { tenantId: '44444444-4444-4444-4444-444444444444', organizationId: null },
      attempt: 1,
    })
    await handler(job, ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('does not re-enqueue when adapter is missing (`no_adapter` is permanent)', async () => {
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => undefined }
      return null
    })
    const job = makeJob({
      kind: 'outbound_send',
      providerKey: 'nonexistent',
      channelId: '11111111-1111-1111-1111-111111111111',
      messageId: '22222222-2222-2222-2222-222222222222',
      reactionId: '33333333-3333-3333-3333-333333333333',
      emoji: '👍',
      scope: { tenantId: '44444444-4444-4444-4444-444444444444', organizationId: null },
    })
    await handler(job, ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('stops re-enqueueing once MAX_ATTEMPTS reached for transient errors', async () => {
    const transient = new Error('rate limit')
    const sendReaction = jest.fn(async () => {
      throw transient
    })
    const adapter = { providerKey: 'slack', sendReaction } as any
    const findOne = jest.fn().mockResolvedValueOnce({
      id: '11111111-1111-1111-1111-111111111111',
      isActive: true,
      providerKey: 'slack',
      credentialsRef: null,
    })
    const ctx = makeCtx((name) => {
      if (name === 'channelAdapterRegistry') return { get: () => adapter }
      if (name === 'em') return { fork: () => ({ findOne }) }
      return null
    })
    const job = makeJob({
      kind: 'outbound_send',
      providerKey: 'slack',
      channelId: '11111111-1111-1111-1111-111111111111',
      messageId: '22222222-2222-2222-2222-222222222222',
      reactionId: '33333333-3333-3333-3333-333333333333',
      emoji: '👍',
      scope: { tenantId: '44444444-4444-4444-4444-444444444444', organizationId: null },
      attempt: REACTION_PROCESSOR_MAX_ATTEMPTS,
    })
    await handler(job, ctx)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
