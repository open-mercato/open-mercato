import { GET } from '@open-mercato/core/modules/messages/api/token/[token]/route'
import {
  Message,
  MessageAccessToken,
  MessageObject,
  MessageRecipient,
} from '@open-mercato/core/modules/messages/data/entities'

const createRequestContainerMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async (em: { findOne: (entity: unknown, where: unknown) => Promise<unknown> }, entity: unknown, where: unknown) =>
    em.findOne(entity, where),
  ),
  findWithDecryption: jest.fn(async (em: { find: (entity: unknown, where: unknown) => Promise<unknown[]> }, entity: unknown, where: unknown) =>
    em.find(entity, where),
  ),
}))

describe('messages /api/messages/token/[token]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue(null)
  })

  function setupContainer(findOneImpl: (entity: unknown, where: Record<string, unknown>) => Promise<unknown>) {
    const em = {
      findOne: jest.fn(findOneImpl),
      find: jest.fn(async () => []),
    }
    const commandBus = {
      execute: jest.fn(async () => ({
        result: {
          messageId: 'message-1',
          recipientUserId: 'user-1',
        },
      })),
    }
    createRequestContainerMock.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'commandBus') return commandBus
        if (name === 'em') return em
        return null
      },
    })

    return { em, commandBus }
  }

  function createValidToken() {
    return {
      id: 'token-1',
      token: 'ok',
      messageId: 'message-1',
      recipientUserId: 'user-1',
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      useCount: 0,
    }
  }

  function createMessage() {
    return {
      id: 'message-1',
      type: 'default',
      subject: 'Subject',
      body: 'Body',
      bodyFormat: 'text',
      priority: 'normal',
      senderUserId: 'sender-1',
      sentAt: new Date('2026-02-15T10:00:00.000Z'),
      deletedAt: null,
    }
  }

  function createRecipient() {
    return {
      id: 'recipient-1',
      messageId: 'message-1',
      recipientUserId: 'user-1',
      status: 'unread',
      deletedAt: null,
    }
  }

  it('returns 404 when access token is not found', async () => {
    const { commandBus } = setupContainer(async () => null)

    const response = await GET(new Request('http://localhost'), { params: { token: 'missing' } })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid or expired link' })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('returns 410 when token is expired', async () => {
    const { commandBus } = setupContainer(async (entity, where) => {
      if (entity === MessageAccessToken && where.token === 'expired') {
        return {
          ...createValidToken(),
          token: 'expired',
          expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        }
      }
      return null
    })

    const response = await GET(new Request('http://localhost'), { params: { token: 'expired' } })

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({ error: 'This link has expired' })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('returns 409 when token usage exceeds max count', async () => {
    const { commandBus } = setupContainer(async (entity, where) => {
      if (entity === MessageAccessToken && where.token === 'limit') {
        return {
          ...createValidToken(),
          token: 'limit',
          useCount: 25,
        }
      }
      return null
    })

    const response = await GET(new Request('http://localhost'), { params: { token: 'limit' } })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'This link can no longer be used' })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('returns message payload after successful token consume command', async () => {
    const message = createMessage()

    const { em, commandBus } = setupContainer(async (entity, where) => {
      if (entity === MessageAccessToken && where.token === 'ok') return createValidToken()
      if (entity === Message && where.id === 'message-1') return message
      if (entity === MessageRecipient && where.messageId === 'message-1') return createRecipient()
      return null
    })

    em.find.mockResolvedValueOnce([
      {
        id: 'obj-1',
        entityModule: 'sales',
        entityType: 'order',
        entityId: 'order-1',
        actionRequired: false,
        actionType: 'approve',
        actionLabel: 'Approve',
      },
    ] satisfies Partial<MessageObject>[])

    const response = await GET(new Request('http://localhost'), { params: { token: 'ok' } })

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body).toEqual(
      expect.objectContaining({
        id: 'message-1',
        type: 'default',
        subject: 'Subject',
        requiresAuth: false,
        recipientUserId: 'user-1',
      }),
    )
    expect(commandBus.execute).toHaveBeenCalledWith('messages.token.consume', expect.any(Object))
  })

  it('returns only auth preflight for protected token when unauthenticated', async () => {
    const { em, commandBus } = setupContainer(async (entity, where) => {
      if (entity === MessageAccessToken && where.token === 'ok') return createValidToken()
      if (entity === Message && where.id === 'message-1') return createMessage()
      if (entity === MessageRecipient && where.messageId === 'message-1') return createRecipient()
      return null
    })

    em.find.mockResolvedValueOnce([
      {
        id: 'obj-1',
        entityModule: 'sales',
        entityType: 'order',
        entityId: 'order-1',
        actionRequired: true,
        actionType: 'approve',
        actionLabel: 'Approve',
        entitySnapshot: { secret: 'protected snapshot' },
      },
    ] satisfies Partial<MessageObject>[])

    const response = await GET(new Request('http://localhost'), { params: { token: 'ok' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ requiresAuth: true })
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(getAuthFromRequestMock).toHaveBeenCalled()
  })

  it('returns 403 for protected token when authenticated user is not the recipient', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: 'other-user', tenantId: 'tenant-1', orgId: 'org-1' })
    const { em, commandBus } = setupContainer(async (entity, where) => {
      if (entity === MessageAccessToken && where.token === 'ok') return createValidToken()
      if (entity === Message && where.id === 'message-1') return createMessage()
      if (entity === MessageRecipient && where.messageId === 'message-1') return createRecipient()
      return null
    })

    em.find.mockResolvedValueOnce([
      {
        id: 'obj-1',
        entityModule: 'sales',
        entityType: 'order',
        entityId: 'order-1',
        actionRequired: true,
      },
    ] satisfies Partial<MessageObject>[])

    const response = await GET(new Request('http://localhost'), { params: { token: 'ok' } })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden', requiresAuth: true })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('returns protected payload for the authenticated recipient', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    const { em, commandBus } = setupContainer(async (entity, where) => {
      if (entity === MessageAccessToken && where.token === 'ok') return createValidToken()
      if (entity === Message && where.id === 'message-1') return createMessage()
      if (entity === MessageRecipient && where.messageId === 'message-1') return createRecipient()
      return null
    })

    em.find.mockResolvedValueOnce([
      {
        id: 'obj-1',
        entityModule: 'sales',
        entityType: 'order',
        entityId: 'order-1',
        actionRequired: true,
        entitySnapshot: { secret: 'protected snapshot' },
      },
    ] satisfies Partial<MessageObject>[])

    const response = await GET(new Request('http://localhost'), { params: { token: 'ok' } })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual(
      expect.objectContaining({
        id: 'message-1',
        subject: 'Subject',
        requiresAuth: true,
        recipientUserId: 'user-1',
      }),
    )
    expect(body.objects[0].snapshot).toEqual({ secret: 'protected snapshot' })
    expect(commandBus.execute).toHaveBeenCalledWith(
      'messages.token.consume',
      expect.objectContaining({
        ctx: expect.objectContaining({
          auth: expect.objectContaining({ sub: 'user-1' }),
        }),
      }),
    )
  })
})
