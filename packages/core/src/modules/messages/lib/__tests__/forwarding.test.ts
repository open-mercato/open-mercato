import { buildForwardThreadSlice } from '../forwarding'
import { Message, MessageRecipient } from '../../data/entities'

describe('buildForwardThreadSlice', () => {
  const tenantId = 'tenant-1'
  const organizationId = 'org-1'
  const actorUserId = 'user-actor'
  const otherUserId = 'user-other'

  function makeMessage(id: string, senderUserId: string, sentAt: Date): Message {
    return {
      id,
      senderUserId,
      subject: `subject-${id}`,
      body: `body-${id}`,
      sentAt,
      createdAt: sentAt,
      threadId: null,
      parentMessageId: null,
      tenantId,
      organizationId,
      deletedAt: null,
      isDraft: false,
    } as unknown as Message
  }

  it('includes only messages the actor sent or received when userId is provided', async () => {
    const anchorId = 'msg-anchor'
    const visibleId = 'msg-visible'
    const hiddenId = 'msg-hidden'

    const anchor = makeMessage(anchorId, actorUserId, new Date('2026-01-01T12:00:00Z'))
    const visible = makeMessage(visibleId, otherUserId, new Date('2026-01-01T11:00:00Z'))
    const hidden = makeMessage(hiddenId, otherUserId, new Date('2026-01-01T10:00:00Z'))

    anchor.threadId = anchorId

    const em = {
      find: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === Message) {
          if ((where as Record<string, unknown>).threadId === anchorId) {
            return [anchor, visible, hidden]
          }
          return []
        }
        if (entity === MessageRecipient) {
          return [
            { messageId: visibleId, recipientUserId: actorUserId },
          ]
        }
        return []
      }),
      findOne: jest.fn(async () => null),
    }

    const slice = await buildForwardThreadSlice(
      em as never,
      { tenantId, organizationId, userId: actorUserId },
      anchor,
    )

    const sliceIds = slice.map((item) => item.id)
    expect(sliceIds).toContain(anchorId)
    expect(sliceIds).toContain(visibleId)
    expect(sliceIds).not.toContain(hiddenId)
  })

  it('includes all thread messages when userId is not provided', async () => {
    const anchorId = 'msg-anchor-2'
    const otherId = 'msg-other-2'

    const anchor = makeMessage(anchorId, actorUserId, new Date('2026-01-01T12:00:00Z'))
    const other = makeMessage(otherId, otherUserId, new Date('2026-01-01T11:00:00Z'))
    anchor.threadId = anchorId

    const em = {
      find: jest.fn(async (entity: unknown) => {
        if (entity === Message) return [anchor, other]
        return []
      }),
      findOne: jest.fn(async () => null),
    }

    const slice = await buildForwardThreadSlice(
      em as never,
      { tenantId, organizationId },
      anchor,
    )

    const sliceIds = slice.map((item) => item.id)
    expect(sliceIds).toContain(anchorId)
    expect(sliceIds).toContain(otherId)
  })

  it('includes messages the actor sent even if not in recipient list', async () => {
    const anchorId = 'msg-anchor-3'
    const actorSentId = 'msg-actor-sent'

    const anchor = makeMessage(anchorId, actorUserId, new Date('2026-01-01T12:00:00Z'))
    const actorSent = makeMessage(actorSentId, actorUserId, new Date('2026-01-01T11:00:00Z'))
    anchor.threadId = anchorId

    const em = {
      find: jest.fn(async (entity: unknown) => {
        if (entity === Message) return [anchor, actorSent]
        if (entity === MessageRecipient) return []
        return []
      }),
      findOne: jest.fn(async () => null),
    }

    const slice = await buildForwardThreadSlice(
      em as never,
      { tenantId, organizationId, userId: actorUserId },
      anchor,
    )

    const sliceIds = slice.map((item) => item.id)
    expect(sliceIds).toContain(anchorId)
    expect(sliceIds).toContain(actorSentId)
  })
})
