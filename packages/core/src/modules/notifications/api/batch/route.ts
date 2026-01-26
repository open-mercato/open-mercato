import { z } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { resolveNotificationService } from '../../lib/notificationService'
import { createBatchNotificationSchema } from '../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['notifications.create'] },
}

export async function POST(req: Request) {
  const { ctx } = await resolveRequestContext(req)
  const notificationService = resolveNotificationService(ctx.container)

  const body = await req.json().catch(() => ({}))
  const input = createBatchNotificationSchema.parse(body)

  const notifications = await notificationService.createBatch(input, {
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
    summary: 'Create batch notifications',
    tags: ['Notifications'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: createBatchNotificationSchema,
        },
      },
    },
    responses: {
      201: {
        description: 'Notifications created',
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
