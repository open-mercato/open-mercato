import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { attachOperationMetadataHeader, type OperationLogEntryLike } from '../../../../lib/operationMetadata'
import { resolveMessageContext } from '../../../../lib/routeHelpers'
import { resolveUserFeatures, runMessageMutationGuardAfterSuccess, runMessageMutationGuards } from '../../../guards'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { actionResultResponseSchema } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['messages.actions'] },
}

export async function POST(
  req: Request,
  { params }: { params: { id: string; actionId: string } }
) {
  const { ctx, scope } = await resolveMessageContext(req)
  const commandBus = ctx.container.resolve('commandBus') as CommandBus

  const rawBody = await req.json().catch(() => ({}))
  const body = (typeof rawBody === 'object' && rawBody && !Array.isArray(rawBody)
    ? rawBody
    : {}) as Record<string, unknown>

  const guardResult = await runMessageMutationGuards(
    ctx.container,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: 'messages.message',
      resourceId: params.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: body,
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
    const commandResult = await commandBus.execute('messages.actions.execute', {
      input: {
        messageId: params.id,
        actionId: params.actionId,
        payload: body,
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

    const result = commandResult.result as {
      ok: boolean
      actionId: string
      result: Record<string, unknown>
      operationLogEntry?: OperationLogEntryLike | null
    }
    const response = Response.json({
      ok: result.ok,
      actionId: result.actionId,
      result: result.result,
    })
    attachOperationMetadataHeader(response, result.operationLogEntry ?? null, {
      resourceKind: 'messages.message',
      resourceId: params.id,
    })
    await runMessageMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: 'messages.message',
      resourceId: params.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
    return response
  } catch (error) {
    if (isCrudHttpError(error)) {
      return Response.json(error.body, { status: error.status })
    }
    if (error instanceof Error) {
      if (error.message === 'Message not found') {
        return Response.json({ error: 'Message not found' }, { status: 404 })
      }
      if (error.message === 'Access denied') {
        return Response.json({ error: 'Access denied' }, { status: 403 })
      }
      if (error.message === 'Action not found') {
        return Response.json({ error: 'Action not found' }, { status: 404 })
      }
      if (error.message === 'Action command is not allowed') {
        return Response.json({ error: 'Action command is not allowed' }, { status: 403 })
      }
      if (error.message === 'Action already taken') {
        const actionTaken = (error as Error & { actionTaken?: string }).actionTaken ?? null
        return Response.json({ error: 'Action already taken', actionTaken }, { status: 409 })
      }
      if (error.message === 'Actions have expired') {
        return Response.json({ error: 'Actions have expired' }, { status: 410 })
      }
      if (error.message === 'Action has no executable target') {
        return Response.json({ error: 'Action has no executable target' }, { status: 409 })
      }
      if (error.message === 'Action failed') {
        return Response.json({ error: 'Action failed' }, { status: 500 })
      }
    }
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    POST: {
      summary: 'Execute message action',
      requestBody: { schema: z.record(z.string(), z.unknown()).optional() },
      responses: [
        { status: 200, description: 'Action executed', schema: actionResultResponseSchema },
        { status: 403, description: 'Access denied' },
        { status: 404, description: 'Action not found' },
        { status: 409, description: 'Action already taken, or the message was modified concurrently (optimistic lock conflict)' },
        { status: 410, description: 'Action expired' },
      ],
    },
  },
}
