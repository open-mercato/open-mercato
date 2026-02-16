import type { EntityManager } from '@mikro-orm/core'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { Message, MessageRecipient } from '../../../data/entities'
import { replyMessageSchema } from '../../../data/validators'
import { getMessageTypeOrDefault } from '../../../lib/message-types-registry'
import { attachOperationMetadataHeader } from '../../../lib/operationMetadata'
import { canUseMessageEmailFeature, resolveMessageContext } from '../../../lib/routeHelpers'
import {
  errorResponseSchema,
  forwardResponseSchema,
  replyMessageSchema as replyOpenApiSchema,
} from '../../openapi'
import { MessageCommandExecuteResult } from '../../../commands/shared'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}


function hasOrganizationAccess(scopeOrganizationId: string | null, messageOrganizationId: string | null | undefined): boolean {
  if (scopeOrganizationId) {
    return messageOrganizationId === scopeOrganizationId
  }
  return messageOrganizationId == null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
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

  let commandResult
  try {
    commandResult = await commandBus.execute<unknown, MessageCommandExecuteResult>('messages.messages.reply', {
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
  } catch (error) {
    if (error instanceof Error && error.message === 'No recipients available for reply') {
      return Response.json({ error: 'No recipients available for reply' }, { status: 409 })
    }
    throw error
  }
  const messageId = commandResult.result.id
  const responseExternalEmail = commandResult.result.externalEmail
  const recipientIds = commandResult.result.recipientUserIds

  const eventBus = ctx.container.resolve('eventBus') as {
    emit: (event: string, payload: unknown, options?: unknown) => Promise<void>
  }

  await eventBus.emit(
      'messages.sent',
      {
        messageId,
        senderUserId: scope.userId,
        recipientUserIds: recipientIds,
        sendViaEmail: input.sendViaEmail,
        externalEmail: responseExternalEmail,
        replyTo: original.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true }
    )

  const response = Response.json({ id: messageId }, { status: 201 })
  attachOperationMetadataHeader(response, commandResult.logEntry, {
    resourceKind: 'messages.message',
    resourceId: messageId,
  })
  return response
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
