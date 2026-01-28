import { z } from 'zod'
import { restoreNotificationSchema } from '../../../data/validators'
import { resolveNotificationContext } from '../../../lib/routeHelpers'

export const metadata = {
  PUT: { requireAuth: true },
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { service, scope } = await resolveNotificationContext(req)

  const body = await req.json().catch(() => ({}))
  const input = restoreNotificationSchema.parse(body)

  await service.restoreDismissed(id, input.status, scope)

  return Response.json({ ok: true })
}

export const openApi = {
  PUT: {
    summary: 'Restore dismissed notification',
    description: 'Undo a dismissal and restore a notification to read or unread.',
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
      required: false,
      content: {
        'application/json': {
          schema: restoreNotificationSchema,
        },
      },
    },
    responses: {
      200: {
        description: 'Notification restored',
        content: {
          'application/json': {
            schema: z.object({ ok: z.boolean() }),
          },
        },
      },
    },
  },
}
