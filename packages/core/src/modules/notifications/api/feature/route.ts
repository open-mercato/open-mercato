import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { NotificationService } from '../../lib/notificationService'
import { createFeatureNotificationSchema } from '../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['notifications.create'] },
}

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const notificationService = ctx.container.resolve('notificationService') as NotificationService

  const body = await req.json().catch(() => ({}))
  const input = createFeatureNotificationSchema.parse(body)

  const notifications = await notificationService.createForFeature(input, {
    tenantId: ctx.auth?.tenantId ?? '',
    organizationId: ctx.selectedOrganizationId ?? null,
    userId: ctx.auth?.sub ?? null,
  })

  return Response.json({
    ok: true,
    count: notifications.length,
    ids: notifications.map((n) => n.id),
  }, { status: 201 })
}

export const openApi = {
  POST: {
    summary: 'Create notifications for all users with a specific feature/permission',
    description: 'Send the same notification to all users who have the specified feature permission (via role ACL or user ACL). Supports wildcard matching.',
    tags: ['Notifications'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: createFeatureNotificationSchema,
        },
      },
    },
    responses: {
      201: {
        description: 'Notifications created for all users with the required feature',
        content: {
          'application/json': {
            schema: z.object({
              ok: z.boolean(),
              count: z.number(),
              ids: z.array(z.string().uuid()),
            }),
          },
        },
      },
    },
  },
}
