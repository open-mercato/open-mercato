import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { notificationDeliveryConfigSchema } from '../../data/validators'
import {
  DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
  resolveNotificationDeliveryConfig,
  saveNotificationDeliveryConfig,
} from '../../lib/deliveryConfig'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['notifications.manage'] },
  POST: { requireAuth: true, requireFeatures: ['notifications.manage'] },
}

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  const container = await createRequestContainer()
  try {
    const settings = await resolveNotificationDeliveryConfig(container, {
      defaultValue: DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
    })
    return NextResponse.json({ settings })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) return await unauthorized()

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: t('api.errors.invalidPayload', 'Invalid request body') },
      { status: 400 }
    )
  }

  const parsed = notificationDeliveryConfigSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: t('notifications.delivery.settings.invalid', 'Invalid delivery settings') },
      { status: 400 }
    )
  }

  const container = await createRequestContainer()
  try {
    await saveNotificationDeliveryConfig(container, parsed.data)
    const settings = await resolveNotificationDeliveryConfig(container, {
      defaultValue: DEFAULT_NOTIFICATION_DELIVERY_CONFIG,
    })
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : t('api.errors.internal', 'Internal error') },
      { status: 500 }
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') {
      await disposable.dispose()
    }
  }
}

export const openApi = {
  GET: {
    summary: 'Get notification delivery settings',
    tags: ['Notifications'],
    responses: {
      200: { description: 'Current delivery settings' },
    },
  },
  POST: {
    summary: 'Update notification delivery settings',
    tags: ['Notifications'],
    responses: {
      200: { description: 'Delivery settings updated' },
    },
  },
}
