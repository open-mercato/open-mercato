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
const senderUserId = '44444444-4444-4444-8444-444444444444'
const conversationId = '66666666-6666-4666-8666-666666666666'
const createdMessageId = '88888888-8888-4888-8888-888888888888'

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
    tenantId,
    organizationId,
    userId: senderUserId,
    ...overrides,
  }
}

/**
 * A harness whose `transactional` actually runs the compose body against a
 * recording entity manager, so the test can inspect the `Message` row compose
 * builds. The idempotency suite next door only needs the pre-check, so it stubs
 * the transaction out.
 */
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
      if (name === 'eventBus') return { emitEvent: jest.fn(async () => {}) }
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
  const createdMessage = () => created.find((entry) => entry.entity === Message)?.data
  return { command: command!, ctx, createdMessage }
}

describe('messages.messages.compose — sentAt (#6095)', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockResolvedValue(null)
    findWithDecryptionMock.mockResolvedValue([])
  })

  it('stamps the message with the supplied sentAt', async () => {
    const { command, ctx, createdMessage } = createHarness()
    const sentAt = new Date('2026-06-16T08:30:00Z')

    await command.execute(composeInput({ sentAt }), ctx)

    expect(createdMessage()?.sentAt).toEqual(sentAt)
  })

  it('still stamps "now" when no sentAt is supplied', async () => {
    const { command, ctx, createdMessage } = createHarness()
    const before = Date.now()

    await command.execute(composeInput(), ctx)

    const sentAt = createdMessage()?.sentAt as Date
    expect(sentAt).toBeInstanceOf(Date)
    expect(sentAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(sentAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('leaves a draft unsent even when a sentAt is supplied', async () => {
    const { command, ctx, createdMessage } = createHarness()

    await command.execute(
      composeInput({ isDraft: true, sentAt: new Date('2026-06-16T08:30:00Z') }),
      ctx,
    )

    expect(createdMessage()?.sentAt).toBeNull()
    expect(createdMessage()?.status).toBe('draft')
  })
})
