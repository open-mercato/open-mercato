import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { EntityManager } from '@mikro-orm/core'
import { Notification } from '../../data/entities'
import { unreadCountResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const em = ctx.container.resolve('em') as EntityManager

  const count = await em.count(Notification, {
    recipientUserId: ctx.auth?.sub,
    tenantId: ctx.auth?.tenantId,
    status: 'unread',
  })

  return Response.json({ unreadCount: count })
}

export const openApi = {
  GET: {
    summary: 'Get unread notification count',
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'Unread count',
        content: {
          'application/json': {
            schema: unreadCountResponseSchema,
          },
        },
      },
    },
  },
}
