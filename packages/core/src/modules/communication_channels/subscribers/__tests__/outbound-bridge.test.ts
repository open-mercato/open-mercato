import handler, { metadata } from '../outbound-bridge'

const enqueueMock = jest.fn(async () => 'job-id')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

describe('outbound-bridge subscriber metadata', () => {
  it('subscribes to messages.message.sent with a stable id', () => {
    expect(metadata.event).toBe('messages.message.sent')
    expect(metadata.persistent).toBe(true)
    expect(metadata.id).toBe('communication_channels:outbound-bridge')
  })
})

describe('outbound-bridge subscriber behaviour', () => {
  beforeEach(() => {
    enqueueMock.mockClear()
  })

  function makeCtx(em: { findOne: jest.Mock }) {
    return {
      container: {
        resolve: ((name: string) => {
          if (name === 'em') return { fork: () => em }
          return null
        }) as <T>(name: string) => T,
      },
    }
  }

  const tenantId = '11111111-1111-1111-1111-111111111111'
  const messageId = '22222222-2222-2222-2222-222222222222'

  it('skips silently when payload is missing messageId', async () => {
    const findOne = jest.fn()
    await handler({} as any, makeCtx({ findOne }))
    expect(findOne).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when Message no longer exists', async () => {
    const findOne = jest.fn().mockResolvedValueOnce(null) // Message lookup
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips internal-only messages (no threadId)', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: null }) // Message
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('skips when no ChannelThreadMapping exists for the threadId', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' }) // Message
    findOne.mockResolvedValueOnce(null) // ChannelThreadMapping
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('enqueues an outbound job when channel-linked and not yet delivered', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' }) // Message
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1' }) // mapping
    findOne.mockResolvedValueOnce(null) // existing link (none)
    await handler({ messageId, tenantId, organizationId: 'org-1' }, makeCtx({ findOne }))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [payload] = enqueueMock.mock.calls[0]
    expect((payload as any).messageId).toBe(messageId)
    expect((payload as any).scope.tenantId).toBe(tenantId)
    expect((payload as any).scope.organizationId).toBe('org-1')
    expect((payload as any).attempt).toBe(1)
  })

  it('skips when an existing link is already in a delivered state', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' }) // Message
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1' }) // mapping
    findOne.mockResolvedValueOnce({ id: 'link-1', deliveryStatus: 'sent' }) // existing link
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('enqueues when an existing link is pending or failed (retry path)', async () => {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce({ id: messageId, threadId: 'thread-1' })
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: 'thread-1' })
    findOne.mockResolvedValueOnce({ id: 'link-1', deliveryStatus: 'failed' })
    await handler({ messageId, tenantId }, makeCtx({ findOne }))
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })
})
