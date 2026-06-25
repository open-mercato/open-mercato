import { z } from 'zod'
import { restoreNotificationSchema } from '../../../data/validators'
import {
  NOTIFICATION_RESOURCE_KIND,
  resolveNotificationContext,
  runGuardedNotificationWrite,
} from '../../../lib/routeHelpers'

export const metadata = {
  PUT: { requireAuth: true },
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { service, scope, ctx } = await resolveNotificationContext(req)

  const body = await req.json().catch(() => ({}))
  const input = restoreNotificationSchema.parse(body)

  const guarded = await runGuardedNotificationWrite(
    ctx.container,
    scope,
    req,
    {
      resourceKind: NOTIFICATION_RESOURCE_KIND,
      resourceId: id,
      operation: 'update',
      payload: input as Record<string, unknown>,
    },
    () => service.restoreDismissed(id, input.status, scope),
  )
  if (!guarded.ok) return guarded.response

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
