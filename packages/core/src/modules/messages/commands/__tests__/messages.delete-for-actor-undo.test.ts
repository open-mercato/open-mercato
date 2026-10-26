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
const extractUndoPayloadMock = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: RegisteredCommand) => mockRegisterCommand(command),
}))

jest.mock('@open-mercato/core/modules/messages/events', () => ({
  emitMessagesEvent: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
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
const recipientRowId = '77777777-7777-4777-8777-777777777777'

function buildUndoContext(message: { deletedAt: Date | null }, recipient: { status: string; deletedAt: Date | null } | null) {
  const emFork = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === MessageRecipient) return recipient
      if (entity === Message) return message
      return null
    }),
    flush: jest.fn(async () => {}),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => emFork }
      throw new Error(`Unknown dependency: ${name}`)
    }),
  }
  return { emFork, ctx: { container: container as never } }
}

describe('messages.messages.delete_for_actor undo', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('undoing a recipient-only delete keeps a later global delete by the sender', async () => {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')
    expect(command?.undo).toBeTruthy()

    extractUndoPayloadMock.mockReturnValue({
      before: {
        messageId,
        messageDeletedAt: null,
        recipientId: recipientRowId,
        recipientStatus: 'read',
        recipientDeletedAt: null,
      },
      after: {
        messageId,
        messageDeletedAt: null,
        recipientId: recipientRowId,
        recipientStatus: 'deleted',
        recipientDeletedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    const globalDeletedAt = new Date('2026-01-02T00:00:00.000Z')
    const message = { deletedAt: globalDeletedAt }
    const recipient = { status: 'deleted', deletedAt: new Date('2026-01-01T00:00:00.000Z') }
    const { emFork, ctx } = buildUndoContext(message, recipient)

    await command!.undo!({ logEntry: {}, ctx })

    expect(message.deletedAt).toEqual(globalDeletedAt)
    expect(recipient.status).toBe('read')
    expect(recipient.deletedAt).toBeNull()
    expect(emFork.flush).toHaveBeenCalledTimes(1)
  })

  it('undoing a global delete still restores the message', async () => {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')

    extractUndoPayloadMock.mockReturnValue({
      before: {
        messageId,
        messageDeletedAt: null,
        recipientId: null,
        recipientStatus: null,
        recipientDeletedAt: null,
      },
      after: {
        messageId,
        messageDeletedAt: '2026-01-02T00:00:00.000Z',
        recipientId: null,
        recipientStatus: null,
        recipientDeletedAt: null,
      },
    })
    const message = { deletedAt: new Date('2026-01-02T00:00:00.000Z') as Date | null }
    const { emFork, ctx } = buildUndoContext(message, null)

    await command!.undo!({ logEntry: {}, ctx })

    expect(message.deletedAt).toBeNull()
    expect(emFork.findOne).not.toHaveBeenCalledWith(MessageRecipient, expect.anything())
    expect(emFork.flush).toHaveBeenCalledTimes(1)
  })
})
