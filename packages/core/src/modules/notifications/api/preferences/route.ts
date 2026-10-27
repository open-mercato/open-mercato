import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveNotificationPreferenceService, type NotificationPreferenceScope } from '../../lib/notificationPreferenceService'
import {
  runGuardedNotificationWrite,
  notificationValidationErrorResponse,
  NOTIFICATION_PREFERENCE_RESOURCE_KIND,
} from '../../lib/routeHelpers'
import { PREFERENCE_UPDATED_EVENT, emitNotificationEvent } from '../../events'
import { updatePreferencesSchema, notificationPreferenceItemSchema } from '../../data/validators'
import { errorResponseSchema } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['notifications.manage_preferences'] },
  PUT: { requireAuth: true, requireFeatures: ['notifications.manage_preferences'] },
}

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return await unauthorized()

  const container = await createRequestContainer()
  try {
    const service = resolveNotificationPreferenceService(container)
    const scope: NotificationPreferenceScope = { tenantId: auth.tenantId, userId: auth.sub }
    const rows = await service.listForUser(scope)
    const items = rows.map((row) => ({
      notificationTypeId: row.notificationTypeId,
      channel: row.channel,
      enabled: row.enabled,
    }))
    return NextResponse.json({ items })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return await unauthorized()

  const parsed = updatePreferencesSchema.safeParse(await readJsonSafe(req, {}))
  if (!parsed.success) return notificationValidationErrorResponse(parsed.error)

  const container = await createRequestContainer()
  try {
    const service = resolveNotificationPreferenceService(container)
    const scope: NotificationPreferenceScope = { tenantId: auth.tenantId, userId: auth.sub }
    const guarded = await runGuardedNotificationWrite(
      container,
      { tenantId: auth.tenantId, organizationId: auth.orgId ?? null, userId: auth.sub },
      req,
      {
        resourceKind: NOTIFICATION_PREFERENCE_RESOURCE_KIND,
        resourceId: auth.sub,
        operation: 'update',
        payload: parsed.data as Record<string, unknown>,
      },
      () =>
        service.setPreferences(
          scope,
          parsed.data.preferences.map((p) => ({
            typeId: p.notificationTypeId,
            channel: p.channel,
            enabled: p.enabled,
          })),
        ),
    )
    if (!guarded.ok) return guarded.response

    // Skip the event on no-op writes (nothing actually changed).
    if (guarded.result > 0) {
      await emitNotificationEvent(PREFERENCE_UPDATED_EVENT, {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
      })
    }

    return NextResponse.json({ ok: true })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

export const openApi = {
  GET: {
    summary: 'Get notification preferences',
    description: "Returns the current user's stored channel preferences (absent rows default to enabled).",
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'Stored preferences',
        content: {
          'application/json': {
            schema: z.object({ items: z.array(notificationPreferenceItemSchema) }),
          },
        },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    },
  },
  PUT: {
    summary: 'Update notification preferences',
    description: "Bulk-updates the current user's channel preferences.",
    tags: ['Notifications'],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: updatePreferencesSchema } },
    },
    responses: {
      200: {
        description: 'Preferences updated',
        content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
      },
      400: { description: 'Invalid request body', content: { 'application/json': { schema: errorResponseSchema } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
    },
  },
}
