import '@open-mercato/core/modules/messages/commands/messages'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'
import bridgeHandler from '../outbound-bridge'

const enqueueMock = jest.fn(async () => 'job-id')
jest.mock('../../lib/queue', () => {
  const actual = jest.requireActual('../../lib/queue')
  return {
    ...actual,
    getCommunicationChannelsQueue: jest.fn(() => ({ enqueue: enqueueMock })),
  }
})

const emitMessagesEventMock = jest.fn(async () => {})
jest.mock('@open-mercato/core/modules/messages/events', () => ({
  emitMessagesEvent: (...args: unknown[]) => emitMessagesEventMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/attachments', () => ({
  linkAttachmentsToMessage: jest.fn(),
  linkLibraryAttachmentsToMessage: jest.fn(),
  copyAttachmentsForForwardMessages: jest.fn(),
}))

/**
 * Cross-module seam regression for @pkarw's blocker on #5645.
 *
 * The two mocked unit suites on either side of this seam each pass on their own:
 * `messages` proves the forward command composes the message it should, and
 * `communication_channels` proves the bridge enqueues an operator message in a
 * channel thread. The leak lived exactly between them — a forward IS an operator
 * message in a channel thread, so the bridge delivered the operator's private
 * commentary about the correspondent TO that correspondent.
 *
 * These tests therefore run the real command, take the `messages.message.sent`
 * payload and the `Message` row it actually produced, and feed both into the
 * real subscriber. Nothing about the intent guard is restated here; the
 * assertion is on what the two modules do to each other.
 */
