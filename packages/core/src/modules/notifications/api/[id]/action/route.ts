import { executeActionSchema } from '../../../data/validators'
import { actionResultResponseSchema, errorResponseSchema } from '../../openapi'
import { resolveNotificationContext } from '../../../lib/routeHelpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  POST: { requireAuth: true },
}

function appendQueryParam(href: string, key: string, value: string): string {
  const [pathWithQuery, hashFragment] = href.split('#', 2)
  const [pathname, queryString] = pathWithQuery.split('?', 2)
  const params = new URLSearchParams(queryString ?? '')
  params.set(key, value)
  const nextQuery = params.toString()
  const nextPath = nextQuery ? `${pathname}?${nextQuery}` : pathname
  return hashFragment ? `${nextPath}#${hashFragment}` : nextPath
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { service, scope } = await resolveNotificationContext(req)

  const body = await req.json().catch(() => ({}))
  const input = executeActionSchema.parse(body)

  try {
    const { notification, result } = await service.executeAction(id, input, scope)

    const action = notification.actionData?.actions?.find((a) => a.id === input.actionId)
    const hrefFromAction = action?.href?.replace('{sourceEntityId}', notification.sourceEntityId ?? '')
    let href = hrefFromAction || notification.linkHref || undefined
    if (
      href
      && notification.type === 'record_locks.incoming_changes.available'
      && input.actionId === 'see_incoming_changes'
    ) {
      href = appendQueryParam(href, 'showIncomingChanges', '1')
    }
    if (
      href
      && notification.type === 'record_locks.lock.contended'
      && input.actionId === 'see_lock_contention'
    ) {
      href = appendQueryParam(href, 'showLockContention', '1')
    }

    return Response.json({
      ok: true,
      result,
      href,
    })
  } catch (error) {
    const { t } = await resolveTranslations()
    const fallback = t('notifications.error.action', 'Failed to execute action')
    const message = error instanceof Error && error.message ? error.message : fallback
    return Response.json({ error: message }, { status: 400 })
  }
}

export const openApi = {
  POST: {
    summary: 'Execute notification action',
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
      required: true,
      content: {
        'application/json': {
          schema: executeActionSchema,
        },
      },
    },
    responses: {
      200: {
        description: 'Action executed successfully',
        content: {
          'application/json': {
            schema: actionResultResponseSchema,
          },
        },
      },
      400: {
        description: 'Action not found or failed',
        content: {
          'application/json': {
            schema: errorResponseSchema,
          },
        },
      },
    },
  },
}
