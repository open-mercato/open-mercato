import type { EntityManager } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { Message, MessageRecipient } from '../../../data/entities'
import { replyMessageSchema } from '../../../data/validators'
import { linkAttachmentsToMessage, linkLibraryAttachmentsToMessage } from '../../../lib/attachments'
import { getMessageTypeOrDefault } from '../../../lib/message-types-registry'
import { canUseMessageEmailFeature, resolveMessageContext } from '../../../lib/routeHelpers'
import {
  errorResponseSchema,
  forwardResponseSchema,
  replyMessageSchema as replyOpenApiSchema,
} from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

function hasOrganizationAccess(scopeOrganizationId: string | null, messageOrganizationId: string | null | undefined): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

function buildReplySubject(subject: string): string {
  if (/^re:\s*/i.test(subject)) {
    return subject
  }
  return `Re: ${subject}`
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const body = await req.json().catch(() => ({}))
  const input = replyMessageSchema.parse(body)
  if (input.sendViaEmail && !(await canUseMessageEmailFeature(ctx, scope))) {
    return Response.json({ error: 'Missing feature: messages.email' }, { status: 403 })
  }

  const original = await em.findOne(Message, {
    id: params.id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!original) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  if (!hasOrganizationAccess(scope.organizationId, original.organizationId)) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const ownRecipient = await em.findOne(MessageRecipient, {
    messageId: original.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })

  if (original.senderUserId !== scope.userId && !ownRecipient) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const messageType = getMessageTypeOrDefault(original.type)
  if (messageType.allowReply === false) {
    return Response.json({ error: 'Reply is not allowed for this message type' }, { status: 409 })
  }

  const originalRecipients = await em.find(MessageRecipient, {
    messageId: original.id,
    deletedAt: null,
  })

  const recipientIds = new Set<string>()

  if (input.replyAll) {
    if (original.senderUserId !== scope.userId) {
      recipientIds.add(original.senderUserId)
    }

    for (const recipient of originalRecipients) {
      if (recipient.recipientUserId !== scope.userId) {
        recipientIds.add(recipient.recipientUserId)
      }
    }
  } else {
    if (original.senderUserId !== scope.userId) {
      recipientIds.add(original.senderUserId)
    } else {
      for (const recipient of originalRecipients) {
        if (recipient.recipientUserId !== scope.userId) {
          recipientIds.add(recipient.recipientUserId)
          break
        }
      }
    }
  }

  if (recipientIds.size === 0) {
    return Response.json({ error: 'No recipients available for reply' }, { status: 409 })
  }

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
      senderUserId: scope.userId,
      subject: buildReplySubject(original.subject),
      body: input.body,
      bodyFormat: input.bodyFormat,
      priority: original.priority,
      status: 'sent',
      isDraft: false,
      sentAt: new Date(),
      sendViaEmail: input.sendViaEmail,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
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
        scope.organizationId,
        scope.tenantId
      )
    }

    if (input.attachmentRecordId) {
      await linkLibraryAttachmentsToMessage(
        trx,
        message.id,
        input.attachmentRecordId,
        scope.organizationId,
        scope.tenantId,
      )
    }

    messageId = message.id
    responseExternalEmail = message.externalEmail ?? null
  })

  const eventBus = ctx.container.resolve('eventBus') as {
    emit: (event: string, payload: unknown, options?: unknown) => Promise<void>
  }

  await eventBus.emit(
      'messages.sent',
      {
        messageId,
        senderUserId: scope.userId,
        recipientUserIds: Array.from(recipientIds),
        sendViaEmail: input.sendViaEmail,
        externalEmail: responseExternalEmail,
        replyTo: original.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true }
    )

  return Response.json({ id: messageId }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    POST: {
      summary: 'Reply to message',
      requestBody: { schema: replyOpenApiSchema },
      responses: [
        { status: 201, description: 'Reply created', schema: forwardResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
        { status: 409, description: 'Reply not allowed for message type', schema: errorResponseSchema },
        { status: 409, description: 'No recipients available for reply', schema: errorResponseSchema },
      ],
    },
  },
}
