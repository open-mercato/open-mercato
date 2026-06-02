import { Message, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const mockRegisteredCommands = new Map<string, RegisteredCommand>()
const mockRegisterCommand = jest.fn((command: RegisteredCommand) => {
  mockRegisteredCommands.set(command.id, command)
})
const emitMessagesEventMock = jest.fn(async () => {})
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()

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

jest.mock('@open-mercato/core/modules/messages/lib/attachments', () => ({
  linkAttachmentsToMessage: jest.fn(),
  linkLibraryAttachmentsToMessage: jest.fn(),
  copyAttachmentsForForwardMessages: jest.fn(),
}))

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const senderUserId = '44444444-4444-4444-8444-444444444444'
const conversationId = '66666666-6666-4666-8666-666666666666'
const existingMessageId = '77777777-7777-4777-8777-777777777777'

function composeInput(overrides: Record<string, unknown> = {}) {
  return {
    type: 'channel.gmail',
    visibility: 'public',
    externalEmail: 'sender@example.com',
    sourceEntityType: 'communication_channels.external_conversation',
    sourceEntityId: conversationId,
    subject: 'Inbound subject',
    body: 'Inbound body',
    bodyFormat: 'text',
    priority: 'normal',
    recipients: [],
    isDraft: false,
    sendViaEmail: false,
    idempotencyKey: 'cc:chan-1:provider-msg-1',
    tenantId,
    organizationId,
    userId: senderUserId,
    ...overrides,
  }
}

function createHarness() {
  const emFork = {
    fork: () => emFork,
    find: jest.fn(async () => [] as unknown[]),
    findOne: jest.fn(async () => null),
    flush: jest.fn(async () => {}),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(() => emFork),
    transactional: jest.fn(async () => {}),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => emFork }
      throw new Error(`Unknown dependency: ${name}`)
    }),
  }
  const ctx = {
    container: container as never,
    auth: { sub: senderUserId, tenantId } as never,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
  const command = mockRegisteredCommands.get('messages.messages.compose')
  expect(command).toBeTruthy()
  return { command: command!, emFork, ctx }
}

const existingMessage = {
  id: existingMessageId,
  threadId: 'thread-existing',
  externalEmail: 'sender@example.com',
  isDraft: false,
  tenantId,
  organizationId,
} as Message

describe('messages.messages.compose idempotency', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns the existing message without creating a new one when idempotencyKey matches', async () => {
    const { command, emFork, ctx } = createHarness()
    findOneWithDecryptionMock.mockResolvedValue(existingMessage)
    findWithDecryptionMock.mockResolvedValue([{ recipientUserId: 'recipient-1' }])

    const result = await command.execute(composeInput(), ctx)

    expect(result).toEqual({
      id: existingMessageId,
      threadId: 'thread-existing',
      externalEmail: 'sender@example.com',
      isDraft: false,
      recipientUserIds: ['recipient-1'],
      // Marks the idempotent replay so buildLog skips the audit/undo entry.
      deduplicated: true,
    })
    // Short-circuited before opening a transaction — no duplicate created.
    expect(emFork.transactional).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      emFork,
      MessageRecipient,
      { messageId: existingMessageId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
  })

  it('returns the winning message when a concurrent insert hits the idempotency unique index (23505)', async () => {
    const { command, emFork, ctx } = createHarness()
    // Pre-check misses (the winner had not committed yet), the insert loses the
    // race on `messages_idempotency_key_uq`, then the reselect finds the winner.
    findOneWithDecryptionMock.mockResolvedValueOnce(null).mockResolvedValueOnce(existingMessage)
    emFork.transactional.mockRejectedValue(
      Object.assign(new Error('duplicate key value violates unique constraint "messages_idempotency_key_uq"'), {
        code: '23505',
      }),
    )
    findWithDecryptionMock.mockResolvedValue([])

    const result = await command.execute(composeInput(), ctx)

    expect((result as { id: string }).id).toBe(existingMessageId)
    expect(emFork.transactional).toHaveBeenCalledTimes(1)
  })

  it('does not short-circuit when no idempotencyKey is provided', async () => {
    const { command, emFork, ctx } = createHarness()
    findOneWithDecryptionMock.mockResolvedValue(existingMessage)

    await command.execute(composeInput({ idempotencyKey: undefined }), ctx)

    // No idempotency key → the pre-check is skipped and compose proceeds to the
    // transactional create path.
    expect(emFork.transactional).toHaveBeenCalledTimes(1)
  })

  it('skips the audit log + undo entry on an idempotent replay (no spurious soft-delete handle)', async () => {
    const { command } = createHarness()
    const buildLog = (command as unknown as {
      buildLog?: (args: {
        input: unknown
        result: unknown
        snapshots: Record<string, unknown>
      }) => Promise<unknown>
    }).buildLog
    expect(typeof buildLog).toBe('function')

    const snapshots = { after: { message: { id: existingMessageId } } }

    // A dedup hit must NOT produce an undoable "Compose message" audit row — that
    // would expose an undo that soft-deletes a legitimately-received inbound message.
    const dedupEntry = await buildLog!({
      input: composeInput(),
      result: {
        id: existingMessageId,
        threadId: 'thread-existing',
        externalEmail: null,
        isDraft: false,
        recipientUserIds: [],
        deduplicated: true,
      },
      snapshots,
    })
    expect(dedupEntry).toEqual({ skipLog: true })

    // A genuine compose still logs an undoable entry.
    const freshEntry = (await buildLog!({
      input: composeInput(),
      result: {
        id: existingMessageId,
        threadId: 'thread-existing',
        externalEmail: null,
        isDraft: false,
        recipientUserIds: [],
      },
      snapshots,
    })) as { actionLabel?: string; skipLog?: boolean }
    expect(freshEntry.skipLog).toBeUndefined()
    expect(freshEntry.actionLabel).toBe('Compose message')
  })
})
