import { z } from 'zod'
import { resolveNotificationContext } from '../../lib/routeHelpers'

export const metadata = {
  PUT: { requireAuth: true },
}

export async function PUT(req: Request) {
  const { service, scope } = await resolveNotificationContext(req)

  const count = await service.markAllAsRead(scope)

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
