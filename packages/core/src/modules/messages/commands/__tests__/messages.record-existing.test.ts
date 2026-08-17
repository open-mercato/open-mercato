import { Message } from '@open-mercato/core/modules/messages/data/entities'

type RegisteredCommand = {
  id: string
  execute: (input: unknown, ctx: unknown) => Promise<unknown>
}

const registeredCommands = new Map<string, RegisteredCommand>()
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const emitMessagesEventMock = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand: (command: RegisteredCommand) => registeredCommands.set(command.id, command),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/events', () => ({
  emitMessagesEvent: (...args: unknown[]) => emitMessagesEventMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/attachments', () => ({
  linkAttachmentsToMessage: jest.fn(async () => {}),
  linkLibraryAttachmentsToMessage: jest.fn(async () => {}),
}))

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const recordedByUserId = '44444444-4444-4444-8444-444444444444'
const sourceEntityId = '55555555-5555-4555-8555-555555555555'
const messageId = '66666666-6666-4666-8666-666666666666'

function input(overrides: Record<string, unknown> = {}) {
  return {
    type: 'channel.gmail',
    visibility: 'public',
    sourceEntityType: 'communication_channels.external_conversation',
    sourceEntityId,
    idempotencyKey: 'cc:channel-1:external-1',
    externalEmail: 'sender@example.com',
    recipients: [],
    subject: 'Existing inbound message',
    body: 'Body',
    bodyFormat: 'text',
    tenantId,
    organizationId,
    recordedByUserId,
    ...overrides,
  }
}

function createHarness() {
  const createdMessages: Array<Record<string, unknown>> = []
  const eventBus = { emitEvent: jest.fn(async () => {}) }
  const em = {
    fork: jest.fn(),
    transactional: jest.fn(),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      const record = entity === Message ? { id: messageId, ...data } : { id: 'related-1', ...data }
      if (entity === Message) createdMessages.push(record)
      return record
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => {}),
  }
  em.fork.mockReturnValue(em)
  em.persist.mockReturnValue(em)
  em.transactional.mockImplementation(async (callback: (trx: typeof em) => Promise<void>) => callback(em))
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'eventBus') return eventBus
      throw new Error(`Unknown dependency: ${name}`)
    }),
  }
  return { em, eventBus, createdMessages, ctx: { container } }
}

describe('messages.messages.record_existing', () => {
  beforeAll(() => {
    require('@open-mercato/core/modules/messages/commands/record-existing')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockResolvedValue(null)
    findWithDecryptionMock.mockResolvedValue([])
  })

  it('records and indexes a non-delivering sent message without emitting the authored event', async () => {
    const { eventBus, createdMessages, ctx } = createHarness()
    const command = registeredCommands.get('messages.messages.record_existing')

    const result = await command!.execute(input(), ctx)

    expect(result).toEqual(expect.objectContaining({ id: messageId, threadId: messageId }))
    expect(createdMessages[0]).toEqual(expect.objectContaining({
      senderUserId: recordedByUserId,
      status: 'sent',
      isDraft: false,
      sendViaEmail: false,
      idempotencyKey: 'cc:channel-1:external-1',
    }))
    expect(eventBus.emitEvent).toHaveBeenCalledWith(
      'query_index.upsert_one',
      expect.objectContaining({ recordId: messageId, crudAction: 'created' }),
      { tenantId, organizationId },
    )
    expect(emitMessagesEventMock).not.toHaveBeenCalled()
  })

  it.each([
    ['sendViaEmail', { sendViaEmail: true }],
    ['isDraft', { isDraft: false }],
    ['delivery target override', { email: 'target@example.com' }],
  ])('rejects the forbidden %s field', async (_label, override) => {
    const { ctx } = createHarness()
    const command = registeredCommands.get('messages.messages.record_existing')

    await expect(command!.execute(input(override), ctx)).rejects.toThrow()
  })

  it('returns the existing message on idempotent replay without writing or indexing', async () => {
    const { em, eventBus, ctx } = createHarness()
    findOneWithDecryptionMock.mockResolvedValue({
      id: messageId,
      threadId: messageId,
      externalEmail: 'sender@example.com',
      tenantId,
      organizationId,
    })
    findWithDecryptionMock.mockResolvedValue([])
    const command = registeredCommands.get('messages.messages.record_existing')

    const result = await command!.execute(input(), ctx)

    expect(result).toEqual(expect.objectContaining({ id: messageId, deduplicated: true }))
    expect(em.transactional).not.toHaveBeenCalled()
    expect(eventBus.emitEvent).not.toHaveBeenCalled()
  })

  it('deduplicates a soft-deleted record using the unique idempotency-key scope', async () => {
    const { em, eventBus, ctx } = createHarness()
    findOneWithDecryptionMock.mockResolvedValue({
      id: messageId,
      threadId: messageId,
      externalEmail: 'sender@example.com',
      tenantId,
      organizationId,
      deletedAt: new Date(),
    })
    const command = registeredCommands.get('messages.messages.record_existing')

    const result = await command!.execute(input(), ctx)

    expect(result).toEqual(expect.objectContaining({ id: messageId, deduplicated: true }))
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      em,
      Message,
      { tenantId, idempotencyKey: 'cc:channel-1:external-1' },
      undefined,
      { tenantId, organizationId },
    )
    expect(em.transactional).not.toHaveBeenCalled()
    expect(eventBus.emitEvent).not.toHaveBeenCalled()
  })

  it('returns the winning message when a concurrent insert wins the idempotency race', async () => {
    const { em, eventBus, ctx } = createHarness()
    const winner = {
      id: messageId,
      threadId: messageId,
      externalEmail: 'sender@example.com',
      tenantId,
      organizationId,
    }
    findOneWithDecryptionMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner)
    em.transactional.mockRejectedValueOnce(Object.assign(
      new Error('duplicate key value violates unique constraint "messages_idempotency_key_uq"'),
      { code: '23505' },
    ))
    const command = registeredCommands.get('messages.messages.record_existing')

    const result = await command!.execute(input(), ctx)

    expect(result).toEqual(expect.objectContaining({ id: messageId, deduplicated: true }))
    expect(findOneWithDecryptionMock).toHaveBeenCalledTimes(2)
    expect(eventBus.emitEvent).not.toHaveBeenCalled()
  })
})
