import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { notificationDeliveryConfigSchema } from '../../data/validators'
import {
  errorResponseSchema,
  notificationSettingsResponseSchema,
  notificationSettingsUpdateResponseSchema,
} from '../openapi'
import {
  resolveNotificationDeliveryConfig,
  isAllowedNotificationAppUrl,
} from '../../lib/deliveryConfig'
import {
  notificationCrudErrorResponse,
  NOTIFICATION_SETTINGS_RESOURCE_KIND,
  runGuardedNotificationWrite,
  requireResolvedNotificationTenantScope,
} from '../../lib/routeHelpers'

import { readNotificationDeliverySettings, saveVersionedNotificationDeliverySettings } from '../../lib/deliverySettings'

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

  const tenantId = auth.tenantId ?? (typeof auth.actorTenantId === 'string' ? auth.actorTenantId : '')
  const scopeError = await requireResolvedNotificationTenantScope({ tenantId })
  if (scopeError) return scopeError

  const container = await createRequestContainer()
  try {
    return NextResponse.json(await readNotificationDeliverySettings(container, tenantId))
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

  const tenantId = auth.tenantId ?? (typeof auth.actorTenantId === 'string' ? auth.actorTenantId : '')
  const scopeError = await requireResolvedNotificationTenantScope({ tenantId })
  if (scopeError) return scopeError

  const container = await createRequestContainer()
  try {
    const instanceConfig = await resolveNotificationDeliveryConfig(container)
    if (!isAllowedNotificationAppUrl(parsed.data.appUrl, instanceConfig)) {
      return NextResponse.json(
        { error: t('notifications.delivery.settings.invalid', 'Invalid delivery settings') },
        { status: 400 },
      )
    }
    const guarded = await runGuardedNotificationWrite(
      container,
      {
        tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub ?? null,
      },
      req,
      {
        resourceKind: NOTIFICATION_SETTINGS_RESOURCE_KIND,
        operation: 'update',
        payload: parsed.data as Record<string, unknown>,
      },
      () => saveVersionedNotificationDeliverySettings(container, tenantId, parsed.data, req),
    )
    if (!guarded.ok) return guarded.response
    return NextResponse.json({ ok: true, ...guarded.result })
  } catch (error) {
    const conflict = notificationCrudErrorResponse(error)
    if (conflict) return conflict
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
      200: {
        description: 'Current delivery settings',
        content: {
          'application/json': {
            schema: notificationSettingsResponseSchema,
          },
        },
      },
      403: {
        description: 'Tenant scope required',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: errorResponseSchema,
          },
        },
      },
    },
  },
  POST: {
    summary: 'Update notification delivery settings',
    tags: ['Notifications'],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: notificationDeliveryConfigSchema,
        },
      },
    },
    responses: {
      200: {
        description: 'Delivery settings updated',
        content: {
          'application/json': {
            schema: notificationSettingsUpdateResponseSchema,
          },
        },
      },
      400: {
        description: 'Invalid request body',
        content: {
          'application/json': {
            schema: errorResponseSchema,
          },
        },
      },
      403: {
        description: 'Tenant scope required',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: errorResponseSchema,
          },
        },
      },
      409: {
        description: 'Settings changed since they were loaded',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      500: {
        description: 'Internal error',
        content: {
          'application/json': {
            schema: errorResponseSchema,
          },
        },
      },
    },
  },
}
