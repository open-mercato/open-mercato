import { Message, MessageExternalParticipant } from '@open-mercato/core/modules/messages/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const mockRegisteredCommands = new Map<string, RegisteredCommand>()
const delegateComposeToSenderMock = jest.fn()

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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback, t: (_key: string, fallback: string) => fallback }),
}))

jest.mock('@open-mercato/core/modules/messages/lib/composeSenderDelegation', () => ({
  delegateComposeToSender: (...args: unknown[]) => delegateComposeToSenderMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/attachments', () => ({
  linkAttachmentsToMessage: jest.fn(),
  linkLibraryAttachmentsToMessage: jest.fn(),
  copyAttachmentsForForwardMessages: jest.fn(),
}))

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'
const messageId = '55555555-5555-4555-8555-555555555555'
const channelId = '66666666-6666-4666-8666-666666666666'
const createdMessageId = '88888888-8888-4888-8888-888888888888'
const failedA = '77777777-7777-4777-8777-77777777777a'

const mockFindOne = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFind = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

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
  const command = mockRegisteredCommands.get('messages.messages.resend_failed')
  expect(command).toBeTruthy()
  return {
    command: command!,
    ctx,
    message: () => created.find((entry) => entry.entity === Message)?.data,
    participants: () => created.filter((entry) => entry.entity === MessageExternalParticipant).map((entry) => entry.data),
  }
}

const sourceMessage = {
  id: messageId,
  senderUserId: userId,
  type: 'default',
  subject: 'Offer',
  body: 'Hello',
  bodyFormat: 'markdown',
  priority: 'normal',
  emailSendSeparately: false,
  sourceEntityType: null,
  sourceEntityId: null,
  threadId: messageId,
}

async function statusOf(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise
    return null
  } catch (error) {
    return isCrudHttpError(error) ? error.status : -1
  }
}

describe('messages.messages.resend_failed', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/messages')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindOne.mockReset()
    mockFind.mockReset()
  })

  const input = { messageId, tenantId, organizationId, userId }

  it('returns 404 when the message does not exist in scope', async () => {
    const { command, ctx } = createHarness()
    mockFindOne.mockResolvedValue(null)
    await expect(statusOf(command.execute(input, ctx))).resolves.toBe(404)
    expect(mockFindOne.mock.calls[0][2]).toMatchObject({ id: messageId, tenantId, organizationId, deletedAt: null })
  })

  it('returns 403 for someone other than the sender', async () => {
    const { command, ctx } = createHarness()
    mockFindOne.mockResolvedValue({ ...sourceMessage, senderUserId: 'someone-else' } as never)
    await expect(statusOf(command.execute(input, ctx))).resolves.toBe(403)
  })

  it('returns 409 when nothing failed or a requested participant is not failed', async () => {
    const { command, ctx } = createHarness()
    mockFindOne.mockResolvedValue(sourceMessage as never)
    mockFind.mockResolvedValue([] as never)
    await expect(statusOf(command.execute(input, ctx))).resolves.toBe(409)

    mockFind.mockResolvedValue([{ id: failedA, email: 'a@example.com', role: 'to' }] as never)
    await expect(statusOf(command.execute({ ...input, participantIds: [failedA, '99999999-9999-4999-8999-999999999999'] }, ctx))).resolves.toBe(409)
  })

  it('composes a new message in the same thread addressed only to the failed participants', async () => {
    const { command, ctx, message, participants } = createHarness()
    mockFindOne.mockResolvedValueOnce(sourceMessage as never).mockResolvedValue(sourceMessage as never)
    mockFind.mockResolvedValueOnce([
      { id: failedA, email: 'a@example.com', role: 'to' },
      { id: 'p-b', email: 'b@example.com', role: 'bcc' },
    ] as never)

    const result = await command.execute(input, ctx)

    expect(mockFind.mock.calls[0][2]).toEqual({ messageId, tenantId, organizationId, deliveryStatus: 'failed' })
    expect(result).toEqual({ id: createdMessageId, threadId: messageId, sourceMessageId: messageId })
    expect(message()).toEqual(expect.objectContaining({
      parentMessageId: messageId,
      subject: 'Offer',
      body: 'Hello',
      bodyFormat: 'markdown',
      emailSendSeparately: true,
      externalEmail: 'a@example.com',
    }))
    expect(participants().map((participant) => participant.email)).toEqual(['a@example.com', 'b@example.com'])
    expect(delegateComposeToSenderMock).not.toHaveBeenCalled()
  })

  it('resends a mailbox message through the same sender mailbox', async () => {
    const { command, ctx } = createHarness()
    mockFindOne.mockResolvedValue({ ...sourceMessage, sourceEntityType: 'communication_channels.send_as_user', sourceEntityId: channelId } as never)
    mockFind.mockResolvedValue([{ id: failedA, email: 'a@example.com', role: 'to' }] as never)
    delegateComposeToSenderMock.mockResolvedValue({ ok: true, messageId: createdMessageId, threadId: messageId })

    const result = await command.execute({ ...input, participantIds: [failedA] }, ctx)

    expect(result).toEqual({ id: createdMessageId, threadId: messageId, sourceMessageId: messageId })
    expect(delegateComposeToSenderMock).toHaveBeenCalledWith(
      ctx.container,
      expect.objectContaining({ userId, tenantId, organizationId }),
      expect.objectContaining({ senderChannelId: channelId, externalEmails: ['a@example.com'], sendSeparately: false, parentMessageId: messageId, visibility: 'public' }),
    )
  })
})
