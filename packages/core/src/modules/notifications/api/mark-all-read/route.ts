import { z } from 'zod'
import {
  NOTIFICATION_RESOURCE_KIND,
  resolveNotificationContext,
  runGuardedNotificationWrite,
} from '../../lib/routeHelpers'

export const metadata = {
  PUT: { requireAuth: true },
}

export async function PUT(req: Request) {
  const { service, scope, ctx } = await resolveNotificationContext(req)

  const guarded = await runGuardedNotificationWrite(
    ctx.container,
    scope,
    req,
    {
      resourceKind: NOTIFICATION_RESOURCE_KIND,
      operation: 'update',
    },
    () => service.markAllAsRead(scope),
  )
  if (!guarded.ok) return guarded.response

  return Response.json({ ok: true, count: guarded.result })
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
