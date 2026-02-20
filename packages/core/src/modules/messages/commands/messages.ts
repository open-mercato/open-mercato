import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { Message, MessageObject, MessageRecipient, type MessageActionData } from '../data/entities'
import { emitMessagesEvent } from '../events'
import {
  composeMessageSchema,
  forwardMessageSchema,
  replyMessageSchema,
  updateDraftSchema,
} from '../data/validators'
import { linkAttachmentsToMessage, linkLibraryAttachmentsToMessage, copyAttachmentsForForward } from '../lib/attachments'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../lib/constants'
import { getMessageTypeOrDefault, isMessageTypeCreateableByUser } from '../lib/message-types-registry'
import { validateMessageObjectsForType } from '../lib/object-validation'
import {
  assertOrganizationAccess,
  loadMessageAggregateSnapshot,
  restoreMessageAggregateSnapshot,
  type MessageAggregateSnapshot,
  type MessageScopeInput,
} from './shared'

type MessageSentEventPayload = {
  messageId: string
  senderUserId: string
  recipientUserIds: string[]
  sendViaEmail: boolean
  externalEmail?: string | null
  forwardedFrom?: string
  replyTo?: string
  tenantId: string
  organizationId?: string | null
}

type ContainerWithResolve = {
  resolve: (name: string) => unknown
}

async function emitMessageSentEvent(_container: ContainerWithResolve, payload: MessageSentEventPayload) {
  await emitMessagesEvent('messages.sent', payload, { persistent: true })
}

async function emitMessageDeletedEvent(_container: ContainerWithResolve, payload: {
  messageId: string
  actorUserId: string
  target: 'sender' | 'recipient'
  tenantId: string
  organizationId: string | null
}) {
  await emitMessagesEvent('messages.deleted', payload, { persistent: true })
}

const scopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
})

