import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { Message, MessageAccessToken, MessageObject, MessageRecipient } from '../../../data/entities'
import { messageTokenResponseSchema } from '../../openapi'

const MAX_TOKEN_USE_COUNT = 25

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const orm = await getOrm()
  const em = orm.em.fork()

  const accessToken = await em.findOne(MessageAccessToken, { token: params.token })

  if (!accessToken) {
    return Response.json({ error: 'Invalid or expired link' }, { status: 404 })
  }

  if (accessToken.expiresAt < new Date()) {
    return Response.json({ error: 'This link has expired' }, { status: 410 })
  }

  if (accessToken.useCount >= MAX_TOKEN_USE_COUNT) {
    return Response.json({ error: 'This link can no longer be used' }, { status: 409 })
  }

  const message = await em.findOne(Message, {
    id: accessToken.messageId,
    deletedAt: null,
  })

  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  const recipient = await em.findOne(MessageRecipient, {
    messageId: accessToken.messageId,
    recipientUserId: accessToken.recipientUserId,
    deletedAt: null,
  })

  if (!recipient) {
    return Response.json({ error: 'Invalid or expired link' }, { status: 404 })
  }

  accessToken.usedAt = new Date()
  accessToken.useCount++

  if (recipient.status === 'unread') {
    recipient.status = 'read'
    recipient.readAt = new Date()
  }

  await em.flush()

  const objects = await em.find(MessageObject, { messageId: message.id })

  return Response.json({
    id: message.id,
    subject: message.subject,
    body: message.body,
    bodyFormat: message.bodyFormat,
    senderUserId: message.senderUserId,
    sentAt: message.sentAt,
    objects: objects.map((item) => ({
      id: item.id,
      entityModule: item.entityModule,
      entityType: item.entityType,
      entityId: item.entityId,
      actionRequired: item.actionRequired,
      actionType: item.actionType,
      actionLabel: item.actionLabel,
    })),
    requiresAuth: objects.some((item) => item.actionRequired),
    recipientUserId: accessToken.recipientUserId,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'Access message via token',
      responses: [
        {
          status: 200,
          description: 'Message detail via token',
          schema: messageTokenResponseSchema,
        },
        { status: 404, description: 'Invalid or expired link' },
        { status: 409, description: 'Token usage exceeded' },
        { status: 410, description: 'Token expired' },
      ],
    },
  },
}
