import { GET } from '@open-mercato/core/modules/messages/api/token/[token]/route'
import {
  Message,
  MessageAccessToken,
  MessageObject,
  MessageRecipient,
} from '@open-mercato/core/modules/messages/data/entities'

const getOrmMock = jest.fn()

jest.mock('@open-mercato/shared/lib/db/mikro', () => ({
  getOrm: (...args: unknown[]) => getOrmMock(...args),
}))

describe('messages /api/messages/token/[token]', () => {
  const now = new Date('2026-02-15T12:00:00.000Z')

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(now)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function setupFindOne(findOneImpl: (entity: unknown, where: Record<string, unknown>) => Promise<unknown>) {
    const em = {
      findOne: jest.fn(findOneImpl),
      find: jest.fn(async () => []),
      flush: jest.fn(async () => {}),
    }

    getOrmMock.mockResolvedValue({
      em: {
        fork: () => em,
      },
    })

    return em
  }

  it('returns 404 when access token is not found', async () => {
    setupFindOne(async () => null)

    const response = await GET(new Request('http://localhost'), { params: { token: 'missing' } })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid or expired link' })
  })

  it('returns 410 when token is expired', async () => {
    setupFindOne(async (entity) => {
      if (entity === MessageAccessToken) {
        return {
          token: 'abc',
          messageId: 'message-1',
          recipientUserId: 'user-1',
          expiresAt: new Date('2026-02-14T12:00:00.000Z'),
          useCount: 0,
        }
      }
      return null
    })

    const response = await GET(new Request('http://localhost'), { params: { token: 'expired' } })

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({ error: 'This link has expired' })
  })

  it('returns 409 when token usage exceeds max count', async () => {
    setupFindOne(async (entity) => {
      if (entity === MessageAccessToken) {
        return {
          token: 'abc',
          messageId: 'message-1',
          recipientUserId: 'user-1',
          expiresAt: new Date('2026-02-16T12:00:00.000Z'),
          useCount: 25,
        }
      }
      return null
    })

    const response = await GET(new Request('http://localhost'), { params: { token: 'limit' } })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'This link can no longer be used' })
  })

  it('returns message payload and marks token/recipient as used/read', async () => {
    const accessToken = {
      token: 'abc',
      messageId: 'message-1',
      recipientUserId: 'user-1',
      expiresAt: new Date('2026-02-16T12:00:00.000Z'),
      useCount: 0,
      usedAt: null,
    }

    const recipient = {
      messageId: 'message-1',
      recipientUserId: 'user-1',
      deletedAt: null,
      status: 'unread',
      readAt: null,
    }

    const message = {
      id: 'message-1',
      subject: 'Subject',
      body: 'Body',
      bodyFormat: 'text',
      senderUserId: 'sender-1',
      sentAt: new Date('2026-02-15T10:00:00.000Z'),
      deletedAt: null,
    }

    const em = setupFindOne(async (entity, where) => {
      if (entity === MessageAccessToken) return accessToken
      if (entity === Message && where.id === 'message-1') return message
      if (entity === MessageRecipient) return recipient
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

    expect(accessToken.useCount).toBe(1)
    expect(accessToken.usedAt).toBeInstanceOf(Date)
    expect(recipient.status).toBe('read')
    expect(recipient.readAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
