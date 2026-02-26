import type { EntityManager } from '@mikro-orm/core'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { Message, MessageRecipient } from '../../../data/entities'
import { attachOperationMetadataHeader } from '../../../lib/operationMetadata'
import { hasOrganizationAccess, resolveMessageContext } from '../../../lib/routeHelpers'
import type { MessageScope } from '../../../lib/routeHelpers'
import { errorResponseSchema, okResponseSchema } from '../../openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['messages.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['messages.view'] },
}

type ResolvedCtx = Awaited<ReturnType<typeof resolveMessageContext>>['ctx']

async function resolveRecipientContext(
  req: Request,
  id: string,
): Promise<
  | { ctx: ResolvedCtx; scope: MessageScope; em: EntityManager; recipient: MessageRecipient }
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

  return { ctx, scope, em, recipient }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const context = await resolveRecipientContext(req, params.id)
  if ('response' in context) return context.response
  const { ctx, scope } = context
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const { logEntry } = await commandBus.execute('messages.recipients.archive', {
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
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const context = await resolveRecipientContext(req, params.id)
  if ('response' in context) return context.response
  const { ctx, scope } = context
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const { logEntry } = await commandBus.execute('messages.recipients.unarchive', {
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
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    PUT: {
      summary: 'Archive message',
      responses: [
        { status: 200, description: 'Message archived', schema: okResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Unarchive message',
      responses: [
        { status: 200, description: 'Message unarchived', schema: okResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
  },
}
