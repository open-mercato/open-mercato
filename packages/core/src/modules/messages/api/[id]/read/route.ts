import type { EntityManager } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { Message, MessageRecipient } from '../../../data/entities'
import { resolveMessageContext } from '../../../lib/routeHelpers'
import { errorResponseSchema, okResponseSchema } from '../../openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['messages.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['messages.view'] },
}

function hasOrganizationAccess(scopeOrganizationId: string | null, messageOrganizationId: string | null | undefined): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

async function resolveRecipientContext(
  req: Request,
  id: string
): Promise<
  | { em: EntityManager; recipient: MessageRecipient }
  | { response: Response }
> {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()

  const message = await em.findOne(Message, {
    id,
    tenantId: scope.tenantId,
    deletedAt: null,
  })

  if (!message) {
    return { response: Response.json({ error: 'Message not found' }, { status: 404 }) }
  }

  if (!hasOrganizationAccess(scope.organizationId, message.organizationId)) {
    return { response: Response.json({ error: 'Access denied' }, { status: 403 }) }
  }

  const recipient = await em.findOne(MessageRecipient, {
    messageId: id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })

  if (!recipient) {
    return { response: Response.json({ error: 'Access denied' }, { status: 403 }) }
  }

  return { em, recipient }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const context = await resolveRecipientContext(req, params.id)
  if ('response' in context) return context.response

  if (context.recipient.status !== 'read') {
    context.recipient.status = 'read'
    context.recipient.readAt = new Date()
    await context.em.flush()
  }

  return Response.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const context = await resolveRecipientContext(req, params.id)
  if ('response' in context) return context.response

  context.recipient.status = 'unread'
  context.recipient.readAt = null
  await context.em.flush()

  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    PUT: {
      summary: 'Mark message as read',
      responses: [
        { status: 200, description: 'Message marked read', schema: okResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Mark message as unread',
      responses: [
        { status: 200, description: 'Message marked unread', schema: okResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
  },
}
