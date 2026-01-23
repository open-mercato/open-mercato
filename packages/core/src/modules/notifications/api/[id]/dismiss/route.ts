import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { NotificationService } from '../../../lib/notificationService'
import { okResponseSchema } from '../../openapi'

export const metadata = {
  PUT: { requireAuth: true },
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { ctx } = await resolveRequestContext(req)
  const notificationService = ctx.container.resolve('notificationService') as NotificationService

  await notificationService.dismiss(id, {
    tenantId: ctx.auth?.tenantId ?? '',
    organizationId: ctx.selectedOrganizationId ?? null,
    userId: ctx.auth?.sub ?? null,
  })

  return Response.json({ ok: true })
}

export const openApi = {
  PUT: {
    summary: 'Dismiss notification',
    tags: ['Notifications'],
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      },
    ],
    responses: {
      200: {
        description: 'Notification dismissed',
        content: {
          'application/json': {
            schema: okResponseSchema,
          },
        },
      },
    },
  },
}