describe('outbound bridge — delivery intent across the messages seam (#5645 review)', () => {
  const tenantId = '44444444-4444-4444-8444-444444444444'
  const organizationId = '55555555-5555-4555-8555-555555555555'
  const threadId = '22222222-2222-4222-8222-222222222222'
  const inboundMessageId = '11111111-1111-4111-8111-111111111111'
  const composedMessageId = '33333333-3333-4333-8333-333333333333'
  const operatorUserId = '66666666-6666-4666-8666-666666666666'
  const colleagueUserId = '99999999-9999-4999-8999-999999999999'
  const systemUserId = '00000000-0000-0000-0000-000000000000'
  const externalConversationId = '77777777-7777-4777-8777-777777777777'

  function inboundMessage(overrides: Record<string, unknown> = {}) {
    return {
      id: inboundMessageId,
      threadId,
      parentMessageId: null,
      senderUserId: systemUserId,
      subject: 'Where is my order?',
      body: 'Where is my order?',
      type: 'channel.discord',
      visibility: 'public',
      sourceEntityType: 'communication_channels.external_conversation',
      sourceEntityId: externalConversationId,
      externalEmail: null,
      externalName: 'discord-user',
      bodyFormat: 'text',
      priority: 'normal',
      sentAt: new Date('2026-08-26T10:00:00.000Z'),
      createdAt: new Date('2026-08-26T10:00:00.000Z'),
      deletedAt: null,
      tenantId,
      organizationId,
      ...overrides,
    }
  }

  /** Container the `messages` commands run against — records what they compose. */
  function makeMessagesContainer(
    original: Record<string, unknown>,
    recipientUserIds: string[] = [operatorUserId],
  ) {
    const created: Record<string, unknown>[] = []
    const trx = {
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
        if (entity !== Message) return { ...data }
        const row = { id: composedMessageId, ...data }
        created.push(row)
        return row
      }),
      persist: jest.fn(function persist(this: unknown) { return this }),
      flush: jest.fn(async () => {}),
      find: jest.fn(async () => []),
      // `messages.messages.compose` resolves the parent inside the transaction to
      // inherit its thread; reply and forward resolve it on the outer fork.
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => (
        entity === Message && where.id === original.id ? original : null
      )),
    }
    const emFork = {
      // The conversation is assigned to the operator, which is what gives them a
      // `message_recipients` row on the inbound message and lets them forward or
      // reply without the channel-thread fallback — the review's own scenario.
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === Message) return where.id === original.id ? original : null
        if (entity === MessageRecipient && recipientUserIds.includes(where.recipientUserId as string)) {
          return { messageId: original.id, recipientUserId: where.recipientUserId, status: 'read', deletedAt: null }
        }
        return null
      }),
      find: jest.fn(async () => []),
      transactional: jest.fn(async (callback: (em: typeof trx) => Promise<void>) => callback(trx)),
      fork: jest.fn(),
    }
    // The hub resolves this thread as channel-mapped, as it is in production.
    const resolveChannelThreadAccess = jest.fn(async () => ({
      messageThreadId: threadId,
      externalConversationId,
      channelId: 'ch-1',
      channelType: 'discord',
      canAccess: true,
    }))
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => emFork }
        if (name === 'communicationChannelsResolveChannelThreadAccess') return resolveChannelThreadAccess
        return null
      },
    }
    return { container, created }
  }

  /** Container the subscriber runs against — a shared channel with nothing delivered yet. */
  function makeBridgeContainer(composed: Record<string, unknown>) {
    const findOne = jest.fn()
    findOne.mockResolvedValueOnce(composed) // Message re-fetch
    findOne.mockResolvedValueOnce({ id: 'mapping-1', messageThreadId: threadId, channelId: 'ch-1' })
    findOne.mockResolvedValueOnce(null) // no MessageChannelLink yet
    findOne.mockResolvedValueOnce({ id: 'ch-1', userId: null }) // shared channel
    return {
      container: {
        resolve: ((name: string) => (name === 'em' ? { fork: () => ({ findOne }) } : null)) as <T>(name: string) => T,
      },
    }
  }

  function sentEventPayload(): Record<string, unknown> {
    const call = emitMessagesEventMock.mock.calls.find(([eventId]) => eventId === 'messages.message.sent')
    if (!call) throw new Error('[internal] the command emitted no messages.message.sent event')
    return call[1] as Record<string, unknown>
  }

  beforeEach(() => jest.clearAllMocks())

  it('does not deliver a forward of a channel message to the external correspondent', async () => {
    const original = inboundMessage()
    const { container, created } = makeMessagesContainer(original)

    await commandRegistry.get('messages.messages.forward')!.execute(
      {
        messageId: inboundMessageId,
        recipients: [{ userId: colleagueUserId, type: 'to' }],
        additionalBody: 'This customer is a known chargeback risk — how do we answer?',
        sendViaEmail: false,
        includeAttachments: false,
        tenantId,
        organizationId,
        userId: operatorUserId,
      },
      { container, auth: { features: ['messages.compose'] } } as never,
    )

    const forwardRow = created[0]
    // The forward really does look like an operator message in the channel thread —
    // which is why the origin test alone could not tell it apart.
    expect(forwardRow.sourceEntityType).toBe('communication_channels.external_conversation')
    expect(forwardRow.threadId).toBe(threadId)
    expect(forwardRow.senderUserId).toBe(operatorUserId)
    expect(forwardRow.visibility).toBe('internal')

    await bridgeHandler(
      sentEventPayload() as never,
      makeBridgeContainer(forwardRow) as never,
    )

    expect(enqueueMock).not.toHaveBeenCalled()
  })

  async function forwardInboundToColleague(
    original: Record<string, unknown> = inboundMessage(),
  ): Promise<Record<string, unknown>> {
    const { container, created } = makeMessagesContainer(original)
    await commandRegistry.get('messages.messages.forward')!.execute(
      {
        messageId: inboundMessageId,
        recipients: [{ userId: colleagueUserId, type: 'to' }],
        additionalBody: 'Fishing for a refund, I think.',
        sendViaEmail: false,
        includeAttachments: false,
        tenantId,
        organizationId,
        userId: operatorUserId,
      },
      { container, auth: { features: ['messages.compose'] } } as never,
    )
    jest.clearAllMocks()
    return { ...created[0], id: '88888888-8888-4888-8888-888888888888' }
  }

  /**
   * #6431: replies copy their parent's visibility and carry no `forwardedFrom`,
   * so a public forward made every reply written under it deliverable — the
   * operators' discussion of the customer reached the customer's chat.
   */
  it.each([
    ['the forwarding owner', operatorUserId, [] as string[]],
    ['the colleague the forward was addressed to', colleagueUserId, [colleagueUserId]],
  ])('does not deliver a reply by %s under a forward of a channel message', async (_label, replierUserId, recipientUserIds) => {
    const forwardRow = await forwardInboundToColleague()
    const { container, created } = makeMessagesContainer(forwardRow, recipientUserIds)

    await commandRegistry.get('messages.messages.reply')!.execute(
      {
        messageId: forwardRow.id,
        body: 'I think they are lying. Stall them.',
        bodyFormat: 'text',
        sendViaEmail: false,
        replyAll: false,
        tenantId,
        organizationId,
        userId: replierUserId,
      },
      { container, auth: { features: ['messages.compose'] } } as never,
    )

    const replyRow = created[0]
    expect(replyRow.threadId).toBe(threadId)
    expect(replyRow.sourceEntityType).toBe('communication_channels.external_conversation')
    expect(replyRow.visibility).toBe('internal')

    await bridgeHandler(
      sentEventPayload() as never,
      makeBridgeContainer(replyRow) as never,
    )

    expect(enqueueMock).not.toHaveBeenCalled()
  })

  // The bridge routes on the thread, not the source type: an AI auto-reply or a
  // parented compose is public on the channel thread with no source type, and a
  // forward of it must stay internal just the same.
  it('does not deliver a reply under a forward of a channel-thread message that has no source type', async () => {
    const forwardRow = await forwardInboundToColleague(
      inboundMessage({ senderUserId: operatorUserId, sourceEntityType: null, sourceEntityId: null }),
    )
    expect(forwardRow.visibility).toBe('internal')
    expect(forwardRow.externalName).toBeNull()

    const { container, created } = makeMessagesContainer(forwardRow, [colleagueUserId])
    await commandRegistry.get('messages.messages.reply')!.execute(
      {
        messageId: forwardRow.id,
        body: 'The bot promised a refund; we should walk that back.',
        bodyFormat: 'text',
        sendViaEmail: false,
        replyAll: false,
        tenantId,
        organizationId,
        userId: colleagueUserId,
      },
      { container, auth: { features: ['messages.compose'] } } as never,
    )

    expect(created[0].visibility).toBe('internal')
    await bridgeHandler(
      sentEventPayload() as never,
      makeBridgeContainer(created[0]) as never,
    )
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('does not deliver an internal-visibility message composed into the channel thread', async () => {
    const original = inboundMessage({ visibility: 'internal' })
    const { container, created } = makeMessagesContainer(original)

    await commandRegistry.get('messages.messages.reply')!.execute(
      {
        messageId: inboundMessageId,
        body: 'Internal note: do not answer until legal signs off.',
        bodyFormat: 'text',
        sendViaEmail: false,
        replyAll: false,
        tenantId,
        organizationId,
        userId: operatorUserId,
      },
      { container, auth: { features: ['messages.compose'] } } as never,
    )

    const internalRow = created[0]
    expect(internalRow.visibility).toBe('internal')
    expect(internalRow.parentMessageId).toBe(inboundMessageId)

    await bridgeHandler(
      sentEventPayload() as never,
      makeBridgeContainer(internalRow) as never,
    )

    expect(enqueueMock).not.toHaveBeenCalled()
  })

  /**
   * @pkarw's re-review minor: the intent guard originally asked
   * `visibility === 'internal'`, while the messages module's own convention is
   * that an ABSENT visibility is internal (`data/validators.ts` refines a compose
   * under `value.visibility ?? 'internal'`, `composeMessageCommand` persists
   * `input.visibility ?? null`). A caller that omits the field therefore files a
   * note the module validated as internal, stored as `null`, and threaded onto
   * the channel conversation — which the old polarity read as public and
   * delivered to the correspondent.
   */
  it('does not deliver a channel-thread compose that omits visibility entirely', async () => {
    const original = inboundMessage()
    const { container, created } = makeMessagesContainer(original)

    await commandRegistry.get('messages.messages.compose')!.execute(
      {
        type: 'channel.discord',
        subject: 'Re: Where is my order?',
        body: 'Known chargeback risk — do not refund without approval.',
        bodyFormat: 'text',
        recipients: [{ userId: colleagueUserId, type: 'to' }],
        parentMessageId: inboundMessageId,
        sourceEntityType: 'communication_channels.external_conversation',
        sourceEntityId: externalConversationId,
        sendViaEmail: false,
        tenantId,
        organizationId,
        userId: operatorUserId,
      },
      { container, auth: { features: ['messages.compose'] } } as never,
    )

    const noteRow = created[0]
    expect(noteRow.visibility).toBeNull()
    expect(noteRow.threadId).toBe(threadId)

    await bridgeHandler(
      sentEventPayload() as never,
      makeBridgeContainer(noteRow) as never,
    )

    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('still delivers the operator public reply the fix exists for (#5535)', async () => {
    const original = inboundMessage()
    const { container, created } = makeMessagesContainer(original)

    await commandRegistry.get('messages.messages.reply')!.execute(
      {
        messageId: inboundMessageId,
        body: 'It ships tomorrow — sorry for the wait!',
        bodyFormat: 'text',
        sendViaEmail: false,
        replyAll: false,
        tenantId,
        organizationId,
        userId: operatorUserId,
      },
      { container, auth: { features: ['messages.compose'] } } as never,
    )

    await bridgeHandler(
      sentEventPayload() as never,
      makeBridgeContainer(created[0]) as never,
    )

    expect(enqueueMock).toHaveBeenCalledTimes(1)
    expect((enqueueMock.mock.calls[0][0] as { messageId: string }).messageId).toBe(composedMessageId)
  })
})
