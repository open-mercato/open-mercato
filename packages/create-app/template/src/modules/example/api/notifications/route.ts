import { z } from 'zod'
import { resolveNotificationContext } from '@open-mercato/core/modules/notifications/lib/routeHelpers'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

const emitNotificationSchema = z.object({
  linkHref: z.string().optional(),
  outcome: z.enum(['success', 'failure']).default('success'),
  dedupeKey: z.string().trim().min(1).max(120).optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
}

export async function POST(request: Request) {
  const { service, scope } = await resolveNotificationContext(request)
  const { t } = await resolveTranslations()
  if (!scope.userId || !scope.tenantId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await readJsonSafe<unknown>(request, {})
  const input = emitNotificationSchema.parse(body)
  const targetHref =
    typeof input.linkHref === 'string' && input.linkHref.startsWith('/backend/')
      ? input.linkHref
      : '/backend/umes-next-phases?allowed=1'
  const groupKey = `example.umes.actionable:${input.outcome}:${input.dedupeKey ?? targetHref}`

  const notification = await service.create(
    {
      recipientUserId: scope.userId,
      type: 'example.umes.actionable',
      titleKey: 'example.notifications.umesActionable.title',
      bodyKey: 'example.notifications.umesActionable.body',
      title: t('example.notifications.umesActionable.title', 'Action required in UMES next phases'),
      body: t(
        'example.notifications.umesActionable.body',
        'Open the UMES next phases page to verify reactive notification handlers.',
      ),
      severity: input.outcome === 'success' ? 'success' : 'error',
      actions: [
        {
          id: 'open',
          label: t('common.open', 'Open'),
          labelKey: 'common.open',
          variant: 'outline',
          href: targetHref,
        },
        {
          id: 'dismiss',
          label: t('notifications.actions.dismiss', 'Dismiss'),
          labelKey: 'notifications.actions.dismiss',
          variant: 'ghost',
        },
      ],
      primaryActionId: 'open',
      linkHref: targetHref,
      sourceModule: 'example',
      sourceEntityType: 'example.todo',
      groupKey,
      bodyVariables: {
        href: targetHref,
        outcome: input.outcome,
      },
    },
    scope,
  )

  return Response.json({ id: notification.id }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Example',
  methods: {
    POST: {
      summary: 'Emit example actionable notification',
      tags: ['Example'],
      requestBody: {
        contentType: 'application/json',
        schema: emitNotificationSchema.optional(),
      },
      responses: [
        {
          status: 201,
          description: 'Notification emitted',
          schema: z.object({ id: z.string().uuid() }),
        },
      ],
    },
  },
}
