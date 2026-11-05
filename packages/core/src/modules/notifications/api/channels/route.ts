import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getNotificationChannels } from '../../lib/notification-channel-registry'
import { errorResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['notifications.view'] },
}

const channelItemSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  descriptionKey: z.string().nullable(),
})

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const items = getNotificationChannels().map((channel) => ({
    id: channel.id,
    labelKey: channel.labelKey,
    descriptionKey: channel.descriptionKey ?? null,
  }))
  return NextResponse.json({ items })
}

export const openApi = {
  GET: {
    summary: 'List notification delivery channels',
    description:
      'Returns the registered delivery channel catalogue (in-app, email, push, …) so a preferences screen can render one column per channel without a hardcoded list.',
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'Notification channel catalogue',
        content: {
          'application/json': {
            schema: z.object({ items: z.array(channelItemSchema) }),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
    },
  },
}
