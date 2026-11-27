import handle, { metadata } from '../delivery-failed-notification'
import { Message, MessageExternalParticipant } from '../../data/entities'

const createBatchMock = jest.fn(async () => [])
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createBatch: createBatchMock }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

describe('messages delivery failed notification', () => {
  const ctx = { resolve: jest.fn(() => ({ fork: () => ({}) })) }
  const payload = { messageId: 'message-1', sentCount: 1, failedCount: 2, tenantId: 'tenant-1', organizationId: 'org-1' }

  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockResolvedValue({ id: 'message-1', senderUserId: 'sender-1', subject: 'Offer' })
    findWithDecryptionMock.mockResolvedValue([
      { id: 'p-1', email: 'a@example.com' },
      { id: 'p-2', email: 'b@example.com' },
    ])
  })

  it('subscribes persistently to delivery_finished', () => {
    expect(metadata).toEqual({ event: 'messages.message.delivery_finished', persistent: true, id: 'messages:delivery-failed-notification' })
  })

  it('notifies the sender once per message with the failed addresses', async () => {
    await handle(payload, ctx)

    expect(findOneWithDecryptionMock.mock.calls[0][1]).toBe(Message)
    expect(findOneWithDecryptionMock.mock.calls[0][2]).toEqual({ id: 'message-1', tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null })
    expect(findWithDecryptionMock.mock.calls[0][1]).toBe(MessageExternalParticipant)
    expect(findWithDecryptionMock.mock.calls[0][2]).toEqual({ messageId: 'message-1', tenantId: 'tenant-1', organizationId: 'org-1', deliveryStatus: 'failed' })
    expect(createBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'messages.delivery_failed',
        recipientUserIds: ['sender-1'],
        bodyVariables: { subject: 'Offer', count: '2', addresses: 'a@example.com, b@example.com' },
        sourceEntityId: 'message-1',
        linkHref: '/backend/messages/message-1',
        groupKey: 'messages.delivery_failed:message-1',
      }),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('stays silent when nothing failed', async () => {
    await handle({ ...payload, failedCount: 0 }, ctx)
    expect(createBatchMock).not.toHaveBeenCalled()
  })
})
