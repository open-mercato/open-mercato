import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { Message, MessageRecipient } from '../data/entities'
import { emitMessagesEvent } from '../events'
import { assertOrganizationAccess, type MessageScopeInput } from './shared'

const conversationCommandSchema = z.object({
  anchorMessageId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
})

type ConversationCommandInput = z.infer<typeof conversationCommandSchema>

type ConversationScope = {
  anchorMessageId: string
  messageIds: string[]
  recipientMessageIds: Set<string>
  senderMessageIds: Set<string>
}

async function resolveConversationScope(
  em: EntityManager,
  input: ConversationCommandInput,
): Promise<ConversationScope> {
  const anchorMessage = await em.findOne(Message, {
    id: input.anchorMessageId,
    tenantId: input.tenantId,
    deletedAt: null,
  })

  if (!anchorMessage) throw new Error('Message not found')
  assertOrganizationAccess(input as MessageScopeInput, anchorMessage)

  const anchorRecipient = await em.findOne(MessageRecipient, {
    messageId: input.anchorMessageId,
    recipientUserId: input.userId,
    deletedAt: null,
  })

  const canAccessAnchor = anchorMessage.senderUserId === input.userId || Boolean(anchorRecipient)
  if (!canAccessAnchor) throw new Error('Access denied')

  const threadId = anchorMessage.threadId ?? anchorMessage.id
  const conversationMessages = await em.find(
    Message,
    {
      threadId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      isDraft: false,
    },
    {
      orderBy: {
        sentAt: 'ASC',
        createdAt: 'ASC',
        id: 'ASC',
      },
    },
  )

  const messagesById = new Map<string, Message>(conversationMessages.map((message) => [message.id, message]))
  messagesById.set(anchorMessage.id, anchorMessage)

  if (anchorMessage.threadId && !messagesById.has(anchorMessage.threadId)) {
    const threadRoot = await em.findOne(Message, {
      id: anchorMessage.threadId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      isDraft: false,
    })
    if (threadRoot) {
      messagesById.set(threadRoot.id, threadRoot)
    }
  }

  let parentMessageId = anchorMessage.parentMessageId ?? null
  while (parentMessageId) {
    if (messagesById.has(parentMessageId)) break
    const parentMessage = await em.findOne(Message, {
      id: parentMessageId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      isDraft: false,
    })
    if (!parentMessage) break
    messagesById.set(parentMessage.id, parentMessage)
    parentMessageId = parentMessage.parentMessageId ?? null
  }

  let frontier = Array.from(messagesById.keys())
  while (frontier.length > 0) {
    const children = await em.find(Message, {
      parentMessageId: { $in: frontier },
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
      isDraft: false,
    })

    const nextFrontier: string[] = []
    for (const child of children) {
      if (messagesById.has(child.id)) continue
      messagesById.set(child.id, child)
      nextFrontier.push(child.id)
    }
    frontier = nextFrontier
  }

  const scopedMessages = Array.from(messagesById.values())
  const messageIds = scopedMessages.map((message) => message.id)
  const recipientRows = messageIds.length > 0
    ? await em.find(MessageRecipient, {
      messageId: { $in: messageIds },
      recipientUserId: input.userId,
      deletedAt: null,
    })
    : []

  const recipientMessageIds = new Set(recipientRows.map((item) => item.messageId))
  const senderMessageIds = new Set(
    scopedMessages
      .filter((item) => item.senderUserId === input.userId)
      .map((item) => item.id),
  )

  const visibleMessageIds = scopedMessages
    .map((item) => item.id)
    .filter((messageId) => recipientMessageIds.has(messageId) || senderMessageIds.has(messageId))

  if (visibleMessageIds.length === 0) throw new Error('Access denied')

  return {
    anchorMessageId: anchorMessage.id,
    messageIds: visibleMessageIds,
    recipientMessageIds,
    senderMessageIds,
  }
}

