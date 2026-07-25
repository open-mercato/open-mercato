import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { attachOperationMetadataHeader } from '../../../../lib/operationMetadata'
import { resolveMessageContext } from '../../../../lib/routeHelpers'
import { resolveUserFeatures, runMessageMutationGuardAfterSuccess, runMessageMutationGuards } from '../../../guards'
import {
  conversationMutationResponseSchema,
  errorResponseSchema,
} from '../../../openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['messages.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['messages.view'] },
}

async function runConversationReadMutation(
  req: Request,
  id: string,
  commandId: 'messages.conversation.mark_read_for_actor' | 'messages.conversation.mark_unread_for_actor',
) {
  const { ctx, scope } = await resolveMessageContext(req)
  const commandBus = ctx.container.resolve('commandBus') as CommandBus

  const guardResult = await runMessageMutationGuards(
    ctx.container,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: 'messages.conversation',
      resourceId: id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: null,
    },
    resolveUserFeatures(ctx.auth),
  )
  if (!guardResult.ok) {
    return Response.json(
      guardResult.errorBody ?? { error: 'Operation blocked by guard' },
      { status: guardResult.errorStatus ?? 422 },
    )
  }

  try {
    const { result, logEntry } = await commandBus.execute(commandId, {
      input: {
        anchorMessageId: id,
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

    const response = Response.json(result)
    attachOperationMetadataHeader(response, logEntry, {
      resourceKind: 'messages.conversation',
      resourceId: id,
    })
    await runMessageMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: 'messages.conversation',
      resourceId: id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
    return response
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Message not found') {
        return Response.json({ error: error.message }, { status: 404 })
      }
      if (error.message === 'Access denied') {
        return Response.json({ error: error.message }, { status: 403 })
      }
    }
    throw error
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return runConversationReadMutation(req, params.id, 'messages.conversation.mark_read_for_actor')
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  return runConversationReadMutation(req, params.id, 'messages.conversation.mark_unread_for_actor')
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    PUT: {
      summary: 'Mark entire conversation as read for current actor',
      responses: [
        { status: 200, description: 'Conversation marked read', schema: conversationMutationResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
    DELETE: {
      summary: 'Mark entire conversation as unread for current actor',
      responses: [
        { status: 200, description: 'Conversation marked unread', schema: conversationMutationResponseSchema },
      ],
      errors: [
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
      ],
    },
  },
}
