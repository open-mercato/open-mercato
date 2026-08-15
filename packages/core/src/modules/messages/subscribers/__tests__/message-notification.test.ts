import handle from '../message-notification'

const createBatchMock = jest.fn(async () => [])
const resolveNotificationServiceMock = jest.fn(() => ({ createBatch: createBatchMock }))
const buildBatchNotificationFromTypeMock = jest.fn(() => ({ type: 'messages.new' }))
const findOneWithDecryptionMock = jest.fn()

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
  const ctx = { resolve: jest.fn(() => ({ fork: () => ({}) })) }

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.QUEUE_STRATEGY
    findOneWithDecryptionMock
      .mockResolvedValueOnce({ subject: 'Subject line' })
      .mockResolvedValueOnce({ name: 'Sender User', email: 'sender@example.com' })
  })

  it('creates in-app notifications independently of email delivery intent', async () => {
    await handle({
      messageId: 'message-1',
      senderUserId: 'sender-1',
      recipientUserIds: ['u1'],
      sendViaEmail: false,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, ctx)

    expect(resolveNotificationServiceMock).toHaveBeenCalledTimes(1)
    expect(createBatchMock).toHaveBeenCalledTimes(1)
  })

  it('deduplicates recipients when creating notifications', async () => {
    await handle({
      messageId: 'message-1',
      senderUserId: 'sender-1',
      recipientUserIds: ['u1', 'u1', 'u2'],
      sendViaEmail: true,
      externalEmail: ' ext@example.com ',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, ctx)

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

  })
})
