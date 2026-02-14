import handle from '../message-notification'

const enqueueMock = jest.fn(async () => 'job-1')
const createQueueMock = jest.fn(() => ({ enqueue: enqueueMock }))

jest.mock('@open-mercato/queue', () => ({
  createQueue: (...args: unknown[]) => createQueueMock(...args),
}))

describe('messages sent subscriber', () => {
  const queueStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.QUEUE_STRATEGY
  })

  afterAll(() => {
    process.env.QUEUE_STRATEGY = queueStrategy
  })

  it('skips enqueue when sendViaEmail is false', async () => {
    await handle({
      messageId: 'message-1',
      senderUserId: 'sender-1',
      recipientUserIds: ['u1'],
      sendViaEmail: false,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(createQueueMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('queues deduplicated recipient jobs and one external job', async () => {
    process.env.QUEUE_STRATEGY = 'async'

    await handle({
      messageId: 'message-1',
      senderUserId: 'sender-1',
      recipientUserIds: ['u1', 'u1', 'u2'],
      sendViaEmail: true,
      externalEmail: ' ext@example.com ',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(createQueueMock).toHaveBeenCalledWith('messages-email', 'async')
    expect(enqueueMock).toHaveBeenCalledTimes(3)

    expect(enqueueMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'recipient', recipientUserId: 'u1' }),
    )
    expect(enqueueMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'recipient', recipientUserId: 'u2' }),
    )
    expect(enqueueMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ type: 'external', email: 'ext@example.com' }),
    )
  })

  it('uses local strategy by default', async () => {
    await handle({
      messageId: 'message-1',
      senderUserId: 'sender-1',
      recipientUserIds: ['u1'],
      sendViaEmail: true,
      tenantId: 'tenant-1',
      organizationId: null,
    })

    expect(createQueueMock).toHaveBeenCalledWith('messages-email', 'local')
  })
})
