import { GET, PATCH, DELETE } from '@open-mercato/core/modules/messages/api/[id]/route'
import { Message, MessageObject, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const resolveMessageContextMock = jest.fn()
const hasOrganizationAccessMock = jest.fn(() => true)
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/core/modules/messages/lib/routeHelpers', () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  hasOrganizationAccess: (...args: unknown[]) => hasOrganizationAccessMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

describe('messages /api/messages/[id] GET', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns only actor-visible thread messages', async () => {
    const actorUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const senderUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const secondSenderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const thirdSenderId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const tenantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const organizationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const threadId = '11111111-1111-4111-8111-111111111111'

    const anchorMessage = {
      id: '22222222-2222-4222-8222-222222222222',
      threadId,
      senderUserId,
      organizationId,
      tenantId,
      deletedAt: null,
      isDraft: false,
      type: 'system',
      visibility: 'internal',
      sourceEntityType: null,
      sourceEntityId: null,
      externalEmail: null,
      externalName: null,
      parentMessageId: null,
      subject: 'Anchor subject',
      body: 'Anchor body',
      bodyFormat: 'markdown',
      priority: 'normal',
      sentAt: new Date('2026-02-24T10:00:00.000Z'),
      actionData: null,
      actionTaken: null,
      actionTakenAt: null,
      actionTakenByUserId: null,
    }

    const threadMessages = [
      {
        id: anchorMessage.id,
        senderUserId,
        body: 'Thread one',
        bodyFormat: 'markdown',
        sentAt: new Date('2026-02-24T10:00:00.000Z'),
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        senderUserId: secondSenderId,
        body: 'Thread two (not visible to actor)',
        bodyFormat: 'markdown',
        sentAt: new Date('2026-02-24T10:01:00.000Z'),
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        senderUserId: thirdSenderId,
        body: 'Thread three',
        bodyFormat: 'markdown',
        sentAt: new Date('2026-02-24T10:02:00.000Z'),
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        senderUserId: actorUserId,
        body: 'Thread four by actor',
        bodyFormat: 'markdown',
        sentAt: new Date('2026-02-24T10:03:00.000Z'),
      },
    ]

    const encryptedAnchorMessage = {
      ...anchorMessage,
      subject: 'ciphertext-anchor-subject',
      body: 'ciphertext-anchor-body',
    }

    const em = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === MessageRecipient && where.messageId === anchorMessage.id) {
          return {
            messageId: anchorMessage.id,
            recipientUserId: actorUserId,
            status: 'read',
            readAt: new Date('2026-02-24T10:05:00.000Z'),
            deletedAt: null,
          }
        }
        return null
      }),
      find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === MessageObject) return []
        if (entity === Message && where.threadId === threadId) return threadMessages
        if (entity === MessageRecipient && where.messageId === anchorMessage.id) {
          return [{
            recipientUserId: actorUserId,
            recipientType: 'to',
            status: 'read',
            readAt: new Date('2026-02-24T10:05:00.000Z'),
            deletedAt: null,
          }]
        }
        if (entity === MessageRecipient && typeof where.recipientUserId === 'string') {
          return [
            { messageId: anchorMessage.id },
            { messageId: '44444444-4444-4444-8444-444444444444' },
          ]
        }
        return []
      }),
    }

    findWithDecryptionMock.mockImplementation(async (_entityManager: unknown, entity: unknown) => {
      if (entity === Message) return threadMessages
      if (entity !== User) return []
      return [
        { id: senderUserId, name: 'Sender User', email: 'sender@example.com' },
        { id: secondSenderId, name: 'Hidden Sender', email: 'hidden@example.com' },
        { id: thirdSenderId, name: 'Thread Sender', email: 'thread@example.com' },
        { id: actorUserId, name: 'Actor User', email: 'actor@example.com' },
      ]
    })

    findOneWithDecryptionMock.mockImplementation(async (_entityManager: unknown, entity: unknown) => {
      if (entity === Message) return encryptedAnchorMessage
      if (entity === User) {
        return {
          id: senderUserId,
          name: 'Sender User',
          email: 'sender@example.com',
        }
      }
      return null
    })

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            return null
          },
        },
      },
      scope: {
        tenantId,
        organizationId,
        userId: actorUserId,
      },
    })

    const response = await GET(
      new Request(`http://localhost/api/messages/${anchorMessage.id}?skipMarkRead=1`),
      { params: { id: anchorMessage.id } },
    )

    expect(response.status).toBe(200)
    const payload = await response.json() as { thread?: Array<{ id?: string }> }
    const threadIds = (payload.thread ?? []).map((item) => item.id)

    expect(threadIds).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ])
    expect(threadIds).not.toContain('33333333-3333-4333-8333-333333333333')

    const visibilityFindCall = em.find.mock.calls.find(([entity, where]: [unknown, Record<string, unknown>]) => (
      entity === MessageRecipient && typeof where.recipientUserId === 'string'
    ))
    expect(visibilityFindCall).toBeTruthy()
    expect(visibilityFindCall?.[1]).toEqual(expect.objectContaining({
      recipientUserId: actorUserId,
      deletedAt: null,
    }))
    expect(payload).toEqual(expect.objectContaining({
      canArchive: true,
      isArchived: false,
      subject: encryptedAnchorMessage.subject,
      body: encryptedAnchorMessage.body,
    }))
    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      em,
      Message,
      expect.objectContaining({
        id: anchorMessage.id,
        tenantId,
        deletedAt: null,
      }),
      undefined,
      { tenantId, organizationId },
    )
  })

  it('marks sender-only details as not archivable by the current actor', async () => {
    const actorUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const tenantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const organizationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const messageId = '22222222-2222-4222-8222-222222222222'

    const message = {
      id: messageId,
      threadId: messageId,
      senderUserId: actorUserId,
      organizationId,
      tenantId,
      deletedAt: null,
      isDraft: false,
      type: 'system',
      visibility: 'internal',
      sourceEntityType: null,
      sourceEntityId: null,
      externalEmail: null,
      externalName: null,
      parentMessageId: null,
      subject: 'Sender-only subject',
      body: 'Sender-only body',
      bodyFormat: 'markdown',
      priority: 'normal',
      sentAt: new Date('2026-02-24T10:00:00.000Z'),
      actionData: null,
      actionTaken: null,
      actionTakenAt: null,
      actionTakenByUserId: null,
    }

    const em = {
      findOne: jest.fn(async () => null),
      find: jest.fn(async (entity: unknown) => {
        if (entity === MessageObject) return []
        if (entity === MessageRecipient) return []
        return []
      }),
    }

    findWithDecryptionMock.mockImplementation(async (_entityManager: unknown, entity: unknown) => {
      if (entity === Message) return [message]
      if (entity === User) {
        return [{ id: actorUserId, name: 'Actor User', email: 'actor@example.com' }]
      }
      return []
    })

    findOneWithDecryptionMock.mockImplementation(async (_entityManager: unknown, entity: unknown) => {
      if (entity === Message) return message
      if (entity === User) {
        return { id: actorUserId, name: 'Actor User', email: 'actor@example.com' }
      }
      return null
    })

    resolveMessageContextMock.mockResolvedValue({
      ctx: {
        container: {
          resolve: (name: string) => {
            if (name === 'em') return em
            return null
          },
        },
      },
      scope: {
        tenantId,
        organizationId,
        userId: actorUserId,
      },
    })

    const response = await GET(
      new Request(`http://localhost/api/messages/${messageId}?skipMarkRead=1`),
      { params: { id: messageId } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      canArchive: false,
      isArchived: false,
      senderUserId: actorUserId,
    }))
  })

  async function getDetailWithRecipientStatus(status: 'archived' | 'unread' | 'read') {
    const actorUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const tenantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const organizationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const threadId = '11111111-1111-4111-8111-111111111111'
    const anchorId = '22222222-2222-4222-8222-222222222222'

    const anchorMessage = {
      id: anchorId,
      threadId,
      senderUserId: actorUserId,
      organizationId,
      tenantId,
      deletedAt: null,
      isDraft: false,
      type: 'system',
      visibility: 'internal',
      sourceEntityType: null,
      sourceEntityId: null,
      externalEmail: null,
      externalName: null,
      parentMessageId: null,
      subject: 'Subject',
      body: 'Body',
      bodyFormat: 'markdown',
      priority: 'normal',
      sentAt: new Date('2026-02-24T10:00:00.000Z'),
      actionData: null,
      actionTaken: null,
      actionTakenAt: null,
      actionTakenByUserId: null,
    }
    const threadMessages = [{
      id: anchorId,
      senderUserId: actorUserId,
      body: 'Body',
      bodyFormat: 'markdown',
      sentAt: anchorMessage.sentAt,
    }]

    const em = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === MessageRecipient && where.messageId === anchorId) {
          return {
            messageId: anchorId,
            recipientUserId: actorUserId,
            status,
            readAt: status === 'read' ? new Date('2026-02-24T10:05:00.000Z') : null,
            archivedAt: status === 'archived' ? new Date('2026-02-24T10:05:00.000Z') : null,
            deletedAt: null,
          }
        }
        return null
      }),
      find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === MessageObject) return []
        if (entity === MessageRecipient && typeof where.recipientUserId === 'string') {
          return [{ messageId: anchorId, status }]
        }
        return []
      }),
    }

    findWithDecryptionMock.mockImplementation(async (_entityManager: unknown, entity: unknown) => {
      if (entity === Message) return threadMessages
      if (entity === User) return [{ id: actorUserId, name: 'Actor User', email: 'actor@example.com' }]
      return []
    })
    findOneWithDecryptionMock.mockImplementation(async (_entityManager: unknown, entity: unknown) => {
      if (entity === Message) return anchorMessage
      if (entity === User) return { id: actorUserId, name: 'Actor User', email: 'actor@example.com' }
      return null
    })
    resolveMessageContextMock.mockResolvedValue({
      ctx: { container: { resolve: (name: string) => (name === 'em' ? em : null) } },
      scope: { tenantId, organizationId, userId: actorUserId },
    })

    const response = await GET(
      new Request(`http://localhost/api/messages/${anchorId}?skipMarkRead=1`),
      { params: { id: anchorId } },
    )
    expect(response.status).toBe(200)
    return response.json() as Promise<{ conversationArchived?: boolean; conversationAllUnread?: boolean }>
  }

  it('reports conversationArchived when every actor recipient row is archived', async () => {
    const payload = await getDetailWithRecipientStatus('archived')
    expect(payload.conversationArchived).toBe(true)
    expect(payload.conversationAllUnread).toBe(false)
  })

  it('reports conversationAllUnread when every actor recipient row is unread', async () => {
    const payload = await getDetailWithRecipientStatus('unread')
    expect(payload.conversationAllUnread).toBe(true)
    expect(payload.conversationArchived).toBe(false)
  })

  it('reports neither flag when the conversation is read', async () => {
    const payload = await getDetailWithRecipientStatus('read')
    expect(payload.conversationArchived).toBe(false)
    expect(payload.conversationAllUnread).toBe(false)
  })
})

