import { GET } from '@open-mercato/core/modules/messages/api/token/[token]/route'
import {
  Message,
  MessageObject,
} from '@open-mercato/core/modules/messages/data/entities'

const createRequestContainerMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainerMock(...args),
}))

describe('messages /api/messages/token/[token]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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

  it('returns 404 when access token is not found', async () => {
    const { commandBus } = setupContainer(async () => null)
    commandBus.execute.mockRejectedValueOnce(new Error('Invalid or expired link'))

    const response = await GET(new Request('http://localhost'), { params: { token: 'missing' } })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid or expired link' })
  })

  it('returns 410 when token is expired', async () => {
    const { commandBus } = setupContainer(async () => null)
    commandBus.execute.mockRejectedValueOnce(new Error('This link has expired'))

    const response = await GET(new Request('http://localhost'), { params: { token: 'expired' } })

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({ error: 'This link has expired' })
  })

  it('returns 409 when token usage exceeds max count', async () => {
    const { commandBus } = setupContainer(async () => null)
    commandBus.execute.mockRejectedValueOnce(new Error('This link can no longer be used'))

    const response = await GET(new Request('http://localhost'), { params: { token: 'limit' } })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'This link can no longer be used' })
  })

  it('returns message payload after successful token consume command', async () => {
    const message = {
      id: 'message-1',
      subject: 'Subject',
      body: 'Body',
      bodyFormat: 'text',
      senderUserId: 'sender-1',
      sentAt: new Date('2026-02-15T10:00:00.000Z'),
      deletedAt: null,
    }

    const { em, commandBus } = setupContainer(async (entity, where) => {
      if (entity === Message && where.id === 'message-1') return message
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
    expect(commandBus.execute).toHaveBeenCalledWith('messages.tokens.consume', expect.any(Object))
  })
})
