/**
 * Regression: a message ingested from an external channel is composed with
 * `visibility: 'public'` (so it renders as external correspondence) and
 * `sendViaEmail: false` (it was RECEIVED, not sent). Compose used to force
 * `sendViaEmail: true` for every public message, which queued an `external`
 * email job addressed to the inbound sender — every incoming email was echoed
 * back to its author through the tenant system email channel.
 */
type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const mockRegisteredCommands = new Map<string, RegisteredCommand>()
const mockRegisterCommand = jest.fn((command: RegisteredCommand) => {
  mockRegisteredCommands.set(command.id, command)
})
const emitMessagesEventMock = jest.fn(async () => {})
const findOneWithDecryptionMock = jest.fn(async () => null)
const findWithDecryptionMock = jest.fn(async () => [])

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
const newMessageId = '88888888-8888-4888-8888-888888888888'

function composeInput(overrides: Record<string, unknown> = {}) {
  return {
    type: 'channel.imap',
    visibility: 'public',
    externalEmail: 'inbound-sender@example.com',
    sourceEntityType: 'communication_channels.external_conversation',
    sourceEntityId: conversationId,
    subject: 'Inbound subject',
    body: 'Inbound body',
    bodyFormat: 'text',
    priority: 'normal',
    recipients: [],
    isDraft: false,
    sendViaEmail: false,
    tenantId,
    organizationId,
    userId: senderUserId,
    ...overrides,
  }
}

function createHarness() {
  const created: Record<string, unknown>[] = []
  const trx = {
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      const row = { id: newMessageId, ...data }
      created.push(row)
      return row
    }),
    persist: jest.fn(() => trx),
    flush: jest.fn(async () => {}),
  }
  const emFork = {
    fork: () => emFork,
    transactional: jest.fn(async (cb: (trx: unknown) => Promise<void>) => cb(trx)),
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
  return { command: command!, created, ctx }
}

function sentEventPayload(): Record<string, unknown> {
  const call = emitMessagesEventMock.mock.calls.find(
    (args) => (args as unknown[])[0] === 'messages.message.sent',
  ) as unknown[] | undefined
  expect(call).toBeTruthy()
  return call![1] as Record<string, unknown>
}

describe('messages.messages.compose — inbound channel messages are not echoed by email', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps sendViaEmail=false on a public message ingested from an external channel', async () => {
    const { command, created, ctx } = createHarness()

    await command.execute(composeInput(), ctx)

    const message = created.find((row) => row.sourceEntityType === 'communication_channels.external_conversation')
    expect(message).toBeTruthy()
    expect(message!.visibility).toBe('public')
    expect(message!.sendViaEmail).toBe(false)

    const payload = sentEventPayload()
    expect(payload.sendViaEmail).toBe(false)
    expect(payload.externalEmail).toBe('inbound-sender@example.com')
    expect(payload.sourceEntityType).toBe('communication_channels.external_conversation')
  })

  it('still delivers by email when the caller asks for it', async () => {
    const { command, created, ctx } = createHarness()

    await command.execute(
      composeInput({
        sourceEntityType: 'customers.person',
        externalEmail: 'customer@example.com',
        sendViaEmail: true,
      }),
      ctx,
    )

    const message = created.find((row) => row.sourceEntityType === 'customers.person')
    expect(message!.sendViaEmail).toBe(true)
    expect(sentEventPayload().sendViaEmail).toBe(true)
  })
})
