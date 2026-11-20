import { Message, MessageExternalParticipant } from '@open-mercato/core/modules/messages/data/entities'

type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  buildLog?: (args: { input: unknown; result: unknown }) => Promise<Record<string, unknown>>
}

const mockRegisteredCommands = new Map<string, RegisteredCommand>()
const emitMessagesEventMock = jest.fn(async (_id: string, _payload: unknown, _options?: unknown) => {})
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const claimDueScheduledMessagesMock = jest.fn()
const invalidateCrudCacheMock = jest.fn(async () => {})
const createBatchMock = jest.fn(async () => [])
const settleExternalParticipantsMock = jest.fn(async (..._args: unknown[]) => ({ finished: true }))

jest.mock('@open-mercato/core/modules/messages/lib/externalEmailBudget', () => ({
  assertExternalEmailBudget: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: RegisteredCommand) => mockRegisteredCommands.set(command.id, command),
}))

jest.mock('@open-mercato/core/modules/messages/events', () => ({
  emitMessagesEvent: (id: string, payload: unknown, options?: unknown) => emitMessagesEventMock(id, payload, options),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...(args as [])),
}))

jest.mock('@open-mercato/core/modules/messages/lib/scheduledRelease', () => ({
  claimDueScheduledMessages: (...args: unknown[]) => claimDueScheduledMessagesMock(...args),
}))

jest.mock('@open-mercato/core/modules/notifications/lib/notificationService', () => ({
  resolveNotificationService: () => ({ createBatch: createBatchMock }),
}))

jest.mock('@open-mercato/core/modules/messages/lib/externalParticipants', () => ({
  ...jest.requireActual('@open-mercato/core/modules/messages/lib/externalParticipants'),
  settleExternalParticipants: (...args: unknown[]) => settleExternalParticipantsMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/attachments', () => ({
  linkAttachmentsToMessage: jest.fn(),
  linkLibraryAttachmentsToMessage: jest.fn(),
  copyAttachmentsForForwardMessages: jest.fn(),
}))

const messageId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const senderUserId = '44444444-4444-4444-8444-444444444444'
const recipientUserId = '55555555-5555-4555-8555-555555555555'
const senderChannelId = '66666666-6666-4666-8666-666666666666'
const scope = { tenantId, organizationId }

function inMinutes(minutes: number): Date {
  const date = new Date(Date.now() + minutes * 60_000)
  date.setUTCSeconds(0, 0)
  return date
}

function createEm() {
  const em: Record<string, jest.Mock> & { created: Array<{ entity: unknown; data: Record<string, unknown> }> } = {
    created: [],
    flush: jest.fn(async () => {}),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => 0),
    nativeUpdate: jest.fn(async () => 1),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const row = { ...data, ...(entity === Message ? { id: messageId } : {}) }
      em.created.push({ entity, data: row })
      return row
    }),
    persist: jest.fn(() => em),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    fork: jest.fn(() => em),
    transactional: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work(em)),
  } as never
  return em
}

function createCtx(em: ReturnType<typeof createEm>, services: Record<string, unknown> = {}) {
  const eventBus = { emitEvent: jest.fn(async () => {}) }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => em }
      if (name === 'eventBus') return eventBus
      if (name in services) return services[name]
      throw new Error(`Unknown dependency: ${name}`)
    }),
  }
  return {
    eventBus,
    ctx: {
      container: container as never,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    },
  }
}

function draftMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: messageId,
    threadId: null,
    senderUserId,
    type: 'default',
    visibility: 'internal',
    externalEmail: null,
    subject: 'Subject',
    body: 'Body',
    bodyFormat: 'text',
    priority: 'normal',
    status: 'draft',
    isDraft: true,
    sentAt: null,
    scheduledAt: null,
    scheduledReleaseAttempts: 0,
    sendViaEmail: false,
    tenantId,
    organizationId,
    deletedAt: null,
    ...overrides,
  } as Message
}

function command(id: string): RegisteredCommand {
  const registered = mockRegisteredCommands.get(id)
  expect(registered).toBeTruthy()
  return registered!
}

function eventIds(): string[] {
  return emitMessagesEventMock.mock.calls.map(([id]) => id)
}