describe('messages /api/messages/[id] PATCH', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('accepts a draft update with an empty body and forwards it to the command bus', async () => {
    const tenantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const organizationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const messageId = '22222222-2222-4222-8222-222222222222'

    const draftMessage = {
      id: messageId,
      tenantId,
      organizationId,
      senderUserId: userId,
      isDraft: true,
      deletedAt: null,
    }

    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(draftMessage),
    }
    const commandBus = {
      execute: jest.fn().mockResolvedValue({ result: { ok: true, id: messageId }, logEntry: null }),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        return null
      },
    }

    resolveMessageContextMock.mockResolvedValue({
      ctx: { container, auth: null },
      scope: { tenantId, organizationId, userId },
    })

    const request = new Request('https://example.test/api/messages/22222222-2222-4222-8222-222222222222', {
      method: 'PATCH',
      body: JSON.stringify({
        subject: 'Updated draft subject',
        body: '',
        recipients: [{ userId: '11111111-1111-4111-8111-111111111111', type: 'to' }],
      }),
    })

    const response = await PATCH(request, { params: { id: messageId } })

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const [commandId, args] = commandBus.execute.mock.calls[0]
    expect(commandId).toBe('messages.messages.update_draft')
    expect(args.input).toEqual(expect.objectContaining({
      messageId,
      subject: 'Updated draft subject',
      body: '',
      tenantId,
      organizationId,
      userId,
    }))
  })
})

