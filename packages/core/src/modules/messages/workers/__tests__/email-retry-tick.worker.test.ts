import { runEmailRetryTick } from '../email-retry-tick.worker'
import { Message, MessageExternalParticipant } from '../../data/entities'

const findWithDecryptionMock = jest.fn()
const enqueueMessageEmailJobMock = jest.fn(async () => undefined)
const emitMessagesEventMock = jest.fn(async () => undefined)

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => ({
  withAdvisoryXactLock: (em: unknown, _key: string, fn: (tx: unknown) => Promise<unknown>) => fn(em),
}))

jest.mock('../send-email.worker', () => ({
  enqueueMessageEmailJob: (...args: unknown[]) => enqueueMessageEmailJobMock(...args),
}))

jest.mock('../../events', () => ({
  emitMessagesEvent: (...args: unknown[]) => emitMessagesEventMock(...args),
}))

describe('messages email retry tick', () => {
  const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
  const now = new Date('2026-11-20T12:00:00Z')
  const enqueueOutbound = jest.fn(async () => undefined)

  function makeEm() {
    return {
      nativeUpdate: jest.fn(async () => 1),
      count: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => (where.deliveryStatus === 'failed' ? 1 : 0)),
    }
  }

  const container = {
    resolve: <T,>(name: string): T => {
      if (name === 'communicationChannelsEnqueueOutboundDelivery') return enqueueOutbound as unknown as T
      throw new Error(`unexpected resolve: ${name}`)
    },
  }

  function prime(participants: Array<Record<string, unknown>>, messages: Array<Record<string, unknown>>) {
    findWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
      if (entity === MessageExternalParticipant) return participants
      if (entity === Message) return messages
      return []
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('selects only due pending participants of its own tenant and organization', async () => {
    prime([], [])

    await runEmailRetryTick(makeEm() as never, container, scope, now)

    const [, entity, where, options, decryptionScope] = findWithDecryptionMock.mock.calls[0]
    expect(entity).toBe(MessageExternalParticipant)
    expect(where).toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deliveryStatus: 'pending',
      $or: [
        { nextAttemptAt: { $lte: now } },
        { nextAttemptAt: null, createdAt: { $lte: new Date(now.getTime() - 300_000) } },
      ],
    })
    expect(options).toMatchObject({ limit: 200 })
    expect(decryptionScope).toEqual(scope)
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
  })

  it('re-enqueues each message on the path that owns its delivery', async () => {
    const sentAt = new Date(now.getTime() - 3_600_000)
    prime(
      [
        { id: 'p-1', messageId: 'm-system' },
        { id: 'p-2', messageId: 'm-separate' },
        { id: 'p-3', messageId: 'm-separate' },
        { id: 'p-4', messageId: 'm-joint' },
      ],
      [
        { id: 'm-system', sentAt, sourceEntityType: null, emailSendSeparately: false },
        { id: 'm-separate', sentAt, sourceEntityType: 'communication_channels.send_as_user', emailSendSeparately: true },
        { id: 'm-joint', sentAt, sourceEntityType: 'communication_channels.send_as_user', emailSendSeparately: false },
      ],
    )

    const result = await runEmailRetryTick(makeEm() as never, container, scope, now)

    expect(result).toEqual({ enqueued: 4, expired: 0 })
    expect(findWithDecryptionMock.mock.calls[1][2]).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null })
    expect(enqueueMessageEmailJobMock).toHaveBeenCalledWith({ type: 'external_participants', messageId: 'm-system', ...scope })
    expect(enqueueOutbound.mock.calls).toEqual([
      [{ messageId: 'm-separate', scope, externalParticipantId: 'p-2' }],
      [{ messageId: 'm-separate', scope, externalParticipantId: 'p-3' }],
      [{ messageId: 'm-joint', scope, externalParticipantId: null }],
    ])
  })

  it('fails participants past the delivery window instead of re-enqueueing them', async () => {
    prime(
      [{ id: 'p-1', messageId: 'm-old' }],
      [{ id: 'm-old', sentAt: new Date(now.getTime() - 25 * 3_600_000), sourceEntityType: null, emailSendSeparately: false }],
    )
    const em = makeEm()

    const result = await runEmailRetryTick(em as never, container, scope, now)

    expect(result).toEqual({ enqueued: 0, expired: 1 })
    expect(enqueueMessageEmailJobMock).not.toHaveBeenCalled()
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      MessageExternalParticipant,
      { messageId: 'm-old', ...scope, deliveryStatus: 'pending', id: 'p-1' },
      { deliveryStatus: 'failed', deliveryError: 'delivery window exceeded', nextAttemptAt: null },
    )
    expect(emitMessagesEventMock).toHaveBeenCalledWith(
      'messages.message.delivery_finished',
      { messageId: 'm-old', sentCount: 0, failedCount: 1, ...scope },
      { persistent: true },
    )
  })
})
