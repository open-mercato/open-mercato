import { GET } from '@open-mercato/core/modules/messages/api/[id]/route'
import { Message, MessageObject, MessageRecipient } from '@open-mercato/core/modules/messages/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'

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

    const em = {
      findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === Message && where.id === anchorMessage.id) return anchorMessage
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
      if (entity !== User) return []
      return [
        { id: senderUserId, name: 'Sender User', email: 'sender@example.com' },
        { id: secondSenderId, name: 'Hidden Sender', email: 'hidden@example.com' },
        { id: thirdSenderId, name: 'Thread Sender', email: 'thread@example.com' },
        { id: actorUserId, name: 'Actor User', email: 'actor@example.com' },
      ]
    })

    findOneWithDecryptionMock.mockResolvedValue({
      id: senderUserId,
      name: 'Sender User',
      email: 'sender@example.com',
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
  })
})