describe('messages /api/messages/[id] optimistic locking', () => {
  const tenantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const organizationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const messageId = '22222222-2222-4222-8222-222222222222'
  const currentUpdatedAt = new Date('2026-02-24T10:00:00.000Z')

  function setupDraft(overrides: Record<string, unknown> = {}) {
    const draftMessage = {
      id: messageId,
      tenantId,
      organizationId,
      senderUserId: userId,
      isDraft: true,
      deletedAt: null,
      updatedAt: currentUpdatedAt,
      ...overrides,
    }
    const em = {
      fork: jest.fn().mockReturnThis(),
      findOne: jest.fn().mockResolvedValue(draftMessage),
    }
    const commandBus = {
      execute: jest.fn().mockResolvedValue({ result: { ok: true, id: messageId }, logEntry: null }),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        return null
      },
    }
    resolveMessageContextMock.mockResolvedValue({
      ctx: { container, auth: null },
      scope: { tenantId, organizationId, userId },
    })
    return { commandBus }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    hasOrganizationAccessMock.mockReturnValue(true)
  })

  it('rejects a stale draft PATCH with a structured 409 and leaves the message untouched', async () => {
    const { commandBus } = setupDraft()
    const request = new Request(`https://example.test/api/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-02-24T09:00:00.000Z',
      },
      body: JSON.stringify({ subject: 'Stale edit', body: 'Stale body' }),
    })

    const response = await PATCH(request, { params: { id: messageId } })

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body).toEqual(expect.objectContaining({
      code: 'optimistic_lock_conflict',
      currentUpdatedAt: currentUpdatedAt.toISOString(),
      expectedUpdatedAt: '2026-02-24T09:00:00.000Z',
    }))
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('allows a draft PATCH whose expected version matches the current one', async () => {
    const { commandBus } = setupDraft()
    const request = new Request(`https://example.test/api/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        [OPTIMISTIC_LOCK_HEADER_NAME]: currentUpdatedAt.toISOString(),
      },
      body: JSON.stringify({ subject: 'Fresh edit', body: 'Fresh body' }),
    })

    const response = await PATCH(request, { params: { id: messageId } })

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale draft DELETE with a structured 409', async () => {
    const { commandBus } = setupDraft()
    const request = new Request(`https://example.test/api/messages/${messageId}`, {
      method: 'DELETE',
      headers: {
        [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-02-24T09:00:00.000Z',
      },
    })

    const response = await DELETE(request, { params: { id: messageId } })

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body).toEqual(expect.objectContaining({ code: 'optimistic_lock_conflict' }))
    expect(commandBus.execute).not.toHaveBeenCalled()
  })
})
