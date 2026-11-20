import { Message, MessageExternalParticipant } from '@open-mercato/core/modules/messages/data/entities'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const mockRegisteredCommands = new Map<string, RegisteredCommand>()

jest.mock('@open-mercato/core/modules/messages/lib/externalEmailBudget', () => ({
  assertExternalEmailBudget: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: RegisteredCommand) => mockRegisteredCommands.set(command.id, command),
}))

jest.mock('@open-mercato/core/modules/messages/events', () => ({
  emitMessagesEvent: jest.fn(async () => {}),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => null),
  findWithDecryption: jest.fn(async () => []),
}))

jest.mock('@open-mercato/core/modules/messages/lib/attachments', () => ({
  linkAttachmentsToMessage: jest.fn(),
  linkLibraryAttachmentsToMessage: jest.fn(),
  copyAttachmentsForForwardMessages: jest.fn(),
}))

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const createdMessageId = '88888888-8888-4888-8888-888888888888'

function composeInput(overrides: Record<string, unknown> = {}) {
  return {
    type: 'default',
    visibility: 'public',
    recipients: [],
    subject: 'Offer',
    body: 'Hello',
    sendViaEmail: true,
    isDraft: false,
    tenantId,
    organizationId,
    userId,
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
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    transactional: jest.fn(async (work: (t: typeof trx) => Promise<void>) => work(trx)),
  }
  const ctx = {
    container: { resolve: (name: string) => (name === 'em' ? { fork: () => emFork } : null) } as never,
    auth: { sub: userId, tenantId } as never,
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
  }
  const command = mockRegisteredCommands.get('messages.messages.compose')
  expect(command).toBeTruthy()
  return {
    command: command!,
    ctx,
    message: () => created.find((entry) => entry.entity === Message)?.data,
    participants: () => created.filter((entry) => entry.entity === MessageExternalParticipant).map((entry) => entry.data),
  }
}

describe('messages.messages.compose — external participants', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  it('stores every outbound "to" as a pending participant and keeps the first in external_email', async () => {
    const { command, ctx, message, participants } = createHarness()

    await command.execute(composeInput({ externalEmails: ['a@example.com', 'b@example.com'] }), ctx)

    expect(message()?.externalEmail).toBe('a@example.com')
    expect(participants()).toEqual([
      expect.objectContaining({ messageId: createdMessageId, role: 'to', email: 'a@example.com', emailHash: hashForLookup('a@example.com'), deliveryStatus: 'pending', tenantId, organizationId }),
      expect.objectContaining({ messageId: createdMessageId, role: 'to', email: 'b@example.com', deliveryStatus: 'pending' }),
    ])
  })

  it('treats a single externalEmail as a one-address list without changing external_email', async () => {
    const { command, ctx, message, participants } = createHarness()

    await command.execute(composeInput({ externalEmail: 'Solo@Example.com' }), ctx)

    expect(message()?.externalEmail).toBe('Solo@Example.com')
    expect(participants()).toEqual([
      expect.objectContaining({ role: 'to', email: 'Solo@Example.com', deliveryStatus: 'pending' }),
    ])
  })

  it('skips duplicate addresses within the same role', async () => {
    const { command, ctx, participants } = createHarness()

    await command.execute(composeInput({ externalEmails: ['a@example.com', 'A@example.com'] }), ctx)

    expect(participants()).toHaveLength(1)
  })

  it('stores inbound extra participants without status and keeps the sender in external_email', async () => {
    const { command, ctx, message, participants } = createHarness()

    await command.execute(
      composeInput({
        externalEmail: 'sender@example.com',
        inboundFromChannel: true,
        sendViaEmail: false,
        externalParticipants: [{ email: 'cc@example.com', name: 'Cee', role: 'cc' }],
      }),
      ctx,
    )

    expect(message()?.externalEmail).toBe('sender@example.com')
    expect(participants()).toEqual([
      expect.objectContaining({ role: 'cc', email: 'cc@example.com', name: 'Cee', deliveryStatus: null }),
    ])
  })

  it('stores draft addressees without a delivery status', async () => {
    const { command, ctx, message, participants } = createHarness()

    await command.execute(composeInput({ isDraft: true, externalEmails: ['a@example.com', 'b@example.com'] }), ctx)

    expect(message()?.externalEmail).toBe('a@example.com')
    expect(participants()).toEqual([
      expect.objectContaining({ role: 'to', email: 'a@example.com', deliveryStatus: null }),
      expect.objectContaining({ role: 'to', email: 'b@example.com', deliveryStatus: null }),
    ])
  })

  describe('reply', () => {
    const originalId = '99999999-9999-4999-8999-999999999999'

    function primeOriginal() {
      ;(findOneWithDecryption as jest.Mock).mockResolvedValueOnce({
        id: originalId,
        type: 'default',
        visibility: 'public',
        senderUserId: userId,
        externalEmail: 'origin@example.com',
        externalName: 'Origin',
        threadId: originalId,
        subject: 'Offer',
        priority: 'normal',
        tenantId,
        organizationId,
      })
    }

    function replyInput(overrides: Record<string, unknown> = {}) {
      return { messageId: originalId, body: 'Thanks', tenantId, organizationId, userId, ...overrides }
    }

    it('keeps the inherited single counterpart and writes no participants without externalEmails', async () => {
      const { ctx, message, participants } = createHarness()
      primeOriginal()

      await mockRegisteredCommands.get('messages.messages.reply')!.execute(replyInput(), ctx)

      expect(message()).toMatchObject({ externalEmail: 'origin@example.com', externalName: 'Origin', emailSendSeparately: false })
      expect(participants()).toHaveLength(0)
    })

    it('addresses reply-all participants as pending "to" with the separate flag', async () => {
      const { ctx, message, participants } = createHarness()
      primeOriginal()

      await mockRegisteredCommands.get('messages.messages.reply')!.execute(
        replyInput({ replyAll: true, externalEmails: ['origin@example.com', 'cc@example.com'], sendSeparately: true }),
        ctx,
      )

      expect(message()).toMatchObject({ externalEmail: 'origin@example.com', emailSendSeparately: true })
      expect(participants()).toEqual([
        expect.objectContaining({ role: 'to', email: 'origin@example.com', deliveryStatus: 'pending' }),
        expect.objectContaining({ role: 'to', email: 'cc@example.com', deliveryStatus: 'pending' }),
      ])
    })
  })
})
