import handle from '../message-notification'
import handleIngested, { metadata as ingestedMetadata } from '../message-ingested-notification'

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

describe('messages ingested notification subscriber', () => {
  const ctx = { resolve: jest.fn(() => ({ fork: () => ({}) })) }

  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockReset()
    findOneWithDecryptionMock
      .mockResolvedValueOnce({
        subject: 'Inbound subject',
        externalName: 'External Sender',
        externalEmail: 'external@example.com',
      })
      .mockResolvedValueOnce({ name: 'Technical User', email: 'bot@example.com' })
  })

  it('subscribes to the ingested event with a distinct stable id', () => {
    expect(ingestedMetadata).toEqual({
      event: 'messages.message.ingested',
      persistent: true,
      id: 'messages:in-app-notification-ingested',
    })
  })

  it('creates the same in-app notification without email delivery intent', async () => {
    await handleIngested({
      messageId: 'message-1',
      senderUserId: 'sender-1',
      recipientUserIds: ['u1'],
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, ctx)

    expect(createBatchMock).toHaveBeenCalledTimes(1)
    expect(buildBatchNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'messages.new' }),
      expect.objectContaining({
        titleVariables: { title: 'Inbound subject', from: 'External Sender' },
        bodyVariables: { title: 'Inbound subject', from: 'External Sender' },
      }),
    )
  })

  it('falls back to the external email when the inbound sender name is missing', async () => {
    findOneWithDecryptionMock.mockReset()
    findOneWithDecryptionMock
      .mockResolvedValueOnce({
        subject: 'Inbound subject',
        externalEmail: 'external@example.com',
      })
      .mockResolvedValueOnce({ name: 'Technical User', email: 'bot@example.com' })

    await handleIngested({
      messageId: 'message-1',
      senderUserId: 'sender-1',
      recipientUserIds: ['u1'],
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, ctx)

    expect(buildBatchNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'messages.new' }),
      expect.objectContaining({
        bodyVariables: { title: 'Inbound subject', from: 'external@example.com' },
      }),
    )
  })

  it('falls back to the technical user when external sender data is unavailable', async () => {
    findOneWithDecryptionMock.mockReset()
    findOneWithDecryptionMock
      .mockResolvedValueOnce({ subject: 'Inbound subject' })
      .mockResolvedValueOnce({ name: 'Technical User', email: 'bot@example.com' })

    await handleIngested({
      messageId: 'message-1',
      senderUserId: 'sender-1',
      recipientUserIds: ['u1'],
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }, ctx)

    expect(buildBatchNotificationFromTypeMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'messages.new' }),
      expect.objectContaining({
        bodyVariables: { title: 'Inbound subject', from: 'Technical User' },
      }),
    )
  })
})
