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

const messageId = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const senderUserId = '44444444-4444-4444-8444-444444444444'
const recipientUserId = '55555555-5555-4555-8555-555555555555'

function createDraftMessage(overrides: Partial<Message> = {}) {
  return {
    id: messageId,
    threadId: null,
    senderUserId,
    type: 'default',
    visibility: 'internal',
    externalEmail: null,
    subject: 'Draft subject',
    body: 'Draft body',
    bodyFormat: 'text',
    priority: 'normal',
    status: 'draft',
    isDraft: true,
    sentAt: null,
    sendViaEmail: false,
    tenantId,
    organizationId,
    deletedAt: null,
    ...overrides,
  } as Message
}

function createHarness(messageOverrides: Partial<Message> = {}, recipients: Array<Partial<MessageRecipient>> = []) {
  const draft = createDraftMessage(messageOverrides)
  const eventBus = {
    emitEvent: jest.fn(async () => {}),
  }
  const emFork = {
    flush: jest.fn(async () => {}),
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    nativeDelete: jest.fn(async () => {}),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => emFork }
      if (name === 'eventBus') return eventBus
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

  findOneWithDecryptionMock.mockResolvedValue(draft)
  findWithDecryptionMock.mockResolvedValue(recipients)

  const command = mockRegisteredCommands.get('messages.messages.update_draft')
  expect(command).toBeTruthy()

  return {
    command: command!,
    draft,
    emFork,
    eventBus,
    ctx,
  }
}

function updateInput(overrides: Record<string, unknown> = {}) {
  return {
    messageId,
    isDraft: false,
    tenantId,
    organizationId,
    userId: senderUserId,
    ...overrides,
  }
}

describe('messages.messages.update_draft command send transition', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects sending an internal draft without input or preloaded recipients', async () => {
    const { command, emFork, ctx } = createHarness({}, [])

    await expect(command.execute(updateInput(), ctx)).rejects.toThrow('at least one recipient is required')

    expect(emFork.flush).not.toHaveBeenCalled()
    expect(emitMessagesEventMock).not.toHaveBeenCalled()
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      emFork,
      MessageRecipient,
      { messageId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
  })

  it.each([
    ['subject', { subject: '   ' }, 'subject is required'],
    ['body', { body: '   ' }, 'body is required'],
  ])('rejects sending a draft with blank final %s', async (_field, messageOverrides, expectedError) => {
    const { command, emFork, ctx } = createHarness(messageOverrides, [
      { recipientUserId, recipientType: 'to', deletedAt: null },
    ])

    await expect(command.execute(updateInput(), ctx)).rejects.toThrow(expectedError)

    expect(emFork.flush).not.toHaveBeenCalled()
    expect(emitMessagesEventMock).not.toHaveBeenCalled()
  })

  it('marks the draft sent, indexes it, and emits the sent event after flush', async () => {
    const { command, draft, emFork, eventBus, ctx } = createHarness({}, [
      { recipientUserId, recipientType: 'to', deletedAt: null },
    ])

    await expect(command.execute(updateInput(), ctx)).resolves.toEqual({ ok: true, id: messageId })

    expect(draft.isDraft).toBe(false)
    expect(draft.status).toBe('sent')
    expect(draft.sentAt).toBeInstanceOf(Date)
    expect(draft.threadId).toBe(messageId)
    expect(emFork.flush).toHaveBeenCalledTimes(1)
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'query_index.upsert_one',
      expect.objectContaining({
        entityType: 'messages:message',
        recordId: messageId,
        tenantId,
        organizationId,
      }),
      { tenantId, organizationId },
    )
    expect(emitMessagesEventMock).toHaveBeenCalledWith(
      'messages.message.sent',
      expect.objectContaining({
        messageId,
        senderUserId,
        recipientUserIds: [recipientUserId],
        sendViaEmail: false,
        externalEmail: null,
        tenantId,
        organizationId,
      }),
      { persistent: true },
    )
    expect(emFork.flush.mock.invocationCallOrder[0]).toBeLessThan(
      emitMessagesEventMock.mock.invocationCallOrder[0],
    )
  })
})