const archiveConversationForActorCommand: CommandHandler<unknown, { ok: true; affectedCount: number }> = {
  id: 'messages.conversation.archive_for_actor',
  async execute(rawInput, ctx) {
    const input = conversationCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = await resolveConversationScope(em, input)
    const messageIdsToArchive = scope.messageIds.filter((messageId) => scope.recipientMessageIds.has(messageId))

    if (messageIdsToArchive.length === 0) {
      return { ok: true, affectedCount: 0 }
    }

    const archivedAt = new Date()
    const archivedIds: string[] = []
    await em.transactional(async (trx) => {
      const recipients = await trx.find(MessageRecipient, {
        messageId: { $in: messageIdsToArchive },
        recipientUserId: input.userId,
        deletedAt: null,
      })
      for (const recipient of recipients) {
        if (recipient.status !== 'archived' || recipient.archivedAt === null) {
          recipient.archivedAt = archivedAt
          recipient.status = 'archived'
          archivedIds.push(recipient.messageId)
        }
      }
    })

    for (const messageId of archivedIds) {
      await emitMessagesEvent('messages.message.archived', {
        messageId,
        recipientUserId: input.userId,
        userId: input.userId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }, { persistent: true })
    }

    return { ok: true, affectedCount: archivedIds.length }
  },
}

const markConversationUnreadForActorCommand: CommandHandler<unknown, { ok: true; affectedCount: number }> = {
  id: 'messages.conversation.mark_unread_for_actor',
  async execute(rawInput, ctx) {
    const input = conversationCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = await resolveConversationScope(em, input)
    const messageIdsToMarkUnread = scope.messageIds.filter((messageId) => scope.recipientMessageIds.has(messageId))

    if (messageIdsToMarkUnread.length === 0) {
      return { ok: true, affectedCount: 0 }
    }

    const markedIds: string[] = []
    await em.transactional(async (trx) => {
      const recipients = await trx.find(MessageRecipient, {
        messageId: { $in: messageIdsToMarkUnread },
        recipientUserId: input.userId,
        deletedAt: null,
      })
      for (const recipient of recipients) {
        if (recipient.status !== 'unread' || recipient.readAt !== null) {
          recipient.status = 'unread'
          recipient.readAt = null
          markedIds.push(recipient.messageId)
        }
      }
    })

    for (const messageId of markedIds) {
      await emitMessagesEvent('messages.message.marked_unread', {
        messageId,
        recipientUserId: input.userId,
        userId: input.userId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }, { persistent: true })
    }

    return { ok: true, affectedCount: markedIds.length }
  },
}

type DeletedTarget = { messageId: string; target: 'sender' | 'recipient' }

const deleteConversationForActorCommand: CommandHandler<unknown, { ok: true; affectedCount: number }> = {
  id: 'messages.conversation.delete_for_actor',
  async execute(rawInput, ctx) {
    const input = conversationCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = await resolveConversationScope(em, input)
    const messageIdsToDelete = scope.messageIds.filter(
      (messageId) => scope.recipientMessageIds.has(messageId) || scope.senderMessageIds.has(messageId),
    )

    if (messageIdsToDelete.length === 0) {
      return { ok: true, affectedCount: 0 }
    }

    const deletedNow = new Date()
    const deletedTargets: DeletedTarget[] = []
    await em.transactional(async (trx) => {
      for (const messageId of messageIdsToDelete) {
        const recipient = await trx.findOne(MessageRecipient, {
          messageId,
          recipientUserId: input.userId,
          deletedAt: null,
        })
        if (recipient) {
          recipient.status = 'deleted'
          recipient.deletedAt = deletedNow
          deletedTargets.push({ messageId, target: 'recipient' })
          continue
        }
        if (scope.senderMessageIds.has(messageId)) {
          const message = await trx.findOne(Message, {
            id: messageId,
            tenantId: input.tenantId,
            deletedAt: null,
          })
          if (message && message.senderUserId === input.userId) {
            message.deletedAt = deletedNow
            deletedTargets.push({ messageId, target: 'sender' })
          }
        }
      }
    })

    for (const { messageId, target } of deletedTargets) {
      await emitMessagesEvent('messages.message.deleted', {
        messageId,
        actorUserId: input.userId,
        target,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }, { persistent: true })
    }

    return { ok: true, affectedCount: deletedTargets.length }
  },
}

registerCommand(archiveConversationForActorCommand)
registerCommand(markConversationUnreadForActorCommand)
registerCommand(deleteConversationForActorCommand)
