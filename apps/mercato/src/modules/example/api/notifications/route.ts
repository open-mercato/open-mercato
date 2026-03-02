import { z } from 'zod'
import { resolveNotificationContext } from '@open-mercato/core/modules/notifications/lib/routeHelpers'

const emitNotificationSchema = z.object({
  linkHref: z.string().optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
}

export async function POST(request: Request) {
  const { service, scope } = await resolveNotificationContext(request)
  if (!scope.userId || !scope.tenantId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const input = emitNotificationSchema.parse(body)
  const targetHref =
    typeof input.linkHref === 'string' && input.linkHref.startsWith('/backend/')
      ? input.linkHref
      : '/backend/umes-next-phases?allowed=1'

  const notification = await service.create(
    {
      recipientUserId: scope.userId,
      type: 'example.umes.actionable',
      titleKey: 'example.notifications.umesActionable.title',
      bodyKey: 'example.notifications.umesActionable.body',
      severity: 'info',
      actions: [
        {
          id: 'open',
          label: 'Open',
          labelKey: 'common.open',
          variant: 'outline',
          href: targetHref,
        },
        {
          id: 'dismiss',
          label: 'Dismiss',
          labelKey: 'notifications.actions.dismiss',
          variant: 'ghost',
        },
      ],
      primaryActionId: 'open',
      linkHref: targetHref,
      sourceModule: 'example',
      sourceEntityType: 'example.todo',
      bodyVariables: {
        href: targetHref,
      },
    },
    scope,
  )

  return Response.json({ id: notification.id }, { status: 201 })
}

export const openApi = {
  POST: {
    summary: 'Emit example actionable notification',
    tags: ['Example'],
    requestBody: {
      required: false,
      content: {
        'application/json': {
          schema: emitNotificationSchema,
        },
      },
    },
    responses: {
      201: {
        description: 'Notification emitted',
        content: {
          'application/json': {
            schema: z.object({ id: z.string().uuid() }),
          },
        },
      },
    },
  },
}
