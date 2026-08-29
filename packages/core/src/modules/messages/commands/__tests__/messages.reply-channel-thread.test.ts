import '@open-mercato/core/modules/messages/commands/messages'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

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
 * #5535 — an inbound channel message has the channel system user as its sender
 * and, on an unassigned conversation, no recipient rows at all. The
 * sender-or-recipient reply guard therefore denied every operator, tenant admin
 * included, so nobody could answer what a channel delivered.
 */
describe('messages.messages.reply on a channel-linked thread (#5535)', () => {
  const inboundMessageId = '11111111-1111-4111-8111-111111111111'
  const threadId = '22222222-2222-4222-8222-222222222222'
  const replyMessageId = '33333333-3333-4333-8333-333333333333'
  const tenantId = '44444444-4444-4444-8444-444444444444'
  const organizationId = '55555555-5555-4555-8555-555555555555'
  const operatorUserId = '66666666-6666-4666-8666-666666666666'
  const systemUserId = '00000000-0000-0000-0000-000000000000'

  const inboundMessage = {
    id: inboundMessageId,
    threadId,
    senderUserId: systemUserId,
    subject: 'Incoming from Discord',
    type: 'channel.discord',
    visibility: 'public',
    sourceEntityType: 'communication_channels.external_conversation',
    sourceEntityId: '77777777-7777-4777-8777-777777777777',
    externalEmail: null,
    externalName: 'discord-user',
    bodyFormat: 'text',
    priority: 'normal',
    deletedAt: null,
    tenantId,
    organizationId,
  }

  function makeContainer(channelThreadAccess: unknown, options: { registered?: boolean } = {}) {
    const trx = {
      create: jest.fn((entity: unknown, data: Record<string, unknown>) => (
        entity === Message ? { id: replyMessageId, ...data } : { ...data }
      )),
      persist: jest.fn(function persist(this: unknown) { return this }),
      flush: jest.fn(async () => {}),
    }

    const emFork = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === Message && where.id === inboundMessageId) return inboundMessage
        return null
      }),
      find: jest.fn(async () => []),
      transactional: jest.fn(async (callback: (em: typeof trx) => Promise<void>) => callback(trx)),
      fork: jest.fn(),
    }

    const resolveChannelThreadAccess = jest.fn(async () => channelThreadAccess)
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => emFork }
        if (name === 'eventBus') return { emitEvent: jest.fn(async () => {}) }
        if (name === 'communicationChannelsResolveChannelThreadAccess') {
          if (options.registered === false) throw new Error('[internal] service not registered')
          return resolveChannelThreadAccess
        }
        return null
      },
    }
    return { container, trx, resolveChannelThreadAccess }
  }

  function replyInput() {
    return {
      messageId: inboundMessageId,
      body: 'Thanks for reaching out',
      bodyFormat: 'text' as const,
      sendViaEmail: false,
      replyAll: false,
      tenantId,
      organizationId,
      userId: operatorUserId,
    }
  }

  function commandCtx(container: unknown, features: string[]) {
    return {
      container,
      auth: { features },
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    }
  }

  beforeEach(() => jest.clearAllMocks())

  it('lets an operator reply when the channel behind the thread grants access', async () => {
    const command = commandRegistry.get('messages.messages.reply')
    const { container, trx, resolveChannelThreadAccess } = makeContainer({
      messageThreadId: threadId,
      externalConversationId: '77777777-7777-4777-8777-777777777777',
      channelId: '88888888-8888-4888-8888-888888888888',
      channelType: 'discord',
      canAccess: true,
    })

    const result = await command!.execute(
      replyInput(),
      commandCtx(container, ['messages.compose']) as never,
    )

    expect((result as { id: string }).id).toBe(replyMessageId)
    expect(resolveChannelThreadAccess).toHaveBeenCalledWith(
      container,
      { tenantId, organizationId },
      { messageThreadId: threadId },
      { userId: operatorUserId, features: ['messages.compose'] },
    )
    const replyRow = trx.create.mock.calls.find(([entity]) => entity === Message)?.[1] as Record<string, unknown>
    expect(replyRow.threadId).toBe(threadId)
    expect(replyRow.parentMessageId).toBe(inboundMessageId)
    expect(replyRow.senderUserId).toBe(operatorUserId)
  })

  it('still denies a caller the channel itself refuses (personal mailbox of another user)', async () => {
    const command = commandRegistry.get('messages.messages.reply')
    const { container } = makeContainer({
      messageThreadId: threadId,
      externalConversationId: '77777777-7777-4777-8777-777777777777',
      channelId: '88888888-8888-4888-8888-888888888888',
      channelType: 'email',
      canAccess: false,
    })

    await expect(
      command!.execute(replyInput(), commandCtx(container, ['messages.compose']) as never),
    ).rejects.toThrow('Access denied')
  })

  it('keeps denying a non-participant on an internal thread', async () => {
    const command = commandRegistry.get('messages.messages.reply')
    const { container } = makeContainer(null)

    await expect(
      command!.execute(replyInput(), commandCtx(container, ['messages.compose']) as never),
    ).rejects.toThrow('Access denied')
  })

  it('keeps denying when the channels module is not installed', async () => {
    const command = commandRegistry.get('messages.messages.reply')
    const { container } = makeContainer(null, { registered: false })

    await expect(
      command!.execute(replyInput(), commandCtx(container, ['messages.compose']) as never),
    ).rejects.toThrow('Access denied')
  })

  it('does not consult the channel when the caller is already a participant', async () => {
    const command = commandRegistry.get('messages.messages.reply')
    const { container, resolveChannelThreadAccess } = makeContainer(null)
    const emFork = (container.resolve('em') as { fork: () => { findOne: jest.Mock } }).fork()
    emFork.findOne.mockImplementation(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === Message && where.id === inboundMessageId) {
        return { ...inboundMessage, senderUserId: operatorUserId }
      }
      if (entity === MessageRecipient) return null
      return null
    })

    await command!.execute(replyInput(), commandCtx(container, ['messages.compose']) as never)

    expect(resolveChannelThreadAccess).not.toHaveBeenCalled()
  })
})
