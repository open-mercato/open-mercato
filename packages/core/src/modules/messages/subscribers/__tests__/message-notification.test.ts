import handle from '../message-notification'

const enqueueMock = jest.fn(async () => 'job-1')
const createQueueMock = jest.fn(() => ({ enqueue: enqueueMock }))
const createBatchMock = jest.fn(async () => [])
const resolveNotificationServiceMock = jest.fn(() => ({ createBatch: createBatchMock }))
const buildBatchNotificationFromTypeMock = jest.fn(() => ({ type: 'messages.new' }))
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/queue', () => ({
  createQueue: (...args: unknown[]) => createQueueMock(...args),
}))
jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))
jest.mock('@open-mercato/core/modules/notifications/lib/notificationBuilder', () => ({
  buildBatchNotificationFromType: (...args: unknown[]) => buildBatchNotificationFromTypeMock(...args),
}))
jest.mock('@open-mercato/core/modules/messages/notifications', () => ({
  notificationTypes: [{ type: 'messages.new', module: 'messages', titleKey: 'messages.notifications.new.title' }],
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

describe('messages sent subscriber', () => {
  const queueStrategy = process.env.QUEUE_STRATEGY
  const ctx = { resolve: jest.fn(() => ({ fork: () => ({}) })) }

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.QUEUE_STRATEGY
    findOneWithDecryptionMock
      .mockResolvedValueOnce({ subject: 'Subject line' })
      .mockResolvedValueOnce({ name: 'Sender User', email: 'sender@example.com' })
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
    }, ctx)

    expect(createQueueMock).not.toHaveBeenCalled()
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(resolveNotificationServiceMock).toHaveBeenCalledTimes(1)
    expect(createBatchMock).toHaveBeenCalledTimes(1)
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
    }, ctx)

    expect(createQueueMock).toHaveBeenCalledWith('messages-email', 'async')
    expect(enqueueMock).toHaveBeenCalledTimes(3)
    expect(resolveNotificationServiceMock).toHaveBeenCalledTimes(1)
    expect(buildBatchNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'messages.new' }),
      expect.objectContaining({
        recipientUserIds: ['u1', 'u2'],
        sourceEntityId: 'message-1',
        titleVariables: { title: 'Subject line', from: 'Sender User' },
        bodyVariables: { title: 'Subject line', from: 'Sender User' },
      }),
    )
    expect(createBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'messages.new' }),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
    )

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
    }, ctx)

    expect(createQueueMock).toHaveBeenCalledWith('messages-email', 'local')
  })
})
