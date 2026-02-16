import { POST } from '@open-mercato/core/modules/messages/api/[id]/actions/[actionId]/route'
import { Message, MessageObject, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'

const resolveMessageContextMock = jest.fn()
const findResolvedActionMock = jest.fn()
const isTerminalActionMock = jest.fn()
const resolveActionCommandInputMock = jest.fn()
const resolveActionHrefMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/actions', () => ({
  findResolvedMessageActionById: (...args: unknown[]) => findResolvedActionMock(...args),
  isTerminalMessageAction: (...args: unknown[]) => isTerminalActionMock(...args),
  resolveActionCommandInput: (...args: unknown[]) => resolveActionCommandInputMock(...args),
  resolveActionHref: (...args: unknown[]) => resolveActionHrefMock(...args),
}))

jest.mock('@open-mercato/core/modules/messages/lib/message-types-registry', () => ({
  getMessageType: () => undefined,
}))

function createMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    type: 'default',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    senderUserId: 'sender-1',
    actionData: null,
    actionTaken: null,
    actionTakenAt: null,
    actionTakenByUserId: null,
    actionResult: null,
    sentAt: new Date('2026-02-15T10:00:00.000Z'),
    ...overrides,
  }
}

describe('messages action execution route', () => {
  let emFork: {
    findOne: jest.Mock
    find: jest.Mock
    flush: jest.Mock
  }
  let commandBus: { execute: jest.Mock }
  let eventBus: { emit: jest.Mock }

  beforeEach(() => {
    jest.clearAllMocks()

    emFork = {
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      flush: jest.fn(async () => {}),
    }

    commandBus = {
      execute: jest.fn(async () => ({ result: { ok: true } })),
    }

    eventBus = {
      emit: jest.fn(async () => {}),
    }

    resolveActionCommandInputMock.mockReturnValue({ id: 'entity-1' })
    resolveActionHrefMock.mockReturnValue('/backend/messages/1')

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return { fork: () => emFork }
            if (name === 'commandBus') return commandBus
            if (name === 'eventBus') return eventBus
            return null
          },
        },
      },
      scope: {
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        userId: 'user-1',
      },
    })
  })

  it('returns 404 when action cannot be resolved', async () => {
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return createMessage()
      if (entity === MessageRecipient) return { messageId: 'message-1', recipientUserId: 'user-1' }
      return null
    })
    findResolvedActionMock.mockReturnValue(null)

    const response = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: { id: 'message-1', actionId: 'missing' },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Action not found' })
  })

  it('returns 410 when action has expired', async () => {
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) {
        return createMessage({ actionData: { expiresAt: '2020-01-01T00:00:00.000Z' } })
      }
      if (entity === MessageRecipient) return { messageId: 'message-1', recipientUserId: 'user-1' }
      return null
    })

    findResolvedActionMock.mockReturnValue({
      id: 'approve',
      commandId: 'sales.orders.approve',
      source: 'message',
    })

    const response = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: { id: 'message-1', actionId: 'approve' },
    })

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({ error: 'Actions have expired' })
  })

  it('executes terminal command action and emits event', async () => {
    const message = createMessage()
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return message
      if (entity === MessageRecipient) return { messageId: 'message-1', recipientUserId: 'user-1' }
      return null
    })

    emFork.find.mockResolvedValue([] as MessageObject[])
    findResolvedActionMock.mockReturnValue({
      id: 'approve',
      source: 'message',
      commandId: 'sales.orders.approve',
    })
    isTerminalActionMock.mockReturnValue(true)

    const response = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ amount: 10 }),
      }),
      { params: { id: 'message-1', actionId: 'approve' } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      actionId: 'approve',
      result: { ok: true },
    })

    expect(commandBus.execute).toHaveBeenNthCalledWith(
      1,
      'sales.orders.approve',
      expect.objectContaining({
        input: { id: 'entity-1' },
      }),
    )
    expect(commandBus.execute).toHaveBeenNthCalledWith(
      2,
      'messages.actions.record_terminal',
      expect.objectContaining({
        input: expect.objectContaining({
          messageId: 'message-1',
          actionId: 'approve',
          userId: 'user-1',
        }),
      }),
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      'messages.action.taken',
      expect.objectContaining({ messageId: 'message-1', actionId: 'approve' }),
      { persistent: true },
    )
  })

  it('executes href action without locking message when non-terminal', async () => {
    const message = createMessage()
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return message
      if (entity === MessageRecipient) return { messageId: 'message-1', recipientUserId: 'user-1' }
      return null
    })

    findResolvedActionMock.mockReturnValue({
      id: 'view',
      source: 'message',
      href: '/backend/messages/{messageId}',
    })
    isTerminalActionMock.mockReturnValue(false)

    const response = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: { id: 'message-1', actionId: 'view' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      actionId: 'view',
      result: { redirect: '/backend/messages/1' },
    })
    expect(message.actionTaken).toBeNull()
    expect(commandBus.execute).toHaveBeenCalledTimes(0)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('returns 500 when command execution fails', async () => {
    emFork.findOne.mockImplementation(async (entity: unknown) => {
      if (entity === Message) return createMessage()
      if (entity === MessageRecipient) return { messageId: 'message-1', recipientUserId: 'user-1' }
      return null
    })

    findResolvedActionMock.mockReturnValue({
      id: 'approve',
      source: 'message',
      commandId: 'sales.orders.approve',
    })
    isTerminalActionMock.mockReturnValue(true)
    commandBus.execute.mockRejectedValue(new Error('Command failed'))

    const response = await POST(new Request('http://localhost', { method: 'POST' }), {
      params: { id: 'message-1', actionId: 'approve' },
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Action failed',
    })
  })
})
