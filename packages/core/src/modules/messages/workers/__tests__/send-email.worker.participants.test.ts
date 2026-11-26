import handle, { planExternalParticipantOutcome } from '../send-email.worker'
import { Message, MessageExternalParticipant } from '../../data/entities'
import { EmailSendError } from '@open-mercato/shared/lib/email/send'

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const sendMessageEmailToExternalMock = jest.fn()
const emitMessagesEventMock = jest.fn(async () => {})
const enqueueMock = jest.fn(async () => 'job-1')

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => ({
  withAdvisoryXactLock: (em: unknown, _key: string, fn: (tx: unknown) => Promise<unknown>) => fn(em),
}))

jest.mock('@open-mercato/queue', () => ({
  createQueue: () => ({ enqueue: (...args: unknown[]) => enqueueMock(...args) }),
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
    emailDeliveryRoute: 'system',
    sentAt: new Date(),
  }
  const participants = [
    { id: 'p-a', email: 'a@example.com', role: 'to' },
    { id: 'p-b', email: 'b@example.com', role: 'to' },
  ]

  function createContext(options: { claimRows: number; participantCount?: number; pendingAfter?: number }) {
    const calls: NativeUpdateCall[] = []
    let first = true
    const em = {
      find: jest.fn(async () => []),
      count: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
        if (where.deliveryStatus === 'pending') return options.pendingAfter ?? 0
        if (where.deliveryStatus === 'sent') return 1
        if (where.deliveryStatus === 'failed') return 1
        return options.participantCount ?? 0
      }),
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

  it('sends once to every claimed participant, writes back per-participant status and finishes once', async () => {
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
    const finished = emitMessagesEventMock.mock.calls.filter((call) => call[0] === 'messages.message.delivery_finished')
    expect(finished).toEqual([[
      'messages.message.delivery_finished',
      { messageId: 'message-1', sentCount: 1, failedCount: 1, tenantId: 'tenant-1', organizationId: 'org-1' },
      { persistent: true },
    ]])
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('keeps participants pending and re-enqueues itself after a transient failure', async () => {
    const retryAt = new Date(Date.now() + 120_000)
    sendMessageEmailToExternalMock.mockRejectedValue(new EmailSendError('rate limited', { transient: true, retryAt }))
    const { ctx, calls } = createContext({ claimRows: 2, pendingAfter: 2 })

    await handle(job as never, ctx as never)

    const retries = calls.filter((call) => call.entity === MessageExternalParticipant && call.data.deliveryStatus === 'pending')
    expect(retries).toHaveLength(2)
    expect(retries[0].data).toEqual({ deliveryStatus: 'pending', deliveryError: 'rate limited', nextAttemptAt: retryAt })
    expect(calls.some((call) => call.data.deliveryStatus === 'sent' || call.data.deliveryStatus === 'failed')).toBe(false)
    expect(calls.some((call) => call.entity === Message)).toBe(false)
    expect(emitMessagesEventMock).not.toHaveBeenCalled()
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [enqueuedJob, enqueueOptions] = enqueueMock.mock.calls[0] as unknown as [unknown, { delayMs: number; coalesce?: unknown }]
    expect(enqueuedJob).toEqual(job.payload)
    expect(enqueueOptions.coalesce).toBeUndefined()
    expect(enqueueOptions.delayMs).toBeGreaterThan(115_000)
    expect(enqueueOptions.delayMs).toBeLessThanOrEqual(121_000)
  })

  it('fails participants permanently on a non-transient error and records the failure summary', async () => {
    sendMessageEmailToExternalMock.mockRejectedValue(new EmailSendError('550 5.1.1 unknown user', { transient: false }))
    const { ctx, calls } = createContext({ claimRows: 2 })

    await handle(job as never, ctx as never)

    expect(calls.filter((call) => call.data.deliveryStatus === 'failed')).toHaveLength(2)
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: Message,
        data: expect.objectContaining({ externalEmailFailedAt: expect.any(Date), externalEmailError: '550 5.1.1 unknown user' }),
      }),
    ]))
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it.each([
    ['email delivery is disabled', { emailDeliveryRoute: null }],
    ['the message belongs to a channel conversation', { emailDeliveryRoute: null, sourceEntityType: 'communication_channels.external_conversation' }],
    ['the message is handed to a mailbox', { emailDeliveryRoute: 'send_as_user' }],
  ])('sends no platform email and claims nothing when %s', async (_case, overrides) => {
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => (entity === Message ? { ...message, ...overrides } : null))
    const { ctx, calls } = createContext({ claimRows: 2, participantCount: 2 })

    await handle(job as never, ctx as never)

    expect(sendMessageEmailToExternalMock).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('keeps the single-address send for a pre-upgrade message without participant rows or a route', async () => {
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => (entity === Message ? { ...message, emailDeliveryRoute: null } : null))
    sendMessageEmailToExternalMock.mockResolvedValue({ accepted: ['a@example.com'], rejected: [] })
    const { ctx, calls } = createContext({ claimRows: 2, participantCount: 0 })

    await handle(job as never, ctx as never)

    expect(sendMessageEmailToExternalMock).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@example.com' }))
    expect(calls.some((call) => call.entity === MessageExternalParticipant)).toBe(false)
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

describe('planExternalParticipantOutcome', () => {
  const participant = (id: string, email: string) => ({ id, email, role: 'to' }) as never
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  it('fails transient rejections once the delivery window is over', () => {
    process.env.OM_EMAIL_DELIVERY_MAX_HOURS = '24'
    const now = new Date('2026-11-20T12:00:00Z')
    const outcome = planExternalParticipantOutcome(
      [participant('p-a', 'a@example.com')],
      { accepted: [], rejected: [{ address: 'a@example.com', error: '451 4.7.1 try later', transient: true }] },
      new Date('2026-11-19T11:00:00Z'),
      now,
    )
    expect(outcome.failed).toEqual([{ participant: expect.objectContaining({ id: 'p-a' }), error: 'delivery window exceeded' }])
  })

  it('schedules a transient rejection after the configured delay inside the window', () => {
    process.env.OM_EMAIL_DELIVERY_RETRY_DELAY_SECONDS = '60'
    const now = new Date('2026-11-20T12:00:00Z')
    const outcome = planExternalParticipantOutcome(
      [participant('p-a', 'a@example.com'), participant('p-b', 'b@example.com')],
      { accepted: ['b@example.com'], rejected: [{ address: 'a@example.com', error: 'busy', transient: true }] },
      now,
      now,
    )
    expect(outcome.sent.map((entry: { id: string }) => entry.id)).toEqual(['p-b'])
    expect(outcome.retry).toEqual([{ participant: expect.objectContaining({ id: 'p-a' }), error: 'busy', nextAttemptAt: new Date('2026-11-20T12:01:00Z') }])
  })
})
