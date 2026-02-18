import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { replyMessageSchema } from '../../../data/validators'
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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const body = await req.json().catch(() => ({}))
  const input = replyMessageSchema.parse(body)
  if (input.sendViaEmail && !(await canUseMessageEmailFeature(ctx, scope))) {
    return Response.json({ error: 'Missing feature: messages.email' }, { status: 403 })
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
    if (error instanceof Error) {
      if (error.message === 'Message not found') {
        return Response.json({ error: 'Message not found' }, { status: 404 })
      }
      if (error.message === 'Access denied') {
        return Response.json({ error: 'Access denied' }, { status: 403 })
      }
      if (error.message === 'Reply is not allowed for this message type') {
        return Response.json({ error: 'Reply is not allowed for this message type' }, { status: 409 })
      }
      if (error.message === 'No recipients available for reply') {
        return Response.json({ error: 'No recipients available for reply' }, { status: 409 })
      }
    }
    throw error
  }
  const messageId = commandResult.result.id

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
