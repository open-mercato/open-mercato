import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../../auth/data/entities'
import { Message, MessageObject, MessageRecipient } from '../../data/entities'
import { updateDraftSchema } from '../../data/validators'
import { buildResolvedMessageActions } from '../../lib/actions'
import { linkAttachmentsToMessage } from '../../lib/attachments'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from '../../lib/constants'
import { getMessageObjectType } from '../../lib/message-objects-registry'
import { getMessageTypeOrDefault, isMessageTypeCreateableByUser } from '../../lib/message-types-registry'
import { validateMessageObjectsForType } from '../../lib/object-validation'
import { resolveMessageContext } from '../../lib/routeHelpers'
import {
  errorResponseSchema,
  messageDetailResponseSchema,
  okResponseSchema,
  updateDraftSchema as updateDraftOpenApiSchema,
} from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['messages.compose'] },
  DELETE: { requireAuth: true, requireFeatures: ['messages.view'] },
}

function hasOrganizationAccess(scopeOrganizationId: string | null, messageOrganizationId: string | null | undefined): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

type MessageObjectPreviewPayload = {
  title: string
  subtitle?: string
  status?: string
  statusColor?: string
  metadata?: Record<string, string>
} | null

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const message = await em.findOne(Message, {
    id: params.id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  if (!hasOrganizationAccess(scope.organizationId, message.organizationId)) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const recipient = await em.findOne(MessageRecipient, {
    messageId: params.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })

  const isSender = message.senderUserId === scope.userId
  const isRecipient = Boolean(recipient)

  if (!isSender && !isRecipient) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  if (recipient && recipient.status === 'unread') {
    recipient.status = 'read'
    recipient.readAt = new Date()
    await em.flush()
  }

  const objects = await em.find(MessageObject, { messageId: params.id })
  const objectPreviews = await Promise.all(
    objects.map(async (item): Promise<MessageObjectPreviewPayload> => {
      const objectType = getMessageObjectType(item.entityModule, item.entityType)
      if (!objectType?.loadPreview) return null
      try {
        return await objectType.loadPreview(item.entityId, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      } catch (error) {
        console.error(
          `[messages] Failed to load preview for ${item.entityModule}:${item.entityType}:${item.entityId}`,
          error,
        )
        return null
      }
    }),
  )
  const allRecipients = await em.find(MessageRecipient, { messageId: params.id, deletedAt: null })

  const threadMessages = await em.find(
    Message,
    {
      threadId: message.threadId ?? message.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      isDraft: false,
    },
    { orderBy: { sentAt: 'ASC' } }
  )

  const threadSenderIds = threadMessages
    .map((threadMessage) => threadMessage.senderUserId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  const threadSenders = threadSenderIds.length > 0
    ? await findWithDecryption(
        em,
        User,
        { id: { $in: Array.from(new Set(threadSenderIds)) } },
        undefined,
        { tenantId: scope.tenantId, organizationId: scope.organizationId }
      )
    : []

  const threadSenderMap = new Map(threadSenders.map((user) => [user.id, user]))

  const senderUser = await findOneWithDecryption(
    em,
    User,
    { id: message.senderUserId },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId }
  )

  const senderName = typeof senderUser?.name === 'string' && senderUser.name.trim().length
    ? senderUser.name.trim()
    : null
  const senderEmail = senderUser?.email ?? null

  const messageType = getMessageTypeOrDefault(message.type)
  const resolvedActionData = buildResolvedMessageActions(message, objects)

  return Response.json({
    id: message.id,
    type: message.type,
    visibility: message.visibility,
    sourceEntityType: message.sourceEntityType,
    sourceEntityId: message.sourceEntityId,
    externalEmail: message.externalEmail,
    externalName: message.externalName,
    typeDefinition: {
      labelKey: messageType.labelKey,
      icon: messageType.icon,
      color: messageType.color,
      allowReply: messageType.allowReply ?? true,
      allowForward: messageType.allowForward ?? true,
      ui: {
        listItemComponent: messageType.ui?.listItemComponent ?? null,
        contentComponent: messageType.ui?.contentComponent ?? null,
        actionsComponent: messageType.ui?.actionsComponent ?? null,
      },
    },
    threadId: message.threadId,
    parentMessageId: message.parentMessageId,
    senderUserId: message.senderUserId,
    senderName,
    senderEmail,
    subject: message.subject,
    body: message.body,
    bodyFormat: message.bodyFormat,
    priority: message.priority,
    sentAt: message.sentAt,
    actionData: resolvedActionData,
    actionTaken: message.actionTaken,
    actionTakenAt: message.actionTakenAt,
    actionTakenByUserId: message.actionTakenByUserId,
    recipients: allRecipients.map((item) => ({
      userId: item.recipientUserId,
      type: item.recipientType,
      status: item.status,
      readAt: item.readAt,
    })),
    objects: objects.map((item, index) => ({
      id: item.id,
      entityModule: item.entityModule,
      entityType: item.entityType,
      entityId: item.entityId,
      actionRequired: item.actionRequired,
      actionType: item.actionType,
      actionLabel: item.actionLabel,
      snapshot: item.entitySnapshot,
      preview: objectPreviews[index] ?? null,
    })),
    thread: threadMessages.map((threadMessage) => {
      const sender = threadSenderMap.get(threadMessage.senderUserId)
      const threadSenderName = typeof sender?.name === 'string' && sender.name.trim().length
        ? sender.name.trim()
        : null

      return {
        id: threadMessage.id,
        senderUserId: threadMessage.senderUserId,
        senderName: threadSenderName,
        senderEmail: sender?.email ?? null,
        body: threadMessage.body,
        sentAt: threadMessage.sentAt,
      }
    }),
    isRead: recipient ? recipient.status !== 'unread' : true,
  })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const body = await req.json().catch(() => ({}))
  const input = updateDraftSchema.parse(body)

  const message = await em.findOne(Message, {
    id: params.id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  if (!hasOrganizationAccess(scope.organizationId, message.organizationId)) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  if (message.senderUserId !== scope.userId) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!message.isDraft) {
    return Response.json({ error: 'Only draft messages can be edited' }, { status: 409 })
  }

  const nextMessageType = input.type ?? message.type
  if (input.type !== undefined && !isMessageTypeCreateableByUser(input.type)) {
    return Response.json({ error: 'Message type cannot be created by users' }, { status: 400 })
  }
  if (input.objects) {
    const objectValidationError = validateMessageObjectsForType(nextMessageType, input.objects)
    if (objectValidationError) {
      return Response.json({ error: objectValidationError }, { status: 400 })
    }
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
      if (objectValidationError) {
        return Response.json({ error: objectValidationError }, { status: 409 })
      }
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
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
    } else {
      await em.nativeDelete(Attachment, {
        entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
        recordId: message.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        id: { $nin: input.attachmentIds },
      })
    }

    try {
      await linkAttachmentsToMessage(
        em,
        message.id,
        input.attachmentIds,
        scope.organizationId,
        scope.tenantId
      )
    } catch (error) {
      console.error('[messages:attachments] link failed via draft update', {
        messageId: message.id,
        attachmentIds: input.attachmentIds,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        error,
      })
      throw error
    }
  }

  await em.flush()

  return Response.json({ ok: true, id: message.id })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()

  const message = await em.findOne(Message, {
    id: params.id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  if (!hasOrganizationAccess(scope.organizationId, message.organizationId)) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const recipient = await em.findOne(MessageRecipient, {
    messageId: params.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })

  if (recipient) {
    recipient.status = 'deleted'
    recipient.deletedAt = new Date()
    await em.flush()
    return Response.json({ ok: true })
  }

  if (message.senderUserId === scope.userId) {
    message.deletedAt = new Date()
    await em.flush()
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Access denied' }, { status: 403 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'Get message detail',
      responses: [
        { status: 200, description: 'Message detail', schema: messageDetailResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
    PATCH: {
      summary: 'Update draft message',
      requestBody: { schema: updateDraftOpenApiSchema },
      responses: [
        { status: 200, description: 'Draft updated', schema: okResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
        { status: 409, description: 'Only drafts can be edited', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Delete message for current sender/recipient context',
      responses: [
        { status: 200, description: 'Message deleted', schema: okResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
  },
}
