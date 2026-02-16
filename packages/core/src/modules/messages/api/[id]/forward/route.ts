import type { EntityManager } from '@mikro-orm/core'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { Message, MessageRecipient, MessageObject } from '../../../data/entities'
import { forwardMessageSchema } from '../../../data/validators'
import { getMessageTypeOrDefault } from '../../../lib/message-types-registry'
import { attachOperationMetadataHeader } from '../../../lib/operationMetadata'
import { canUseMessageEmailFeature, resolveMessageContext } from '../../../lib/routeHelpers'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { forwardResponseSchema, forwardMessageSchema as forwardSchema } from '../../openapi'
import { MessageCommandExecuteResult } from '../../../commands/shared'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
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

  const { result, logEntry } = await commandBus.execute<unknown, MessageCommandExecuteResult>('messages.messages.forward', {
    input: {
      ...input,
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
  const newMessageId = result.id
  const responseExternalEmail = result.externalEmail

  const eventBus = ctx.container.resolve('eventBus') as { emit: (event: string, payload: unknown, options?: unknown) => Promise<void> }
  await eventBus.emit(
      'messages.sent',
      {
        messageId: newMessageId,
        senderUserId: scope.userId,
        recipientUserIds: result.recipientUserIds,
        sendViaEmail: input.sendViaEmail,
        externalEmail: responseExternalEmail,
        forwardedFrom: original.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true }
  )

  const response = Response.json({ id: newMessageId }, { status: 201 })
  attachOperationMetadataHeader(response, logEntry, {
    resourceKind: 'messages.message',
    resourceId: newMessageId,
  })
  return response
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
