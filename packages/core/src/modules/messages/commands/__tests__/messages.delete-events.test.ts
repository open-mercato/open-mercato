import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  undo?: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
}

const mockRegisteredCommands = new Map<string, RegisteredCommand>()
const mockRegisterCommand = jest.fn((command: RegisteredCommand) => {
  mockRegisteredCommands.set(command.id, command)
})
const emitMessagesEventMock = jest.fn(async () => {})
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const extractUndoPayloadMock = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: RegisteredCommand) => mockRegisterCommand(command),
}))

jest.mock('@open-mercato/core/modules/messages/events', () => ({
  emitMessagesEvent: (...args: unknown[]) => emitMessagesEventMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/undo', () => ({
  extractUndoPayload: (...args: unknown[]) => extractUndoPayloadMock(...args),
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
const otherRecipientUserId = '66666666-6666-4666-8666-666666666666'

function buildContainer(emFork: Record<string, jest.Mock>) {
  const eventBus = { emitEvent: jest.fn(async () => {}) }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => emFork }
      if (name === 'eventBus') return eventBus
      throw new Error(`Unknown dependency: ${name}`)
    }),
  }
  return { container, eventBus }
}

describe('messages.message.deleted event audience', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('compose undo emits a global deletion event covering sender + recipients', async () => {
    const command = mockRegisteredCommands.get('messages.messages.compose')
    expect(command?.undo).toBeTruthy()

    const message = { id: messageId, deletedAt: null } as Message
    const emFork = {
      findOne: jest.fn(async () => message),
      flush: jest.fn(async () => {}),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => {}),
      persist: jest.fn(),
      remove: jest.fn(),
      create: jest.fn(),
    }
    const { container } = buildContainer(emFork)

    extractUndoPayloadMock.mockReturnValue({
      after: {
        message: {
          id: messageId,
          tenantId,
          organizationId,
          senderUserId,
          isDraft: false,
        },
        recipients: [
          { recipientUserId },
          { recipientUserId: otherRecipientUserId },
        ],
      },
    })

    await command!.undo!({
      logEntry: {},
      ctx: { container: container as never },
    })

    expect(message.deletedAt).toBeInstanceOf(Date)
    expect(emitMessagesEventMock).toHaveBeenCalledTimes(1)
    const [eventName, payload, options] = emitMessagesEventMock.mock.calls[0]
    expect(eventName).toBe('messages.message.deleted')
    expect(options).toEqual({ persistent: true })
    expect(payload).toMatchObject({
      messageId,
      actorUserId: senderUserId,
      target: 'global',
      tenantId,
      organizationId,
    })
    const audience = (payload as { recipientUserIds: string[] }).recipientUserIds
    expect(audience).toEqual(expect.arrayContaining([senderUserId, recipientUserId, otherRecipientUserId]))
    expect(audience).toHaveLength(3)
  })

  it('compose undo of a draft does not emit a deletion event (recipients never saw it)', async () => {
    const command = mockRegisteredCommands.get('messages.messages.compose')
    const message = { id: messageId, deletedAt: null } as Message
    const emFork = {
      findOne: jest.fn(async () => message),
      flush: jest.fn(async () => {}),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => {}),
      persist: jest.fn(),
      remove: jest.fn(),
      create: jest.fn(),
    }
    const { container } = buildContainer(emFork)

    extractUndoPayloadMock.mockReturnValue({
      after: {
        message: {
          id: messageId,
          tenantId,
          organizationId,
          senderUserId,
          isDraft: true,
        },
        recipients: [],
      },
    })

    await command!.undo!({
      logEntry: {},
      ctx: { container: container as never },
    })

    expect(emitMessagesEventMock).not.toHaveBeenCalled()
  })

  it('reply undo emits a global deletion event for the reply recipients', async () => {
    const command = mockRegisteredCommands.get('messages.messages.reply')
    expect(command?.undo).toBeTruthy()

    const message = { id: messageId, deletedAt: null } as Message
    const emFork = {
      findOne: jest.fn(async () => message),
      flush: jest.fn(async () => {}),
      find: jest.fn(async () => []),
      nativeDelete: jest.fn(async () => {}),
      persist: jest.fn(),
      remove: jest.fn(),
      create: jest.fn(),
    }
    const { container } = buildContainer(emFork)

    extractUndoPayloadMock.mockReturnValue({
      after: {
        message: {
          id: messageId,
          tenantId,
          organizationId,
          senderUserId,
        },
        recipients: [{ recipientUserId }],
      },
    })

    await command!.undo!({
      logEntry: {},
      ctx: { container: container as never },
    })

    expect(message.deletedAt).toBeInstanceOf(Date)
    expect(emitMessagesEventMock).toHaveBeenCalledTimes(1)
    const [, payload] = emitMessagesEventMock.mock.calls[0]
    expect(payload).toMatchObject({
      messageId,
      target: 'global',
      actorUserId: senderUserId,
    })
    expect((payload as { recipientUserIds: string[] }).recipientUserIds).toEqual(
      expect.arrayContaining([senderUserId, recipientUserId]),
    )
  })

  it('delete_for_actor by sender emits a global deletion event so recipients invalidate stale UIs', async () => {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')
    expect(command?.execute).toBeTruthy()

    const message = {
      id: messageId,
      tenantId,
      organizationId,
      senderUserId,
      deletedAt: null,
    } as Message

    findOneWithDecryptionMock.mockResolvedValueOnce(message)

    const recipientRows = [
      { recipientUserId, messageId } as MessageRecipient,
      { recipientUserId: otherRecipientUserId, messageId } as MessageRecipient,
    ]

    const emFork = {
      findOne: jest.fn(async (entity: unknown) => {
        if (entity === MessageRecipient) return null
        return null
      }),
      find: jest.fn(async () => recipientRows),
      flush: jest.fn(async () => {}),
      nativeDelete: jest.fn(async () => {}),
      persist: jest.fn(),
      remove: jest.fn(),
      create: jest.fn(),
    }
    const { container } = buildContainer(emFork)

    const input = {
      messageId,
      tenantId,
      organizationId,
      userId: senderUserId,
    }

    await command!.execute(input, {
      container: container as never,
      auth: { sub: senderUserId, tenantId } as never,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    } as never)

    expect(message.deletedAt).toBeInstanceOf(Date)
    expect(emitMessagesEventMock).toHaveBeenCalledTimes(1)
    const [eventName, payload] = emitMessagesEventMock.mock.calls[0]
    expect(eventName).toBe('messages.message.deleted')
    expect(payload).toMatchObject({
      messageId,
      actorUserId: senderUserId,
      target: 'global',
      tenantId,
      organizationId,
    })
    const audience = (payload as { recipientUserIds: string[] }).recipientUserIds
    expect(audience).toEqual(expect.arrayContaining([senderUserId, recipientUserId, otherRecipientUserId]))
    expect(audience).toHaveLength(3)
  })

  it('delete_for_actor by recipient still keeps actor-only audience', async () => {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')

    const message = {
      id: messageId,
      tenantId,
      organizationId,
      senderUserId,
      deletedAt: null,
    } as Message

    findOneWithDecryptionMock.mockResolvedValueOnce(message)

    const ownRecipient = {
      id: 'rec-1',
      recipientUserId,
      messageId,
      status: 'unread',
      deletedAt: null,
    } as unknown as MessageRecipient

    const emFork = {
      findOne: jest.fn(async () => ownRecipient),
      find: jest.fn(async () => [ownRecipient]),
      flush: jest.fn(async () => {}),
      nativeDelete: jest.fn(async () => {}),
      persist: jest.fn(),
      remove: jest.fn(),
      create: jest.fn(),
    }
    const { container } = buildContainer(emFork)

    const input = {
      messageId,
      tenantId,
      organizationId,
      userId: recipientUserId,
    }

    await command!.execute(input, {
      container: container as never,
      auth: { sub: recipientUserId, tenantId } as never,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    } as never)

    expect(ownRecipient.status).toBe('deleted')
    expect(message.deletedAt).toBeNull()
    expect(emitMessagesEventMock).toHaveBeenCalledTimes(1)
    const [, payload] = emitMessagesEventMock.mock.calls[0]
    expect(payload).toMatchObject({
      messageId,
      actorUserId: recipientUserId,
      target: 'recipient',
      recipientUserId,
    })
    expect((payload as { recipientUserIds?: string[] }).recipientUserIds).toBeUndefined()
  })
})
