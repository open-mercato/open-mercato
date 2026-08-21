import { executeActionSchema } from '../../../data/validators'
import { actionResultResponseSchema, errorResponseSchema } from '../../openapi'
import {
  NOTIFICATION_RESOURCE_KIND,
  notificationCrudErrorResponse,
  notificationValidationErrorResponse,
  resolveNotificationContext,
  runGuardedNotificationWrite,
} from '../../../lib/routeHelpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { service, scope, ctx } = await resolveNotificationContext(req)

  const body = await req.json().catch(() => ({}))
  const parsed = executeActionSchema.safeParse(body)
  if (!parsed.success) {
    return notificationValidationErrorResponse(parsed.error)
  }
  const input = parsed.data

  try {
    const guarded = await runGuardedNotificationWrite(
      ctx.container,
      scope,
      req,
      {
        resourceKind: NOTIFICATION_RESOURCE_KIND,
        resourceId: id,
        operation: 'custom',
        payload: input as Record<string, unknown>,
      },
      () => service.executeAction(id, input, scope),
    )
    if (!guarded.ok) return guarded.response
    const { notification, result } = guarded.result

    const action = notification.actionData?.actions?.find((a) => a.id === input.actionId)
    const href = action?.href?.replace('{sourceEntityId}', notification.sourceEntityId ?? '')

    return Response.json({
      ok: true,
      result,
      href,
    })
  } catch (error) {
    const errorResponse = notificationCrudErrorResponse(error)
    if (errorResponse) return errorResponse

    const { t } = await resolveTranslations()
    const fallback = t('notifications.error.action', 'Failed to execute action')
    const message = error instanceof Error && error.message ? error.message : fallback
    return Response.json({ error: message }, { status: 400 })
  }
}

export const openApi = {
  POST: {
    summary: 'Execute notification action',
    tags: ['Notifications'],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: executeActionSchema,
        },
      },
    },
    responses: {
      200: {
        description: 'Action executed successfully',
        content: {
          'application/json': {
            schema: actionResultResponseSchema,
          },
        },
      },
      400: {
        description: 'Action not found or failed',
        content: {
          'application/json': {
            schema: errorResponseSchema,
          },
        },
      },
    },
  },
}
