import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Message, MessageObject } from '../../../data/entities'
import { messageTokenResponseSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  const em = container.resolve('em') as EntityManager

  let commandResult: { messageId: string; recipientUserId: string }
  try {
    const executed = await commandBus.execute<unknown, { messageId: string; recipientUserId: string }>('messages.tokens.consume', {
      input: { token: params.token },
      ctx: {
        container,
        auth: null,
        organizationScope: null,
        selectedOrganizationId: null,
        organizationIds: null,
      },
    })
    commandResult = executed.result
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Invalid or expired link') {
        return Response.json({ error: 'Invalid or expired link' }, { status: 404 })
      }
      if (error.message === 'This link has expired') {
        return Response.json({ error: 'This link has expired' }, { status: 410 })
      }
      if (error.message === 'This link can no longer be used') {
        return Response.json({ error: 'This link can no longer be used' }, { status: 409 })
      }
      if (error.message === 'Message not found') {
        return Response.json({ error: 'Message not found' }, { status: 404 })
      }
    }
    throw error
  }

  const message = await em.findOne(Message, {
    id: commandResult.messageId,
    deletedAt: null,
  })
  if (!message) {
    return Response.json({ error: 'Message not found' }, { status: 404 })
  }

  const objects = await em.find(MessageObject, { messageId: message.id })

  return Response.json({
    id: message.id,
    type: message.type,
    subject: message.subject,
    body: message.body,
    bodyFormat: message.bodyFormat,
    priority: message.priority,
    senderUserId: message.senderUserId,
    sentAt: message.sentAt,
    actionData: message.actionData,
    actionTaken: message.actionTaken,
    actionTakenAt: message.actionTakenAt,
    actionTakenByUserId: message.actionTakenByUserId,
    objects: objects.map((item) => ({
      id: item.id,
      entityModule: item.entityModule,
      entityType: item.entityType,
      entityId: item.entityId,
      actionRequired: item.actionRequired,
      actionType: item.actionType,
      actionLabel: item.actionLabel,
      snapshot: item.entitySnapshot,
    })),
    requiresAuth: objects.some((item) => item.actionRequired),
    recipientUserId: commandResult.recipientUserId,
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
