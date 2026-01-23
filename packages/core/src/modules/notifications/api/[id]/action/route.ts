import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { NotificationService } from '../../../lib/notificationService'
import { executeActionSchema } from '../../../data/validators'
import { actionResultResponseSchema } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx } = await resolveRequestContext(req)
  const notificationService = ctx.container.resolve('notificationService') as NotificationService

  const body = await req.json().catch(() => ({}))
  const input = executeActionSchema.parse(body)

  try {
    const { notification, result } = await notificationService.executeAction(id, input, {
      tenantId: ctx.auth?.tenantId ?? '',
      organizationId: ctx.selectedOrganizationId ?? null,
      userId: ctx.auth?.sub ?? null,
    })

    const action = notification.actionData?.actions?.find((a) => a.id === input.actionId)
    const href = action?.href?.replace('{sourceEntityId}', notification.sourceEntityId ?? '')

    return Response.json({
      ok: true,
      result,
      href,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed'
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
      },
    },
  },
}