describe('messages scheduled send commands', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockResolvedValue(null)
    findWithDecryptionMock.mockResolvedValue([])
  })

  describe('compose with scheduledAt', () => {
    it('stores a scheduled draft, emits messages.message.scheduled, indexes it for the author and does not send', async () => {
      const em = createEm()
      const { ctx, eventBus } = createCtx(em)
      const scheduledAt = inMinutes(60)

      const result = await command('messages.messages.compose').execute({
        recipients: [{ userId: recipientUserId, type: 'to' }],
        subject: 'Later',
        body: 'Body',
        scheduledAt: scheduledAt.toISOString(),
        ...scope,
        userId: senderUserId,
      }, ctx)

      const created = em.created.find((entry) => entry.entity === Message)?.data
      expect(created).toMatchObject({ status: 'scheduled', isDraft: true, sentAt: null, scheduledAt })
      expect(created?.threadId).toBeUndefined()
      expect(result).toMatchObject({ id: messageId, isDraft: true })
      expect(eventIds()).toEqual(['messages.message.scheduled'])
      expect(emitMessagesEventMock.mock.calls[0][1]).toEqual({
        messageId,
        senderUserId,
        scheduledAt: scheduledAt.toISOString(),
        recipientUserIds: [senderUserId],
        ...scope,
      })
      expect(eventBus.emitEvent).toHaveBeenCalledTimes(1)
      expect(eventBus.emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ entityType: 'messages:message' }), expect.anything())
    })

    it('rejects a schedule in the past at command validation', async () => {
      const em = createEm()
      const { ctx } = createCtx(em)
      await expect(command('messages.messages.compose').execute({
        recipients: [{ userId: recipientUserId, type: 'to' }],
        subject: 'Later',
        body: 'Body',
        scheduledAt: inMinutes(-5).toISOString(),
        ...scope,
        userId: senderUserId,
      }, ctx)).rejects.toThrow('messages.errors.scheduleInPast')
      expect(em.transactional).not.toHaveBeenCalled()
    })

    it('keeps the mailbox on a scheduled message without handing it to the channel', async () => {
      const em = createEm()
      const sendAsUser = jest.fn()
      const { ctx } = createCtx(em, { communicationChannelsSendAsUser: sendAsUser })

      await command('messages.messages.compose').execute({
        visibility: 'public',
        externalEmail: 'client@example.com',
        recipients: [],
        subject: 'Later',
        body: 'Body',
        senderChannelId,
        scheduledAt: inMinutes(60).toISOString(),
        ...scope,
        userId: senderUserId,
      }, ctx)

      expect(em.created.find((entry) => entry.entity === Message)?.data).toMatchObject({ status: 'scheduled', senderChannelId })
      expect(sendAsUser).not.toHaveBeenCalled()
      expect(eventIds()).toEqual(['messages.message.scheduled'])
    })
  })

  describe('update_draft scheduling transitions', () => {
    function setup(message: Message) {
      const em = createEm()
      const { ctx, eventBus } = createCtx(em)
      findOneWithDecryptionMock.mockResolvedValue(message)
      findWithDecryptionMock.mockResolvedValue([{ recipientUserId, recipientType: 'to', deletedAt: null }])
      return { em, ctx, eventBus }
    }

    it('reschedules a draft and emits messages.message.scheduled', async () => {
      const message = draftMessage({ scheduledReleaseAttempts: 2 })
      const { ctx, eventBus } = setup(message)
      const scheduledAt = inMinutes(120)

      await command('messages.messages.update_draft').execute({ messageId, scheduledAt, ...scope, userId: senderUserId }, ctx)

      expect(message).toMatchObject({ status: 'scheduled', isDraft: true, sentAt: null, scheduledAt, scheduledReleaseAttempts: 0 })
      expect(eventIds()).toEqual(['messages.message.scheduled'])
      expect(eventBus.emitEvent).toHaveBeenCalledTimes(1)
      expect(eventBus.emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ entityType: 'messages:message' }), expect.anything())
    })

    it('turns a scheduled message back into a plain draft on scheduledAt: null', async () => {
      const message = draftMessage({ status: 'scheduled', scheduledAt: inMinutes(30) })
      const { ctx } = setup(message)

      await command('messages.messages.update_draft').execute({ messageId, scheduledAt: null, ...scope, userId: senderUserId }, ctx)

      expect(message).toMatchObject({ status: 'draft', isDraft: true, scheduledAt: null })
      expect(emitMessagesEventMock).not.toHaveBeenCalled()
    })

    it('"Send now" sends a scheduled message immediately and clears scheduledAt', async () => {
      const message = draftMessage({ status: 'scheduled', scheduledAt: inMinutes(30) })
      const { em, ctx, eventBus } = setup(message)

      await command('messages.messages.update_draft').execute({ messageId, scheduledAt: null, isDraft: false, ...scope, userId: senderUserId }, ctx)

      expect(message).toMatchObject({ status: 'sent', isDraft: false, scheduledAt: null, threadId: messageId })
      expect(message.sentAt).toBeInstanceOf(Date)
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        MessageExternalParticipant,
        { messageId, ...scope, deliveryStatus: null },
        { deliveryStatus: 'pending' },
      )
      expect(eventIds()).toEqual(['messages.message.sent'])
      expect(eventBus.emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ recordId: messageId }), expect.anything())
    })

    it('refuses to schedule a draft that would not be sendable', async () => {
      const message = draftMessage({ subject: '  ' })
      const { em, ctx } = setup(message)

      await expect(command('messages.messages.update_draft').execute({ messageId, scheduledAt: inMinutes(10), ...scope, userId: senderUserId }, ctx))
        .rejects.toThrow('subject is required')
      expect(em.flush).not.toHaveBeenCalled()
    })
  })

  it.each([
    ['messages.messages.reply', { body: 'Answer' }],
    ['messages.messages.forward', { recipients: [{ userId: recipientUserId, type: 'to' }] }],
  ])('%s refuses a draft or scheduled message', async (commandId, extra) => {
    const em = createEm()
    const { ctx } = createCtx(em)
    findOneWithDecryptionMock.mockResolvedValue(draftMessage({ status: 'scheduled', scheduledAt: inMinutes(30) }))
    await expect(command(commandId).execute({ messageId, ...extra, ...scope, userId: senderUserId }, ctx))
      .rejects.toThrow('Message not found')
    expect(em.transactional).not.toHaveBeenCalled()
  })

  describe('release_scheduled', () => {
    function setup() {
      const em = createEm()
      const { ctx, eventBus } = createCtx(em)
      findOneWithDecryptionMock.mockResolvedValue(draftMessage({ status: 'sent', isDraft: false, sentAt: new Date(), threadId: messageId }))
      findWithDecryptionMock.mockResolvedValue([{ recipientUserId }])
      return { em, ctx, eventBus }
    }

    it('hands a claimed message off like a draft send and emits messages.message.sent last', async () => {
      const { em, ctx, eventBus } = setup()
      claimDueScheduledMessagesMock.mockResolvedValue([{ id: messageId, scheduledAt: new Date(), attempts: 1 }])

      const result = await command('messages.messages.release_scheduled').execute(scope, ctx)

      expect(result).toEqual({ released: [messageId], reverted: [], returnedToDraft: [] })
      expect(claimDueScheduledMessagesMock).toHaveBeenCalledWith(em, scope)
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        MessageExternalParticipant,
        { messageId, ...scope, deliveryStatus: null },
        { deliveryStatus: 'pending' },
      )
      expect(em.nativeUpdate).toHaveBeenCalledWith(Message, { id: messageId, ...scope, threadId: null }, { threadId: messageId })
      expect(eventBus.emitEvent).toHaveBeenCalledWith('query_index.upsert_one', expect.objectContaining({ recordId: messageId }), expect.anything())
      expect(invalidateCrudCacheMock).toHaveBeenCalledWith(ctx.container, 'messages.message', { id: messageId, ...scope }, tenantId, expect.any(String))
      expect(eventIds()).toEqual(['messages.message.sent'])
      expect(emitMessagesEventMock.mock.calls[0][1]).toMatchObject({ messageId, recipientUserIds: [recipientUserId], senderUserId })
      const sentOrder = emitMessagesEventMock.mock.invocationCallOrder[0]
      expect(sentOrder).toBeGreaterThan(invalidateCrudCacheMock.mock.invocationCallOrder[0])
    })

    it('skips the audit log when nothing was due', async () => {
      const { ctx } = setup()
      claimDueScheduledMessagesMock.mockResolvedValue([])
      const cmd = command('messages.messages.release_scheduled')
      const result = await cmd.execute(scope, ctx)
      await expect(cmd.buildLog!({ input: scope, result })).resolves.toEqual({ skipLog: true })
      expect(emitMessagesEventMock).not.toHaveBeenCalled()
    })

    it('reverts a failed hand-off to scheduled for the next tick', async () => {
      const { em, ctx } = setup()
      const scheduledAt = inMinutes(-1)
      claimDueScheduledMessagesMock.mockResolvedValue([{ id: messageId, scheduledAt, attempts: 1 }])
      emitMessagesEventMock.mockRejectedValueOnce(new Error('bus down'))

      const result = await command('messages.messages.release_scheduled').execute(scope, ctx)

      expect(result).toEqual({ released: [], reverted: [messageId], returnedToDraft: [] })
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        Message,
        { id: messageId, ...scope, status: 'sent' },
        { status: 'scheduled', isDraft: true, sentAt: null, scheduledAt },
      )
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        MessageExternalParticipant,
        { messageId, ...scope, deliveryStatus: 'pending' },
        { deliveryStatus: null },
      )
      expect(createBatchMock).not.toHaveBeenCalled()
    })

    it('returns the message to drafts and notifies the author after the attempt cap', async () => {
      const { em, ctx } = setup()
      claimDueScheduledMessagesMock.mockResolvedValue([{ id: messageId, scheduledAt: inMinutes(-1), attempts: 3 }])
      emitMessagesEventMock.mockRejectedValueOnce(new Error('bus down'))

      const result = await command('messages.messages.release_scheduled').execute(scope, ctx)

      expect(result).toEqual({ released: [], reverted: [], returnedToDraft: [messageId] })
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        Message,
        { id: messageId, ...scope, status: 'sent' },
        { status: 'draft', isDraft: true, sentAt: null, scheduledAt: null },
      )
      expect(createBatchMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'messages.scheduled_send_failed', recipientUserIds: [senderUserId], sourceEntityId: messageId }),
        scope,
      )
    })
  })
  describe('mailbox sender', () => {
    const publicDraft = (overrides: Partial<Message> = {}) => draftMessage({
      visibility: 'public',
      externalEmail: 'client@example.com',
      senderChannelId,
      ...overrides,
    })

    describe('update_draft send', () => {
      function setup(message: Message, sendAsUserResult: unknown) {
        const em = createEm()
        const sendAsUser = jest.fn(async () => sendAsUserResult)
        const { ctx } = createCtx(em, { communicationChannelsSendAsUser: sendAsUser })
        findOneWithDecryptionMock.mockResolvedValue(message)
        findWithDecryptionMock.mockResolvedValue([])
        return { em, ctx, sendAsUser }
      }

      it('hands the sent draft to the stored mailbox before emitting messages.message.sent', async () => {
        const message = publicDraft()
        const { ctx, sendAsUser } = setup(message, { ok: true, messageId, threadId: messageId, channelId: senderChannelId, providerKey: 'imap' })

        await command('messages.messages.update_draft').execute({ messageId, isDraft: false, ...scope, userId: senderUserId }, ctx)

        expect(sendAsUser).toHaveBeenCalledWith(
          ctx.container,
          expect.objectContaining({ userId: senderUserId, ...scope }),
          { userChannelId: senderChannelId, messageId },
        )
        expect(eventIds()).toEqual(['messages.message.sent'])
        expect(emitMessagesEventMock.mock.invocationCallOrder[0]).toBeGreaterThan(sendAsUser.mock.invocationCallOrder[0])
      })

      it('prefers the mailbox from the request and stores it on the draft', async () => {
        const otherChannelId = '77777777-7777-4777-8777-777777777777'
        const message = publicDraft()
        const { ctx, sendAsUser } = setup(message, { ok: true, messageId, threadId: messageId, channelId: otherChannelId, providerKey: 'imap' })

        await command('messages.messages.update_draft').execute({ messageId, isDraft: false, senderChannelId: otherChannelId, ...scope, userId: senderUserId }, ctx)

        expect(message.senderChannelId).toBe(otherChannelId)
        expect(sendAsUser).toHaveBeenCalledWith(expect.anything(), expect.anything(), { userChannelId: otherChannelId, messageId })
      })

      it('puts a refused send back to the previous state and surfaces the error', async () => {
        const scheduledAt = inMinutes(30)
        const message = publicDraft({ status: 'scheduled', scheduledAt })
        const { em, ctx } = setup(message, {
          ok: false,
          status: 422,
          error: 'Channel requires re-authentication',
          code: 'channel_unavailable',
        })

        await expect(command('messages.messages.update_draft').execute({ messageId, scheduledAt: null, isDraft: false, ...scope, userId: senderUserId }, ctx))
          .rejects.toMatchObject({ status: 422, body: { fieldErrors: { senderChannelId: 'Channel requires re-authentication' } } })

        expect(em.nativeUpdate).toHaveBeenCalledWith(
          Message,
          { id: messageId, ...scope },
          { status: 'scheduled', isDraft: true, sentAt: null, scheduledAt },
        )
        expect(em.nativeUpdate).toHaveBeenCalledWith(
          MessageExternalParticipant,
          { messageId, ...scope, deliveryStatus: 'pending' },
          { deliveryStatus: null },
        )
        expect(emitMessagesEventMock).not.toHaveBeenCalled()
      })
    })

    describe('release_scheduled', () => {
      function setup(services: Record<string, unknown>) {
        const em = createEm()
        const { ctx } = createCtx(em, services)
        findOneWithDecryptionMock.mockResolvedValue(publicDraft({ status: 'sent', isDraft: false, sentAt: new Date(), threadId: messageId }))
        findWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => (
          entity === MessageExternalParticipant ? [{ id: 'participant-1' }, { id: 'participant-2' }] : []
        ))
        claimDueScheduledMessagesMock.mockResolvedValue([{ id: messageId, scheduledAt: inMinutes(-1), attempts: 1 }])
        return { em, ctx }
      }

      it('hands a released message to the mailbox and emits messages.message.sent once, last', async () => {
        const sendAsUser = jest.fn(async () => ({ ok: true, messageId, threadId: messageId, channelId: senderChannelId, providerKey: 'imap' }))
        const { ctx } = setup({ communicationChannelsSendAsUser: sendAsUser })

        const result = await command('messages.messages.release_scheduled').execute(scope, ctx)

        expect(result).toEqual({ released: [messageId], reverted: [], returnedToDraft: [] })
        expect(sendAsUser).toHaveBeenCalledWith(ctx.container, expect.objectContaining({ userId: senderUserId, ...scope }), { userChannelId: senderChannelId, messageId })
        expect(eventIds()).toEqual(['messages.message.sent'])
        expect(emitMessagesEventMock.mock.invocationCallOrder[0]).toBeGreaterThan(sendAsUser.mock.invocationCallOrder[0])
        expect(settleExternalParticipantsMock).not.toHaveBeenCalled()
      })

      it('counts "already linked" from a previous attempt as released', async () => {
        const sendAsUser = jest.fn(async () => ({ ok: false, status: 409, error: 'already linked', code: 'already_linked' }))
        const { ctx } = setup({ communicationChannelsSendAsUser: sendAsUser })

        const result = await command('messages.messages.release_scheduled').execute(scope, ctx)

        expect(result).toEqual({ released: [messageId], reverted: [], returnedToDraft: [] })
        expect(eventIds()).toEqual(['messages.message.sent'])
      })

      it.each([
        ['the channel requires re-authentication', { communicationChannelsSendAsUser: jest.fn(async () => ({ ok: false, status: 422, error: 'reauth', code: 'channel_unavailable' })) }],
        ['the channels module is absent', {}],
      ])('fails the participants without reverting when %s', async (_case, services) => {
        const { em, ctx } = setup(services)

        const result = await command('messages.messages.release_scheduled').execute(scope, ctx)

        expect(result).toEqual({ released: [messageId], reverted: [], returnedToDraft: [] })
        expect(em.nativeUpdate).toHaveBeenCalledWith(
          Message,
          { id: messageId, ...scope },
          { sourceEntityType: 'communication_channels.send_as_user', sourceEntityId: senderChannelId },
        )
        expect(settleExternalParticipantsMock).toHaveBeenCalledWith(
          em,
          { messageId, ...scope },
          { failed: [{ id: 'participant-1', error: 'mailbox unavailable' }, { id: 'participant-2', error: 'mailbox unavailable' }] },
          { pendingOnly: true },
        )
        expect(eventIds()).toEqual(['messages.message.sent'])
      })

      it('reverts the release when the mailbox refuses for another reason', async () => {
        const sendAsUser = jest.fn(async () => ({ ok: false, status: 500, error: '[internal] boom' }))
        const { em, ctx } = setup({ communicationChannelsSendAsUser: sendAsUser })

        const result = await command('messages.messages.release_scheduled').execute(scope, ctx)

        expect(result).toEqual({ released: [], reverted: [messageId], returnedToDraft: [] })
        expect(em.nativeUpdate).toHaveBeenCalledWith(
          Message,
          { id: messageId, ...scope, status: 'sent' },
          expect.objectContaining({ status: 'scheduled', isDraft: true }),
        )
        expect(emitMessagesEventMock).not.toHaveBeenCalled()
      })
    })
  })
})