const composeCommandSchema = composeMessageSchema.safeExtend({
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

const updateDraftCommandSchema = updateDraftSchema.safeExtend({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

const replyCommandSchema = replyMessageSchema.safeExtend({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

const forwardCommandSchema = forwardMessageSchema.safeExtend({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

const deleteForActorCommandSchema = z.object({
  messageId: z.string().uuid(),
  tenantId: scopeSchema.shape.tenantId,
  organizationId: scopeSchema.shape.organizationId,
  userId: scopeSchema.shape.userId,
})

type ComposeCommandInput = z.infer<typeof composeCommandSchema>
type UpdateDraftCommandInput = z.infer<typeof updateDraftCommandSchema>
type ReplyCommandInput = z.infer<typeof replyCommandSchema>
type ForwardCommandInput = z.infer<typeof forwardCommandSchema>
type DeleteForActorCommandInput = z.infer<typeof deleteForActorCommandSchema>

type MessageDeleteUndoState = {
  messageId: string
  messageDeletedAt: string | null
  recipientId: string | null
  recipientStatus: 'unread' | 'read' | 'archived' | 'deleted' | null
  recipientDeletedAt: string | null
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(value)
}

function buildReplySubject(subject: string): string {
  if (/^re:\s*/i.test(subject)) return subject
  return `Re: ${subject}`
}

async function requireMessageById(
  em: EntityManager,
  scope: MessageScopeInput,
  messageId: string,
) {
  const message = await em.findOne(Message, {
    id: messageId,
    tenantId: scope.tenantId,
    deletedAt: null,
  })
  if (!message) throw new Error('Message not found')
  assertOrganizationAccess(scope, message)
  return message
}

const composeMessageCommand: CommandHandler<unknown, { id: string; threadId: string | null; externalEmail: string | null; isDraft: boolean; recipientUserIds: string[] }> = {
  id: 'messages.messages.compose',
  async execute(rawInput, ctx) {
    const input = composeCommandSchema.parse(rawInput)
    if (!isMessageTypeCreateableByUser(input.type)) {
      throw new Error('Message type cannot be created by users')
    }
    if (input.objects?.length) {
      const objectValidationError = validateMessageObjectsForType(input.type, input.objects)
      if (objectValidationError) throw new Error(objectValidationError)
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let messageId = ''
    let responseThreadId: string | null = null
    let responseExternalEmail: string | null = null

    await em.transactional(async (trx) => {
      const threadId = input.parentMessageId
        ? (
          await trx.findOne(Message, {
            id: input.parentMessageId,
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            deletedAt: null,
          })
        )?.threadId ?? input.parentMessageId
        : undefined

      const isPublicVisibility = input.visibility === 'public'
      const sendViaEmail = isPublicVisibility ? true : input.sendViaEmail
      const message = trx.create(Message, {
        type: input.type,
        visibility: input.visibility ?? null,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        externalEmail: input.externalEmail,
        externalName: input.externalName,
        threadId: threadId ?? undefined,
        parentMessageId: input.parentMessageId,
        senderUserId: input.userId,
        subject: input.subject,
        body: input.body,
        bodyFormat: input.bodyFormat,
        priority: input.priority,
        status: input.isDraft ? 'draft' : 'sent',
        isDraft: input.isDraft ?? false,
        sentAt: input.isDraft ? null : new Date(),
        actionData: input.actionData as MessageActionData | undefined,
        sendViaEmail,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })

      if (!threadId && !input.isDraft) {
        message.threadId = message.id
      }

      await trx.persistAndFlush(message)

      for (const recipient of input.recipients) {
        trx.persist(trx.create(MessageRecipient, {
          messageId: message.id,
          recipientUserId: recipient.userId,
          recipientType: recipient.type,
          status: 'unread',
        }))
      }

      if (input.objects) {
        for (const obj of input.objects) {
          trx.persist(trx.create(MessageObject, {
            messageId: message.id,
            entityModule: obj.entityModule,
            entityType: obj.entityType,
            entityId: obj.entityId,
            actionRequired: obj.actionRequired,
            actionType: obj.actionType,
            actionLabel: obj.actionLabel,
          }))
        }
      }

      await trx.flush()

      if (input.attachmentIds?.length) {
        await linkAttachmentsToMessage(
          trx,
          message.id,
          input.attachmentIds,
          input.organizationId,
          input.tenantId,
        )
      }

      if (input.attachmentRecordId) {
        await linkLibraryAttachmentsToMessage(
          trx,
          message.id,
          input.attachmentRecordId,
          input.organizationId,
          input.tenantId,
        )
      }

      messageId = message.id
      responseThreadId = message.threadId ?? null
      responseExternalEmail = message.externalEmail ?? null
    })

    if (!input.isDraft) {
      await emitMessageSentEvent(ctx.container, {
        messageId,
        senderUserId: input.userId,
        recipientUserIds: input.recipients.map((recipient) => recipient.userId),
        sendViaEmail: input.visibility === 'public' ? true : input.sendViaEmail,
        externalEmail: responseExternalEmail,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
    }

    return {
      id: messageId,
      threadId: responseThreadId,
      externalEmail: responseExternalEmail,
      isDraft: input.isDraft,
      recipientUserIds: input.recipients.map((recipient) => recipient.userId),
    }
  },
  async captureAfter(_input, result, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, result.id)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = composeCommandSchema.parse(input)
    return {
      actionLabel: parsed.isDraft ? 'Create draft message' : 'Compose message',
      resourceKind: 'messages.message',
      resourceId: result.id,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageAggregateSnapshot>>(logEntry)
    const after = undo?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: after.message.id })
    if (!message) return
    message.deletedAt = new Date()
    await em.flush()
  },
}

const updateDraftCommand: CommandHandler<unknown, { ok: true; id: string }> = {
  id: 'messages.messages.update_draft',
  async prepare(rawInput, ctx) {
    const input = updateDraftCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadMessageAggregateSnapshot(em, input.messageId, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const input = updateDraftCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireMessageById(em, input, input.messageId)

    if (message.senderUserId !== input.userId) throw new Error('Access denied')
    if (!message.isDraft) throw new Error('Only draft messages can be edited')

    const nextMessageType = input.type ?? message.type
    if (input.type !== undefined && !isMessageTypeCreateableByUser(input.type)) {
      throw new Error('Message type cannot be created by users')
    }
    if (input.objects) {
      const objectValidationError = validateMessageObjectsForType(nextMessageType, input.objects)
      if (objectValidationError) throw new Error(objectValidationError)
    } else if (input.type !== undefined) {
      const existingObjects = await em.find(MessageObject, { messageId: message.id })
      if (existingObjects.length > 0) {
        const objectValidationError = validateMessageObjectsForType(
          nextMessageType,
          existingObjects.map((item) => ({
            entityModule: item.entityModule,
            entityType: item.entityType,
            entityId: item.entityId,
          })),
        )
        if (objectValidationError) throw new Error(objectValidationError)
      }
    }

    if (input.type !== undefined) message.type = input.type
    if (input.visibility !== undefined) message.visibility = input.visibility
    if (input.sourceEntityType !== undefined) message.sourceEntityType = input.sourceEntityType
    if (input.sourceEntityId !== undefined) message.sourceEntityId = input.sourceEntityId
    if (input.externalEmail !== undefined) message.externalEmail = input.externalEmail
    if (input.externalName !== undefined) message.externalName = input.externalName
    if (input.subject !== undefined) message.subject = input.subject
    if (input.body !== undefined) message.body = input.body
    if (input.bodyFormat !== undefined) message.bodyFormat = input.bodyFormat
    if (input.priority !== undefined) message.priority = input.priority
    if (input.actionData !== undefined) message.actionData = input.actionData
    if (input.sendViaEmail !== undefined) message.sendViaEmail = input.sendViaEmail

    if (input.recipients) {
      await em.nativeDelete(MessageRecipient, { messageId: message.id })
      for (const recipient of input.recipients) {
        em.persist(em.create(MessageRecipient, {
          messageId: message.id,
          recipientUserId: recipient.userId,
          recipientType: recipient.type,
          status: 'unread',
        }))
      }
    }

    if (input.objects) {
      await em.nativeDelete(MessageObject, { messageId: message.id })
      for (const object of input.objects) {
        em.persist(em.create(MessageObject, {
          messageId: message.id,
          entityModule: object.entityModule,
          entityType: object.entityType,
          entityId: object.entityId,
          actionRequired: object.actionRequired,
          actionType: object.actionType,
          actionLabel: object.actionLabel,
        }))
      }
    }

    if (input.attachmentIds) {
      const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
      if (input.attachmentIds.length === 0) {
        await em.nativeDelete(Attachment, {
          entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
          recordId: message.id,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
        })
      } else {
        await em.nativeDelete(Attachment, {
          entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
          recordId: message.id,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          id: { $nin: input.attachmentIds },
        })
      }
      await linkAttachmentsToMessage(
        em,
        message.id,
        input.attachmentIds,
        input.organizationId,
        input.tenantId,
      )
    }

    await em.flush()
    return { ok: true, id: message.id }
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = updateDraftCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, input.messageId, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = updateDraftCommandSchema.parse(input)
    return {
      actionLabel: 'Update draft message',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: (snapshots.before as MessageAggregateSnapshot | undefined) ?? null,
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageAggregateSnapshot>>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restoreMessageAggregateSnapshot(em, before)
  },
}

const replyMessageCommand: CommandHandler<unknown, { id: string; externalEmail: string | null; recipientUserIds: string[] }> = {
  id: 'messages.messages.reply',
  async execute(rawInput, ctx) {
    const input = replyCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const original = await requireMessageById(em, input, input.messageId)
    const ownRecipient = await em.findOne(MessageRecipient, {
      messageId: original.id,
      recipientUserId: input.userId,
      deletedAt: null,
    })
    if (original.senderUserId !== input.userId && !ownRecipient) throw new Error('Access denied')

    const messageType = getMessageTypeOrDefault(original.type)
    if (messageType.allowReply === false) throw new Error('Reply is not allowed for this message type')

    const originalRecipients = await em.find(MessageRecipient, { messageId: original.id, deletedAt: null })
    const recipientIds = new Set<string>()
    if (input.replyAll) {
      if (original.senderUserId !== input.userId) recipientIds.add(original.senderUserId)
      for (const recipient of originalRecipients) {
        if (recipient.recipientUserId !== input.userId) recipientIds.add(recipient.recipientUserId)
      }
    } else if (original.senderUserId !== input.userId) {
      recipientIds.add(original.senderUserId)
    } else {
      for (const recipient of originalRecipients) {
        if (recipient.recipientUserId !== input.userId) {
          recipientIds.add(recipient.recipientUserId)
          break
        }
      }
    }
    if (recipientIds.size === 0) throw new Error('No recipients available for reply')

    let messageId = ''
    let responseExternalEmail: string | null = null
    await em.transactional(async (trx) => {
      const message = trx.create(Message, {
        type: original.type,
        visibility: original.visibility ?? null,
        sourceEntityType: original.sourceEntityType,
        sourceEntityId: original.sourceEntityId,
        externalEmail: original.externalEmail,
        externalName: original.externalName,
        threadId: original.threadId ?? original.id,
        parentMessageId: original.id,
        senderUserId: input.userId,
        subject: buildReplySubject(original.subject),
        body: input.body,
        bodyFormat: input.bodyFormat,
        priority: original.priority,
        status: 'sent',
        isDraft: false,
        sentAt: new Date(),
        sendViaEmail: input.sendViaEmail,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      await trx.persistAndFlush(message)
      for (const recipientUserId of recipientIds) {
        trx.persist(trx.create(MessageRecipient, {
          messageId: message.id,
          recipientUserId,
          recipientType: 'to',
          status: 'unread',
        }))
      }
      await trx.flush()
      if (input.attachmentIds?.length) {
        await linkAttachmentsToMessage(
          trx,
          message.id,
          input.attachmentIds,
          input.organizationId,
          input.tenantId,
        )
      }
      if (input.attachmentRecordId) {
        await linkLibraryAttachmentsToMessage(
          trx,
          message.id,
          input.attachmentRecordId,
          input.organizationId,
          input.tenantId,
        )
      }
      messageId = message.id
      responseExternalEmail = message.externalEmail ?? null
    })

    await emitMessageSentEvent(ctx.container, {
      messageId,
      senderUserId: input.userId,
      recipientUserIds: Array.from(recipientIds),
      sendViaEmail: input.sendViaEmail,
      externalEmail: responseExternalEmail,
      replyTo: original.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    return {
      id: messageId,
      externalEmail: responseExternalEmail,
      recipientUserIds: Array.from(recipientIds),
    }
  },
  async captureAfter(_input, result, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, result.id)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = replyCommandSchema.parse(input)
    return {
      actionLabel: 'Reply to message',
      resourceKind: 'messages.message',
      resourceId: result.id,
      parentResourceKind: 'messages.message',
      parentResourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageAggregateSnapshot>>(logEntry)
    const after = undo?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: after.message.id })
    if (!message) return
    message.deletedAt = new Date()
    await em.flush()
  },
}

const forwardMessageCommand: CommandHandler<unknown, { id: string; externalEmail: string | null; recipientUserIds: string[] }> = {
  id: 'messages.messages.forward',
  async execute(rawInput, ctx) {
    const input = forwardCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const original = await requireMessageById(em, input, input.messageId)
    const isRecipient = await em.findOne(MessageRecipient, {
      messageId: input.messageId,
      recipientUserId: input.userId,
      deletedAt: null,
    })
    if (original.senderUserId !== input.userId && !isRecipient) throw new Error('Access denied')

    const messageType = getMessageTypeOrDefault(original.type)
    if (messageType.allowForward === false) throw new Error('Forward is not allowed for this message type')

    const originalObjects = await em.find(MessageObject, { messageId: input.messageId })
    const forwardedBody = input.additionalBody
      ? `${input.additionalBody}\n\n---------- Forwarded message ----------\n\n${original.body}`
      : `---------- Forwarded message ----------\n\n${original.body}`
    let newMessageId = ''
    let responseExternalEmail: string | null = null
    await em.transactional(async (trx) => {
      const newMessage = trx.create(Message, {
        type: original.type,
        visibility: original.visibility ?? null,
        sourceEntityType: original.sourceEntityType,
        sourceEntityId: original.sourceEntityId,
        externalEmail: original.externalEmail,
        externalName: original.externalName,
        senderUserId: input.userId,
        subject: `Fwd: ${original.subject}`,
        body: forwardedBody,
        bodyFormat: original.bodyFormat,
        priority: original.priority,
        status: 'sent',
        isDraft: false,
        sentAt: new Date(),
        sendViaEmail: input.sendViaEmail,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      newMessage.threadId = newMessage.id
      await trx.persistAndFlush(newMessage)
      for (const recipient of input.recipients) {
        trx.persist(trx.create(MessageRecipient, {
          messageId: newMessage.id,
          recipientUserId: recipient.userId,
          recipientType: recipient.type,
          status: 'unread',
        }))
      }
      for (const obj of originalObjects) {
        trx.persist(trx.create(MessageObject, {
          messageId: newMessage.id,
          entityModule: obj.entityModule,
          entityType: obj.entityType,
          entityId: obj.entityId,
          actionRequired: obj.actionRequired,
          actionType: obj.actionType,
          actionLabel: obj.actionLabel,
          entitySnapshot: obj.entitySnapshot,
        }))
      }
      await trx.flush()
      if (input.includeAttachments !== false) {
        await copyAttachmentsForForward(
          trx,
          input.messageId,
          newMessage.id,
          input.organizationId,
          input.tenantId,
        )
      }
      newMessageId = newMessage.id
      responseExternalEmail = newMessage.externalEmail ?? null
    })

    await emitMessageSentEvent(ctx.container, {
      messageId: newMessageId,
      senderUserId: input.userId,
      recipientUserIds: input.recipients.map((item) => item.userId),
      sendViaEmail: input.sendViaEmail,
      externalEmail: responseExternalEmail,
      forwardedFrom: original.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })

    return {
      id: newMessageId,
      externalEmail: responseExternalEmail,
      recipientUserIds: input.recipients.map((item) => item.userId),
    }
  },
  async captureAfter(_input, result, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMessageAggregateSnapshot(em, result.id)
  },
  buildLog: async ({ input, result, snapshots }) => {
    const parsed = forwardCommandSchema.parse(input)
    return {
      actionLabel: 'Forward message',
      resourceKind: 'messages.message',
      resourceId: result.id,
      parentResourceKind: 'messages.message',
      parentResourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          after: (snapshots.after as MessageAggregateSnapshot | undefined) ?? null,
        } satisfies UndoPayload<MessageAggregateSnapshot>,
      },
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageAggregateSnapshot>>(logEntry)
    const after = undo?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: after.message.id })
    if (!message) return
    message.deletedAt = new Date()
    await em.flush()
  },
}

const deleteForActorCommand: CommandHandler<unknown, { ok: true }> = {
  id: 'messages.messages.delete_for_actor',
  async prepare(rawInput, ctx) {
    const input = deleteForActorCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireMessageById(em, input, input.messageId)
    const recipient = await em.findOne(MessageRecipient, {
      messageId: input.messageId,
      recipientUserId: input.userId,
      deletedAt: null,
    })
    return {
      before: {
        messageId: message.id,
        messageDeletedAt: toIso(message.deletedAt),
        recipientId: recipient?.id ?? null,
        recipientStatus: recipient?.status ?? null,
        recipientDeletedAt: toIso(recipient?.deletedAt),
      } satisfies MessageDeleteUndoState,
    }
  },
  async execute(rawInput, ctx) {
    const input = deleteForActorCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await requireMessageById(em, input, input.messageId)
    const recipient = await em.findOne(MessageRecipient, {
      messageId: input.messageId,
      recipientUserId: input.userId,
      deletedAt: null,
    })
    if (recipient) {
      recipient.status = 'deleted'
      recipient.deletedAt = new Date()
      await em.flush()
      await emitMessageDeletedEvent(ctx.container, {
        messageId: input.messageId,
        actorUserId: input.userId,
        target: 'recipient',
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      return { ok: true }
    }
    if (message.senderUserId === input.userId) {
      message.deletedAt = new Date()
      await em.flush()
      await emitMessageDeletedEvent(ctx.container, {
        messageId: input.messageId,
        actorUserId: input.userId,
        target: 'sender',
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      })
      return { ok: true }
    }
    throw new Error('Access denied')
  },
  async captureAfter(rawInput, _result, ctx) {
    const input = deleteForActorCommandSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: input.messageId, tenantId: input.tenantId })
    const recipient = await em.findOne(MessageRecipient, {
      messageId: input.messageId,
      recipientUserId: input.userId,
    })
    return {
      messageId: input.messageId,
      messageDeletedAt: toIso(message?.deletedAt),
      recipientId: recipient?.id ?? null,
      recipientStatus: recipient?.status ?? null,
      recipientDeletedAt: toIso(recipient?.deletedAt),
    } satisfies MessageDeleteUndoState
  },
  buildLog: async ({ input, snapshots }) => {
    const parsed = deleteForActorCommandSchema.parse(input)
    return {
      actionLabel: 'Delete message for actor',
      resourceKind: 'messages.message',
      resourceId: parsed.messageId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: (snapshots.before as MessageDeleteUndoState | undefined) ?? null,
          after: (snapshots.after as MessageDeleteUndoState | undefined) ?? null,
        } satisfies UndoPayload<MessageDeleteUndoState>,
      },
      snapshotBefore: snapshots.before ?? null,
      snapshotAfter: snapshots.after ?? null,
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<UndoPayload<MessageDeleteUndoState>>(logEntry)
    const before = undo?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const message = await em.findOne(Message, { id: before.messageId })
    if (message) {
      message.deletedAt = toDate(before.messageDeletedAt)
    }
    if (before.recipientId) {
      const recipient = await em.findOne(MessageRecipient, { id: before.recipientId })
      if (recipient) {
        recipient.status = (before.recipientStatus ?? 'unread') as MessageRecipient['status']
        recipient.deletedAt = toDate(before.recipientDeletedAt)
      }
    }
    await em.flush()
  },
}

registerCommand(composeMessageCommand)
registerCommand(updateDraftCommand)
registerCommand(replyMessageCommand)
registerCommand(forwardMessageCommand)
registerCommand(deleteForActorCommand)
