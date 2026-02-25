import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { Message, MessageRecipient } from '../../../data/entities'
import { buildForwardPreview } from '../../../lib/forwarding'
import { hasOrganizationAccess, resolveMessageContext } from '../../../lib/routeHelpers'
import {
  errorResponseSchema,
  forwardPreviewResponseSchema,
} from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['messages.compose'] },
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
    messageId: params.id,
    recipientUserId: scope.userId,
    deletedAt: null,
  })

  const isSender = message.senderUserId === scope.userId
  const isRecipient = Boolean(recipient)
  if (!isSender && !isRecipient) {
    return Response.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    const preview = await buildForwardPreview(em, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
    }, message)
    return Response.json(preview)
  } catch (error) {
    if (error instanceof Error && error.message === 'Forward body exceeds maximum length') {
      return Response.json({ error: error.message }, { status: 413 })
    }
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    GET: {
      summary: 'Get forward preview for a message',
      responses: [
        { status: 200, description: 'Forward preview generated', schema: forwardPreviewResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
        { status: 413, description: 'Forward body exceeds maximum length', schema: errorResponseSchema },
      ],
    },
  },
}
