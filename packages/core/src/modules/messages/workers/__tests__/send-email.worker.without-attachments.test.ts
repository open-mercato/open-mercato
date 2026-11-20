import handle from '../send-email.worker'
import { Message, MessageRecipient } from '../../data/entities'
import { User } from '../../../auth/data/entities'

const findOneWithDecryptionMock = jest.fn()
const sendMessageEmailToRecipientMock = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../../lib/email-sender', () => ({
  sendMessageEmailToRecipient: (...args: unknown[]) => sendMessageEmailToRecipientMock(...args),
  sendMessageEmailToExternal: jest.fn(async () => {}),
}))

describe('messages send-email worker without the attachments module (#9201)', () => {
  it('sends the email without attachments instead of failing the job', async () => {
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown, where: { id?: string }) => {
      if (entity === Message) {
        return { id: 'message-1', tenantId: 'tenant-1', organizationId: 'org-1', senderUserId: 'sender-1', subject: 'S', body: 'B' }
      }
      if (entity === User && where.id === 'sender-1') return { id: 'sender-1', name: 'Sender', email: 'sender@example.com' }
      if (entity === User && where.id === 'recipient-1') return { id: 'recipient-1', email: 'recipient@example.com' }
      return null
    })
    const find = jest.fn(async () => [])
    const emFork = {
      getMetadata: () => ({ find: () => false }),
      findOne: jest.fn(async (entity: unknown) => (entity === MessageRecipient
        ? { messageId: 'message-1', recipientUserId: 'recipient-1', emailSentAt: null }
        : null)),
      find,
      nativeUpdate: jest.fn(async () => 1),
      fork: jest.fn(),
    }
    emFork.fork.mockReturnValue(emFork)
    const ctx = {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'messages-email',
      resolve: (name: string) => (name === 'em' ? emFork : null),
    }

    await handle(
      {
        payload: {
          type: 'recipient',
          messageId: 'message-1',
          recipientUserId: 'recipient-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      } as never,
      ctx as never,
    )

    expect(sendMessageEmailToRecipientMock).toHaveBeenCalledWith(expect.objectContaining({ attachments: [] }))
    expect(find).toHaveBeenCalledTimes(1)
  })
})
