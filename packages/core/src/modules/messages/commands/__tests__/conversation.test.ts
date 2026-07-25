import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<{ ok: true; affectedCount: number }>
}

const mockRegisteredCommands = new Map<string, RegisteredCommand>()
const emitMessagesEventMock = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: RegisteredCommand) => {
    mockRegisteredCommands.set(command.id, command)
  },
}))

jest.mock('@open-mercato/core/modules/messages/events', () => ({
  emitMessagesEvent: (...args: unknown[]) => emitMessagesEventMock(...args),
}))

const anchorMessageId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const senderUserId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'

function buildContainer(recipientRows: Array<Partial<MessageRecipient>>) {
  const anchorMessage = {
    id: anchorMessageId,
    tenantId,
    organizationId,
    senderUserId,
    threadId: null,
    parentMessageId: null,
    deletedAt: null,
  } as unknown as Message

  const emFork = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === Message) return anchorMessage
      if (entity === MessageRecipient) return { messageId: anchorMessageId } as MessageRecipient
      return null
    }),
    find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === Message) {
        if (where && 'parentMessageId' in where) return []
        return [anchorMessage]
      }
      if (entity === MessageRecipient) return recipientRows
      return []
    }),
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<void>) => cb({
      find: jest.fn(async (entity: unknown) => (entity === MessageRecipient ? recipientRows : [])),
    })),
  }

  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => emFork }
      throw new Error(`Unknown dependency: ${name}`)
    }),
  }

  return { container }
}

function runInput() {
  return { anchorMessageId, tenantId, organizationId, userId }
}

describe('messages conversation read/archive toggle commands', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/conversation')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('unarchive_for_actor restores archived recipients and emits unarchived events', async () => {
    const command = mockRegisteredCommands.get('messages.conversation.unarchive_for_actor')
    expect(command).toBeTruthy()

    const recipient = {
      messageId: anchorMessageId,
      recipientUserId: userId,
      status: 'archived',
      archivedAt: new Date(),
      readAt: null,
    } as unknown as MessageRecipient
    const { container } = buildContainer([recipient])

    const result = await command!.execute(runInput(), { container: container as never })

    expect(result).toEqual({ ok: true, affectedCount: 1 })
    expect(recipient.archivedAt).toBeNull()
    expect(recipient.status).toBe('unread')
    expect(emitMessagesEventMock).toHaveBeenCalledTimes(1)
    expect(emitMessagesEventMock).toHaveBeenCalledWith(
      'messages.message.unarchived',
      expect.objectContaining({ messageId: anchorMessageId, recipientUserId: userId }),
      { persistent: true },
    )
  })

  it('unarchive_for_actor is a no-op when nothing is archived', async () => {
    const command = mockRegisteredCommands.get('messages.conversation.unarchive_for_actor')
    const recipient = {
      messageId: anchorMessageId,
      recipientUserId: userId,
      status: 'read',
      archivedAt: null,
      readAt: new Date(),
    } as unknown as MessageRecipient
    const { container } = buildContainer([recipient])

    const result = await command!.execute(runInput(), { container: container as never })

    expect(result).toEqual({ ok: true, affectedCount: 0 })
    expect(emitMessagesEventMock).not.toHaveBeenCalled()
  })

  it('mark_read_for_actor marks unread recipients read and emits read events', async () => {
    const command = mockRegisteredCommands.get('messages.conversation.mark_read_for_actor')
    expect(command).toBeTruthy()

    const recipient = {
      messageId: anchorMessageId,
      recipientUserId: userId,
      status: 'unread',
      archivedAt: null,
      readAt: null,
    } as unknown as MessageRecipient
    const { container } = buildContainer([recipient])

    const result = await command!.execute(runInput(), { container: container as never })

    expect(result).toEqual({ ok: true, affectedCount: 1 })
    expect(recipient.status).toBe('read')
    expect(recipient.readAt).toBeInstanceOf(Date)
    expect(emitMessagesEventMock).toHaveBeenCalledTimes(1)
    expect(emitMessagesEventMock).toHaveBeenCalledWith(
      'messages.message.read',
      expect.objectContaining({ messageId: anchorMessageId, recipientUserId: userId }),
      { persistent: true },
    )
  })

  it('mark_read_for_actor does not touch archived recipients', async () => {
    const command = mockRegisteredCommands.get('messages.conversation.mark_read_for_actor')
    const recipient = {
      messageId: anchorMessageId,
      recipientUserId: userId,
      status: 'archived',
      archivedAt: new Date(),
      readAt: null,
    } as unknown as MessageRecipient
    const { container } = buildContainer([recipient])

    const result = await command!.execute(runInput(), { container: container as never })

    expect(result).toEqual({ ok: true, affectedCount: 0 })
    expect(recipient.status).toBe('archived')
    expect(emitMessagesEventMock).not.toHaveBeenCalled()
  })
})
