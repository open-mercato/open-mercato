import type { EntityManager } from '@mikro-orm/core'
import { Message, MessageRecipient, MessageObject } from '../../../data/entities'
import { forwardMessageSchema } from '../../../data/validators'
import { copyAttachmentsForForward } from '../../../lib/attachments'
import { getMessageTypeOrDefault } from '../../../lib/message-types-registry'
import { canUseMessageEmailFeature, resolveMessageContext } from '../../../lib/routeHelpers'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { forwardResponseSchema, forwardMessageSchema as forwardSchema } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const body = await req.json().catch(() => ({}))
  const input = forwardMessageSchema.parse(body)
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

  if (scope.organizationId) {
    if (original.organizationId !== scope.organizationId) {
      return Response.json({ error: 'Access denied' }, { status: 403 })
    }
  } else if (original.organizationId) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const isRecipient = await em.findOne(MessageRecipient, {
    messageId: params.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })

  if (original.senderUserId !== scope.userId && !isRecipient) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const messageType = getMessageTypeOrDefault(original.type)
  if (messageType.allowForward === false) {
    return Response.json({ error: 'Forward is not allowed for this message type' }, { status: 409 })
  }

  const originalObjects = await em.find(MessageObject, { messageId: params.id })

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
      senderUserId: scope.userId,
      subject: `Fwd: ${original.subject}`,
      body: forwardedBody,
      bodyFormat: original.bodyFormat,
      priority: original.priority,
      status: 'sent',
      isDraft: false,
      sentAt: new Date(),
      sendViaEmail: input.sendViaEmail,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
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
        params.id,
        newMessage.id,
        scope.organizationId,
        scope.tenantId,
      )
    }

    newMessageId = newMessage.id
    responseExternalEmail = newMessage.externalEmail ?? null
  })

  const eventBus = ctx.container.resolve('eventBus') as { emit: (event: string, payload: unknown, options?: unknown) => Promise<void> }
  await eventBus.emit(
      'messages.sent',
      {
        messageId: newMessageId,
        senderUserId: scope.userId,
        recipientUserIds: input.recipients.map((r) => r.userId),
        sendViaEmail: input.sendViaEmail,
        externalEmail: responseExternalEmail,
        forwardedFrom: original.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true }
  )

  return Response.json({ id: newMessageId }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    POST: {
      summary: 'Forward a message',
      requestBody: { schema: forwardSchema },
      responses: [
        {
          status: 201,
          description: 'Message forwarded',
          schema: forwardResponseSchema,
        },
        { status: 403, description: 'Access denied' },
        { status: 404, description: 'Message not found' },
        { status: 409, description: 'Forward not allowed for message type' },
      ],
    },
  },
}
