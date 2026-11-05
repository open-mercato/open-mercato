import handle from '../send-email.worker'
import { Message, MessageRecipient } from '../../data/entities'
import { User } from '../../../auth/data/entities'

const findOneWithDecryptionMock = jest.fn()
const getMessageEmailAttachmentsMock = jest.fn()
const sendMessageEmailToRecipientMock = jest.fn(async () => {})
const sendMessageEmailToExternalMock = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('../../lib/attachments', () => ({
  getMessageEmailAttachments: (...args: unknown[]) => getMessageEmailAttachmentsMock(...args),
}))

jest.mock('../../lib/email-sender', () => ({
  sendMessageEmailToRecipient: (...args: unknown[]) => sendMessageEmailToRecipientMock(...args),
  sendMessageEmailToExternal: (...args: unknown[]) => sendMessageEmailToExternalMock(...args),
}))

describe('messages send-email worker handler', () => {
  const baseMessage = {
    id: 'message-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    senderUserId: 'sender-1',
    subject: 'Subject',
    body: 'Body',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    getMessageEmailAttachmentsMock.mockResolvedValue([])
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown, where: { id?: string }) => {
      if (entity === Message) return baseMessage
      if (entity === User && where.id === 'sender-1') return { id: 'sender-1', name: 'Sender', email: 'sender@example.com' }
      if (entity === User && where.id === 'recipient-1') return { id: 'recipient-1', email: 'recipient@example.com' }
      return null
    })
  })

  function createWorkerContext(overrides: Partial<{
    recipient: unknown
    nativeUpdateResults: number[]
  }> = {}) {
    const nativeUpdateResults = [...(overrides.nativeUpdateResults ?? [1])]

    const emFork = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === MessageRecipient) {
          if (overrides.recipient !== undefined) return overrides.recipient
          return {
            messageId: 'message-1',
            recipientUserId: 'recipient-1',
            emailSentAt: null,
          }
        }

        return null
      }),
      find: jest.fn(async () => []),
      nativeUpdate: jest.fn(async () => nativeUpdateResults.shift() ?? 0),
      fork: jest.fn(),
    }

    emFork.fork.mockReturnValue(emFork)

    const ctx = {
      jobId: 'job-1',
      attemptNumber: 1,
      queueName: 'messages-email',
      resolve: (name: string) => {
        if (name === 'em') return emFork
        return null
      },
    }

    return { emFork, ctx }
  }

  it('skips when message does not exist', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)
    const { ctx } = createWorkerContext()

    await handle(
      {
        payload: {
          type: 'recipient',
          messageId: 'missing',
          recipientUserId: 'recipient-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      } as never,
      ctx as never,
    )

    expect(sendMessageEmailToRecipientMock).not.toHaveBeenCalled()
    expect(sendMessageEmailToExternalMock).not.toHaveBeenCalled()
  })

  it('sends recipient email when claim succeeds and recipient email exists', async () => {
    const { ctx } = createWorkerContext({ nativeUpdateResults: [1] })

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

    expect(sendMessageEmailToRecipientMock).toHaveBeenCalledTimes(1)
    expect(sendMessageEmailToExternalMock).not.toHaveBeenCalled()
  })

  it('skips recipient delivery when emailSentAt is already set (idempotency guard)', async () => {
    const { ctx } = createWorkerContext({
      recipient: {
        messageId: 'message-1',
        recipientUserId: 'recipient-1',
        emailSentAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    })

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

    expect(sendMessageEmailToRecipientMock).not.toHaveBeenCalled()
  })

  it('releases claim when recipient has no email', async () => {
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown, where: { id?: string }) => {
      if (entity === Message) return baseMessage
      if (entity === User && where.id === 'sender-1') return { id: 'sender-1', name: 'Sender', email: 'sender@example.com' }
      if (entity === User && where.id === 'recipient-1') return { id: 'recipient-1', email: null }
      return null
    })

    const { emFork, ctx } = createWorkerContext({ nativeUpdateResults: [1, 1] })

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

    expect(sendMessageEmailToRecipientMock).not.toHaveBeenCalled()
    expect(emFork.nativeUpdate).toHaveBeenCalledTimes(2)
  })

  it('sends external email when external claim succeeds', async () => {
    const { ctx } = createWorkerContext({ nativeUpdateResults: [1] })

    await handle(
      {
        payload: {
          type: 'external',
          messageId: 'message-1',
          email: 'external@example.com',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      } as never,
      ctx as never,
    )

    expect(sendMessageEmailToExternalMock).toHaveBeenCalledTimes(1)
    expect(sendMessageEmailToRecipientMock).not.toHaveBeenCalled()
  })

  it('skips external delivery when claim cannot be obtained', async () => {
    const { ctx } = createWorkerContext({ nativeUpdateResults: [0] })

    await handle(
      {
        payload: {
          type: 'external',
          messageId: 'message-1',
          email: 'external@example.com',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      } as never,
      ctx as never,
    )

    expect(sendMessageEmailToExternalMock).not.toHaveBeenCalled()
  })
})
