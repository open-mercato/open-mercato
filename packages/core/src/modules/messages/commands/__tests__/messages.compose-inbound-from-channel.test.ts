import { Message } from '@open-mercato/core/modules/messages/data/entities'

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
const systemUserId = '44444444-4444-4444-8444-444444444444'
const assigneeId = '55555555-5555-4555-8555-555555555555'
const conversationId = '66666666-6666-4666-8666-666666666666'
const createdMessageId = '88888888-8888-4888-8888-888888888888'

/** The compose input `ingest-inbound-message` builds for an assigned conversation. */
function ingestedInput(overrides: Record<string, unknown> = {}) {
  return {
    type: 'channel.gmail',
    visibility: 'public',
    externalEmail: 'alice@example.com',
    externalName: 'Alice Customer',
    sourceEntityType: 'communication_channels.external_conversation',
    sourceEntityId: conversationId,
    sourceChannelType: 'email',
    inboundFromChannel: true,
    recipients: [{ userId: assigneeId, type: 'to' }],
    subject: 'Re: Quote #123',
    body: 'Please go ahead.',
    bodyFormat: 'text',
    priority: 'normal',
    sendViaEmail: false,
    isDraft: false,
    tenantId,
    organizationId,
    userId: systemUserId,
    ...overrides,
  }
}

function createHarness() {
  const created: Array<{ entity: unknown; data: Record<string, unknown> }> = []
  const trx = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const row = { ...data }
      if (entity === Message) row.id = createdMessageId
      created.push({ entity, data: row })
      return row
    }),
    persist: jest.fn(() => trx),
    flush: jest.fn(async () => {}),
  }
  const emFork = {
    fork: () => emFork,
    transactional: jest.fn(async (work: (t: typeof trx) => Promise<void>) => work(trx)),
  }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return { fork: () => emFork }
      throw new Error(`Unknown dependency: ${name}`)
    }),
  }
  const ctx = {
    container: container as never,
    auth: { sub: systemUserId, tenantId } as never,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
  const command = mockRegisteredCommands.get('messages.messages.compose')
  expect(command).toBeTruthy()
  const createdMessage = () => created.find((entry) => entry.entity === Message)?.data
  const sentEvent = () => {
    const call = emitMessagesEventMock.mock.calls.find(
      (args) => (args as unknown[])[0] === 'messages.message.sent',
    ) as unknown[] | undefined
    expect(call).toBeTruthy()
    return call![1] as Record<string, unknown>
  }
  return { command: command!, ctx, createdMessage, sentEvent }
}

describe('messages.messages.compose — channel-ingested message (#6093)', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockResolvedValue(null)
    findWithDecryptionMock.mockResolvedValue([])
  })

  it('composes with the assignee as recipient and does not force email delivery', async () => {
    // Before #6093 this input failed validation; letting it through must not
    // turn ingest's explicit `sendViaEmail: false` into an email to the
    // assignee plus an echo to the external sender.
    const { command, ctx, createdMessage, sentEvent } = createHarness()

    const result = await command.execute(ingestedInput(), ctx)

    expect((result as { recipientUserIds: string[] }).recipientUserIds).toEqual([assigneeId])
    expect(createdMessage()?.visibility).toBe('public')
    expect(createdMessage()?.sendViaEmail).toBe(false)
    const event = sentEvent()
    expect(event.sendViaEmail).toBe(false)
    expect(event.inboundFromChannel).toBe(true)
    expect(event.recipientUserIds).toEqual([assigneeId])
  })

  it('still forces email delivery for a public message a user composes', async () => {
    const { command, ctx, createdMessage, sentEvent } = createHarness()

    await command.execute(
      ingestedInput({
        inboundFromChannel: undefined,
        recipients: [],
        sourceEntityType: 'customers.person',
        userId: assigneeId,
      }),
      ctx,
    )

    expect(createdMessage()?.sendViaEmail).toBe(true)
    const event = sentEvent()
    expect(event.sendViaEmail).toBe(true)
    expect(event.inboundFromChannel).toBe(false)
  })
})
