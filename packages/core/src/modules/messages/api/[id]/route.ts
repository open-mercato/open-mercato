import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
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
import { attachOperationMetadataHeader } from '../../lib/operationMetadata'
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
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('messages.recipients.mark_read', {
      input: {
        messageId: params.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
      ctx: {
        container: ctx.container,
        auth: ctx.auth ?? null,
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: scope.organizationId ? [scope.organizationId] : null,
        request: req,
      },
    })
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
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
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

  try {
    const { logEntry } = await commandBus.execute('messages.messages.update_draft', {
      input: {
        ...input,
        messageId: message.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
      ctx: {
        container: ctx.container,
        auth: ctx.auth ?? null,
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: scope.organizationId ? [scope.organizationId] : null,
        request: req,
      },
    })

    const response = Response.json({ ok: true, id: message.id })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'messages.message',
      resourceId: message.id,
    })
    return response
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Message type cannot be created by users') {
        return Response.json({ error: error.message }, { status: 400 })
      }
      if (error.message === 'Only draft messages can be edited') {
        return Response.json({ error: error.message }, { status: 409 })
      }
      if (error.message.includes('must') || error.message.includes('required')) {
        return Response.json({ error: error.message }, { status: 400 })
      }
      if (error.message === 'Access denied') {
        return Response.json({ error: error.message }, { status: 403 })
      }
    }
    throw error
  }

}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const commandBus = ctx.container.resolve('commandBus') as CommandBus

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

  try {
    const { logEntry } = await commandBus.execute('messages.messages.delete_for_actor', {
      input: {
        messageId: params.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
      ctx: {
        container: ctx.container,
        auth: ctx.auth ?? null,
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: scope.organizationId ? [scope.organizationId] : null,
        request: req,
      },
    })

    const response = Response.json({ ok: true })
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'messages.message',
      resourceId: params.id,
    })
    return response
  } catch (error) {
    if (error instanceof Error && error.message === 'Access denied') {
      return Response.json({ error: 'Access denied' }, { status: 403 })
    }
    throw error
  }

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
