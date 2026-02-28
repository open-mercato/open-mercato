import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { Message, MessageConfirmation, MessageRecipient } from '../../../data/entities'
import { resolveMessageContext } from '../../../lib/routeHelpers'
import {
  errorResponseSchema,
  messageConfirmationResponseSchema,
} from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.view'] },
}

function hasOrganizationAccess(scopeOrganizationId: string | null, messageOrganizationId: string | null | undefined): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
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
    messageId: message.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })
  const isSender = message.senderUserId === scope.userId
  if (!isSender && !recipient) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  const confirmation = await em.findOne(MessageConfirmation, { messageId: message.id })

  return Response.json({
    messageId: message.id,
    confirmed: confirmation?.confirmed ?? false,
    confirmedAt: confirmation?.confirmedAt ? confirmation.confirmedAt.toISOString() : null,
    confirmedByUserId: confirmation?.confirmedByUserId ?? null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'Read message confirmation status',
      responses: [
        { status: 200, description: 'Confirmation status', schema: messageConfirmationResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
  },
}
