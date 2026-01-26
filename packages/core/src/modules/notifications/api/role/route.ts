import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { NotificationService } from '../../lib/notificationService'
import { createRoleNotificationSchema } from '../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['notifications.create'] },
}

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const notificationService = ctx.container.resolve('notificationService') as NotificationService

  const body = await req.json().catch(() => ({}))
  const input = createRoleNotificationSchema.parse(body)

  const notifications = await notificationService.createForRole(input, {
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
    summary: 'Create notifications for all users in a role',
    description: 'Send the same notification to all users who have the specified role within the organization',
    tags: ['Notifications'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: createRoleNotificationSchema,
        },
      },
    },
    responses: {
      201: {
        description: 'Notifications created for all users in the role',
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
