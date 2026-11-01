import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
  prepare?: (input: unknown, ctx: unknown) => Promise<{ before?: unknown } | null>
  undo?: (args: { logEntry: unknown; ctx: unknown }) => Promise<void>
  buildLog?: (args: { input: unknown; result: unknown; ctx: unknown; snapshots: { before?: unknown; after?: unknown } }) => Promise<{
    payload: { undo: { before: unknown; after: unknown } }
    snapshotBefore: unknown
  }>
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
  const findOneWithDecryptionMock = findOneWithDecryption as jest.Mock
  findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => {
    if (entity === Message) return message
    return null
  })
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
    expect(emFork.findOne).not.toHaveBeenCalledWith(Message, expect.anything())
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(emFork.flush).toHaveBeenCalledTimes(1)
  })

  function mockGlobalDeleteUndoPayload() {
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
  }

  it('undoing a global delete still restores the message', async () => {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')
    mockGlobalDeleteUndoPayload()
    const message = { deletedAt: new Date('2026-01-02T00:00:00.000Z') as Date | null }
    const { emFork, ctx } = buildUndoContext(message, null)

    await command!.undo!({ logEntry: { tenantId: 'tenant-1', organizationId: 'org-1' }, ctx })

    expect(message.deletedAt).toBeNull()
    expect(emFork.flush).toHaveBeenCalledTimes(1)
  })

  it('loads the message for a global delete undo through the decrypting helper scoped to the log tenant', async () => {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')
    mockGlobalDeleteUndoPayload()
    const message = { deletedAt: new Date('2026-01-02T00:00:00.000Z') as Date | null }
    const { emFork, ctx } = buildUndoContext(message, null)

    await command!.undo!({ logEntry: { tenantId: 'tenant-1', organizationId: 'org-1' }, ctx })

    expect(findOneWithDecryption).toHaveBeenCalledWith(
      emFork,
      Message,
      { id: messageId, tenantId: 'tenant-1' },
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(emFork.findOne).not.toHaveBeenCalled()
  })

  const actorUserId = '44444444-4444-4444-8444-444444444444'
  const tenantId = '22222222-2222-4222-8222-222222222222'
  const organizationId = '33333333-3333-4333-8333-333333333333'
  const deleteInput = { messageId, tenantId, organizationId, userId: actorUserId }

  function buildSenderRecipientStore(options: { holdFirstRecipientReads: boolean }) {
    const messageRow = { id: messageId, tenantId, organizationId, senderUserId: actorUserId, deletedAt: null as Date | null }
    const recipientRow = {
      id: recipientRowId,
      messageId,
      recipientUserId: actorUserId,
      status: 'read' as string,
      deletedAt: null as Date | null,
    }
    let releaseFirstReads: () => void = () => {}
    const bothRequestsRead = new Promise<void>((resolve) => {
      releaseFirstReads = resolve
    })
    let firstReads = 0

    function buildRequestCtx() {
      let readCount = 0
      const em = {
        findOne: jest.fn(async (entity: unknown, where: { deletedAt?: null }) => {
          if (entity === Message) return messageRow
          if (entity !== MessageRecipient) return null
          if (!('deletedAt' in where)) return recipientRow
          readCount += 1
          if (options.holdFirstRecipientReads && readCount === 1) {
            firstReads += 1
            if (firstReads === 2) releaseFirstReads()
            await bothRequestsRead
          }
          return recipientRow.deletedAt === null ? recipientRow : null
        }),
        nativeUpdate: jest.fn(async (_entity: unknown, where: { id: string; status: string }, data: { status: string; deletedAt: Date }) => {
          if (where.id !== recipientRow.id || recipientRow.deletedAt !== null || recipientRow.status !== where.status) return 0
          recipientRow.status = data.status
          recipientRow.deletedAt = data.deletedAt
          return 1
        }),
        find: jest.fn(async () => [recipientRow]),
        flush: jest.fn(async () => {}),
      }
      return {
        container: {
          resolve: jest.fn((name: string) => {
            if (name === 'em') return { fork: () => em }
            throw new Error(`Unknown dependency: ${name}`)
          }),
        } as never,
      }
    }

    const findOneWithDecryptionMock = findOneWithDecryption as jest.Mock
    findOneWithDecryptionMock.mockImplementation(async (_em: unknown, entity: unknown) => (entity === Message ? messageRow : null))

    return { messageRow, recipientRow, buildRequestCtx }
  }

  async function expectEachUndoReversesItsOwnBranch(
    store: ReturnType<typeof buildSenderRecipientStore>,
    recipientLog: { payload: { undo: { before: unknown; after: unknown } }; snapshotBefore: unknown },
    globalLog: { payload: { undo: { before: unknown; after: unknown } }; snapshotBefore: unknown },
  ) {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')
    expect(recipientLog.payload.undo.before).toEqual({
      messageId,
      messageDeletedAt: null,
      recipientId: recipientRowId,
      recipientStatus: 'read',
      recipientDeletedAt: null,
    })
    expect(globalLog.payload.undo.before).toEqual({
      messageId,
      messageDeletedAt: null,
      recipientId: null,
      recipientStatus: null,
      recipientDeletedAt: null,
    })
    expect(globalLog.snapshotBefore).toEqual(globalLog.payload.undo.before)

    const undoCtx = store.buildRequestCtx()
    extractUndoPayloadMock.mockReturnValue(globalLog.payload.undo)
    await command!.undo!({ logEntry: { tenantId, organizationId }, ctx: undoCtx })
    expect(store.messageRow.deletedAt).toBeNull()
    expect(store.recipientRow.status).toBe('deleted')

    extractUndoPayloadMock.mockReturnValue(recipientLog.payload.undo)
    await command!.undo!({ logEntry: { tenantId, organizationId }, ctx: undoCtx })
    expect(store.recipientRow.status).toBe('read')
    expect(store.recipientRow.deletedAt).toBeNull()
    expect(store.messageRow.deletedAt).toBeNull()
  }

  it('logs the executed branch when both deletes snapshot before either one executes', async () => {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')
    const store = buildSenderRecipientStore({ holdFirstRecipientReads: false })
    const firstCtx = store.buildRequestCtx()
    const secondCtx = store.buildRequestCtx()

    const firstPrepared = command!.prepare ? await command!.prepare(deleteInput, firstCtx) : null
    const secondPrepared = command!.prepare ? await command!.prepare(deleteInput, secondCtx) : null
    const firstResult = await command!.execute(deleteInput, firstCtx)
    const secondResult = await command!.execute(deleteInput, secondCtx)
    const firstLog = await command!.buildLog!({ input: deleteInput, result: firstResult, ctx: firstCtx, snapshots: { before: firstPrepared?.before } })
    const secondLog = await command!.buildLog!({ input: deleteInput, result: secondResult, ctx: secondCtx, snapshots: { before: secondPrepared?.before } })

    expect(store.recipientRow.status).toBe('deleted')
    expect(store.messageRow.deletedAt).toBeInstanceOf(Date)
    await expectEachUndoReversesItsOwnBranch(store, firstLog, secondLog)
  })

  it('lets only one of two deletes that both read the live recipient row claim it', async () => {
    const command = mockRegisteredCommands.get('messages.messages.delete_for_actor')
    const store = buildSenderRecipientStore({ holdFirstRecipientReads: true })

    async function runDeleteRequest() {
      const ctx = store.buildRequestCtx()
      const result = await command!.execute(deleteInput, ctx)
      return command!.buildLog!({ input: deleteInput, result, ctx, snapshots: {} })
    }
    const [firstLog, secondLog] = await Promise.all([runDeleteRequest(), runDeleteRequest()])

    expect(store.recipientRow.status).toBe('deleted')
    expect(store.messageRow.deletedAt).toBeInstanceOf(Date)
    await expectEachUndoReversesItsOwnBranch(store, firstLog, secondLog)
  })
})
