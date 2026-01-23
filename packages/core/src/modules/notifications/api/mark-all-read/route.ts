import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { NotificationService } from '../../lib/notificationService'
import { okResponseSchema } from '../openapi'
import { z } from 'zod'

export const metadata = {
  PUT: { requireAuth: true },
}

export async function PUT(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const notificationService = ctx.container.resolve('notificationService') as NotificationService

  const count = await notificationService.markAllAsRead({
    tenantId: ctx.auth?.tenantId ?? '',
    organizationId: ctx.selectedOrganizationId ?? null,
    userId: ctx.auth?.sub ?? null,
  })

  return Response.json({ ok: true, count })
}

export const openApi = {
  PUT: {
    summary: 'Mark all notifications as read',
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'All notifications marked as read',
        content: {
          'application/json': {
            schema: z.object({
              ok: z.boolean(),
              count: z.number(),
            }),
          },
        },
      },
    },
  },
}
