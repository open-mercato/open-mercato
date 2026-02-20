import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { forwardMessageSchema } from '../../../data/validators'
import { attachOperationMetadataHeader, OperationLogEntryLike } from '../../../lib/operationMetadata'
import { canUseMessageEmailFeature, resolveMessageContext } from '../../../lib/routeHelpers'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { forwardResponseSchema, forwardMessageSchema as forwardSchema } from '../../openapi'
import { MessageCommandExecuteResult } from '../../../commands/shared'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const body = await req.json().catch(() => ({}))
  const input = forwardMessageSchema.parse(body)
  if (input.sendViaEmail && !(await canUseMessageEmailFeature(ctx, scope))) {
    return Response.json({ error: 'Missing feature: messages.email' }, { status: 403 })
  }

  let commandResult: { result: MessageCommandExecuteResult; logEntry: unknown }
  try {
    commandResult = await commandBus.execute<unknown, MessageCommandExecuteResult>('messages.messages.forward', {
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
      if (error.message === 'Forward is not allowed for this message type') {
        return Response.json({ error: 'Forward is not allowed for this message type' }, { status: 409 })
      }
    }
    throw error
  }
  const newMessageId = commandResult.result.id

  const response = Response.json({ id: newMessageId }, { status: 201 })
  attachOperationMetadataHeader(response, commandResult.logEntry as OperationLogEntryLike, {
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
