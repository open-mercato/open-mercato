import handle from '../send-email.worker'
import { Message, MessageExternalParticipant } from '../../data/entities'

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const sendMessageEmailToExternalMock = jest.fn()
const emitMessagesEventMock = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('../../lib/attachments', () => ({
  getMessageEmailAttachments: jest.fn(async () => []),
}))

jest.mock('../../lib/email-sender', () => ({
  sendMessageEmailToRecipient: jest.fn(),
  sendMessageEmailToExternal: (...args: unknown[]) => sendMessageEmailToExternalMock(...args),
}))

jest.mock('../../events', () => ({
  emitMessagesEvent: (...args: unknown[]) => emitMessagesEventMock(...args),
}))

type NativeUpdateCall = { entity: unknown; where: Record<string, unknown>; data: Record<string, unknown> }

describe('messages send-email worker — external participants', () => {
  const job = {
    payload: {
      type: 'external_participants' as const,
      messageId: 'message-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    },
  }
  const message = {
    id: 'message-1',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    senderUserId: 'sender-1',
    externalEmail: 'a@example.com',
    emailSendSeparately: true,
  }
  const participants = [
    { id: 'p-a', email: 'a@example.com', role: 'to' },
    { id: 'p-b', email: 'b@example.com', role: 'to' },
  ]

  function createContext(options: { claimRows: number; participantCount?: number }) {
    const calls: NativeUpdateCall[] = []
    let first = true
    const em = {
      find: jest.fn(async () => []),
      count: jest.fn(async () => options.participantCount ?? 0),
      nativeUpdate: jest.fn(async (entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
        calls.push({ entity, where, data })
        if (first) {
          first = false
          return options.claimRows
        }
        return 1
      }),
      fork: jest.fn(),
    }
    em.fork.mockReturnValue(em)
    const ctx = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'eventBus') return { emit: jest.fn() }
        return null
      },
    }
    return { em, ctx, calls }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => (entity === Message ? message : null))
    findWithDecryptionMock.mockResolvedValue(participants)
  })

  it('sends once to every claimed participant and writes back per-participant status', async () => {
    sendMessageEmailToExternalMock.mockResolvedValue({
      accepted: ['a@example.com'],
      rejected: [{ address: 'B@example.com', error: 'mailbox unavailable' }],
    })
    const { ctx, calls } = createContext({ claimRows: 2 })

    await handle(job as never, ctx as never)

    expect(sendMessageEmailToExternalMock).toHaveBeenCalledTimes(1)
    expect(sendMessageEmailToExternalMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      email: ['a@example.com', 'b@example.com'],
      sendSeparately: true,
    }))
    const claim = calls[0]
    expect(claim.entity).toBe(MessageExternalParticipant)
    expect(claim.where).toEqual(expect.objectContaining({ messageId: 'message-1', tenantId: 'tenant-1', organizationId: 'org-1', deliveryStatus: 'pending', role: 'to' }))
    const claimUntil = claim.data.nextAttemptAt
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        where: expect.objectContaining({ id: { $in: ['p-a'] }, nextAttemptAt: claimUntil }),
        data: expect.objectContaining({ deliveryStatus: 'sent', sentAt: expect.any(Date) }),
      }),
      expect.objectContaining({
        where: expect.objectContaining({ id: 'p-b', nextAttemptAt: claimUntil }),
        data: expect.objectContaining({ deliveryStatus: 'failed', deliveryError: 'mailbox unavailable' }),
      }),
      expect.objectContaining({
        entity: Message,
        where: expect.objectContaining({ id: 'message-1', externalEmailSentAt: null }),
        data: expect.objectContaining({ externalEmailSentAt: expect.any(Date), externalEmailError: null }),
      }),
    ]))
    expect(emitMessagesEventMock).toHaveBeenCalledWith(
      'messages.message.email_sent',
      expect.objectContaining({ participantId: 'p-a', email: 'a@example.com', role: 'to' }),
      { persistent: true },
    )
    expect(emitMessagesEventMock).toHaveBeenCalledWith(
      'messages.message.email_failed',
      expect.objectContaining({ participantId: 'p-b', error: 'mailbox unavailable' }),
      { persistent: true },
    )
  })

  it('releases the claim and records the failure summary when the send throws', async () => {
    sendMessageEmailToExternalMock.mockRejectedValue(new Error('SMTP_SEND_FAILED: down'))
    const { ctx, calls } = createContext({ claimRows: 2 })

    await handle(job as never, ctx as never)

    const claimUntil = calls[0].data.nextAttemptAt
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: MessageExternalParticipant,
        where: expect.objectContaining({ deliveryStatus: 'pending', nextAttemptAt: claimUntil }),
        data: { nextAttemptAt: null, deliveryError: 'SMTP_SEND_FAILED: down' },
      }),
      expect.objectContaining({
        entity: Message,
        data: expect.objectContaining({ externalEmailFailedAt: expect.any(Date), externalEmailError: 'SMTP_SEND_FAILED: down' }),
      }),
    ]))
    expect(calls.some((call) => call.data.deliveryStatus === 'sent')).toBe(false)
    expect(emitMessagesEventMock).toHaveBeenCalledTimes(2)
  })

  it('does nothing when another worker holds the claim', async () => {
    const { ctx } = createContext({ claimRows: 0, participantCount: 2 })

    await handle(job as never, ctx as never)

    expect(sendMessageEmailToExternalMock).not.toHaveBeenCalled()
  })

  it('falls back to the single external address for messages without participant rows', async () => {
    sendMessageEmailToExternalMock.mockResolvedValue({ accepted: ['a@example.com'], rejected: [] })
    const { ctx, calls } = createContext({ claimRows: 0, participantCount: 0 })

    await handle(job as never, ctx as never)

    expect(sendMessageEmailToExternalMock).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@example.com' }))
    expect(calls[1]).toEqual(expect.objectContaining({
      entity: Message,
      data: expect.objectContaining({ externalEmailSentAt: expect.any(Date) }),
    }))
  })
})
