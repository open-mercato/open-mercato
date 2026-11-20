import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { resendFailedSchema } from '../../../data/validators'
import { attachOperationMetadataHeader } from '../../../lib/operationMetadata'
import { canUseMessageEmailFeature, resolveMessageContext } from '../../../lib/routeHelpers'
import { resolveUserFeatures, runMessageMutationGuardAfterSuccess, runMessageMutationGuards } from '../../guards'
import { composeResponseSchema, errorResponseSchema } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['messages.compose'] },
}

type ResendFailedResult = { id: string; threadId: string | null; sourceMessageId: string }

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, scope } = await resolveMessageContext(req)
  const body = await req.json().catch(() => ({}))
  const parsed = resendFailedSchema.safeParse(body ?? {})
  if (!parsed.success) {
    const { translate } = await resolveTranslations()
    return Response.json(
      { error: translate('messages.errors.invalidResendPayload', 'Invalid resend request'), details: parsed.error.issues },
      { status: 400 },
    )
  }
  if (!(await canUseMessageEmailFeature(ctx, scope))) {
    return Response.json({ error: 'Missing feature: messages.email' }, { status: 403 })
  }

  const guardResult = await runMessageMutationGuards(
    ctx.container,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: 'messages.message',
      resourceId: null,
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: { ...parsed.data, sourceMessageId: params.id },
    },
    resolveUserFeatures(ctx.auth),
  )
  if (!guardResult.ok) {
    return Response.json(
      guardResult.errorBody ?? { error: 'Operation blocked by guard' },
      { status: guardResult.errorStatus ?? 422 },
    )
  }

  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  try {
    const { result, logEntry } = await commandBus.execute<unknown, ResendFailedResult>('messages.messages.resend_failed', {
      input: {
        ...parsed.data,
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
    const response = Response.json({ id: result.id, threadId: result.threadId }, { status: 201 })
    attachOperationMetadataHeader(response, logEntry, { resourceKind: 'messages.message', resourceId: result.id })
    await runMessageMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: 'messages.message',
      resourceId: result.id,
      operation: 'create',
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
    return response
  } catch (error) {
    if (isCrudHttpError(error)) return Response.json(error.body, { status: error.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(error)
    if (interceptorRejection) return Response.json(interceptorRejection.body, { status: interceptorRejection.status })
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Messages',
  methods: {
    POST: {
      summary: 'Resend a message to its failed external recipients',
      description:
        'Creates a new message in the same thread with the same subject, body, sender mailbox and "send separately" setting, addressed to the failed recipients (all of them, or the given participant ids). Only the original sender may resend.',
      requestBody: { schema: resendFailedSchema },
      responses: [
        { status: 201, description: 'Resend message created', schema: composeResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorResponseSchema },
        { status: 403, description: 'Not the sender, or missing messages.email', schema: errorResponseSchema },
        { status: 404, description: 'Message not found', schema: errorResponseSchema },
        { status: 409, description: 'No failed recipients, or a given participant is not failed', schema: errorResponseSchema },
      ],
    },
  },
}
