import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '../../../../auth/data/entities'
import { assertActorCanAccessUserTarget } from '../../../../auth/lib/grantChecks'
import type { RbacService } from '../../../../auth/services/rbacService'
import { resolveNotificationPreferenceService, type NotificationPreferenceScope } from '../../../lib/notificationPreferenceService'
import {
  runGuardedNotificationWrite,
  notificationValidationErrorResponse,
  NOTIFICATION_PREFERENCE_RESOURCE_KIND,
} from '../../../lib/routeHelpers'
import { PREFERENCE_UPDATED_EVENT, emitNotificationEvent } from '../../../events'
import {
  adminPreferencesQuerySchema,
  adminUpdatePreferencesSchema,
  notificationPreferenceItemSchema,
} from '../../../data/validators'
import { errorResponseSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['notifications.manage_user_preferences'] },
  PUT: { requireAuth: true, requireFeatures: ['notifications.manage_user_preferences'] },
}

const unauthorized = async () => {
  const { t } = await resolveTranslations()
  return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
}

/**
 * Authorize the acting admin to manage a target user's preferences. Returns an error response to
 * send, or null when access is granted. Two gates, mirroring the platform's user-management scoping:
 *   - 404 when the user does not exist in the acting tenant (existence/tenant check — the shared
 *     `assertActorCanAccessUserTarget` delegates silently on a fully-missing target).
 *   - standard org scoping via `assertActorCanAccessUserTarget` (403 out-of-org / 404 cross-tenant,
 *     super-admin and `__all__` bypass) — the same guard `auth` user CRUD uses, instead of a
 *     hand-rolled tenant-only check.
 */
async function authorizeTargetUser(
  container: AwilixContainer,
  em: EntityManager,
  auth: { sub: string; tenantId: string },
  targetUserId: string,
): Promise<NextResponse | null> {
  const { t } = await resolveTranslations()
  const user = await findOneWithDecryption(
    em,
    User,
    { id: targetUserId, tenantId: auth.tenantId, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId, organizationId: null },
  )
  if (!user) {
    return NextResponse.json({ error: t('notifications.preferences.userNotFound', 'User not found') }, { status: 404 })
  }
  try {
    const rbacService = container.resolve('rbacService') as RbacService
    await assertActorCanAccessUserTarget({
      em,
      rbacService,
      actorUserId: auth.sub,
      tenantId: auth.tenantId,
      targetUserId,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }
  return null
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return await unauthorized()

  const url = new URL(req.url)
  const parsed = adminPreferencesQuerySchema.safeParse({ userId: url.searchParams.get('userId') ?? undefined })
  if (!parsed.success) return notificationValidationErrorResponse(parsed.error)

  const container = await createRequestContainer()
  try {
    const em = container.resolve('em') as EntityManager
    const denied = await authorizeTargetUser(container, em, { sub: auth.sub, tenantId: auth.tenantId }, parsed.data.userId)
    if (denied) return denied
    const service = resolveNotificationPreferenceService(container)
    const scope: NotificationPreferenceScope = { tenantId: auth.tenantId, userId: parsed.data.userId }
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

  const parsed = adminUpdatePreferencesSchema.safeParse(await readJsonSafe(req, {}))
  if (!parsed.success) return notificationValidationErrorResponse(parsed.error)

  const container = await createRequestContainer()
  try {
    const em = container.resolve('em') as EntityManager
    const denied = await authorizeTargetUser(container, em, { sub: auth.sub, tenantId: auth.tenantId }, parsed.data.userId)
    if (denied) return denied
    const service = resolveNotificationPreferenceService(container)
    const scope: NotificationPreferenceScope = { tenantId: auth.tenantId, userId: parsed.data.userId }
    const guarded = await runGuardedNotificationWrite(
      container,
      { tenantId: auth.tenantId, organizationId: auth.orgId ?? null, userId: auth.sub },
      req,
      {
        resourceKind: NOTIFICATION_PREFERENCE_RESOURCE_KIND,
        resourceId: parsed.data.userId,
        operation: 'update',
        payload: parsed.data as Record<string, unknown>,
      },
      () =>
        service.setPreferences(
          scope,
          parsed.data.preferences.map((p) => ({ typeId: p.notificationTypeId, channel: p.channel, enabled: p.enabled })),
        ),
    )
    if (!guarded.ok) return guarded.response

    // Skip the event on no-op writes (nothing actually changed).
    if (guarded.result > 0) {
      await emitNotificationEvent(PREFERENCE_UPDATED_EVENT, {
        tenantId: auth.tenantId,
        organizationId: auth.orgId ?? null,
        userId: parsed.data.userId,
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
    summary: "Get a user's notification preferences (admin)",
    description: "Returns a target user's stored channel preferences. Requires notifications.manage_user_preferences.",
    tags: ['Notifications'],
    parameters: [{ name: 'userId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      200: {
        description: 'Stored preferences',
        content: { 'application/json': { schema: z.object({ items: z.array(notificationPreferenceItemSchema) }) } },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
      404: { description: 'User not found', content: { 'application/json': { schema: errorResponseSchema } } },
    },
  },
  PUT: {
    summary: "Update a user's notification preferences (admin)",
    description: "Bulk-updates a target user's channel preferences. Requires notifications.manage_user_preferences.",
    tags: ['Notifications'],
    requestBody: { required: true, content: { 'application/json': { schema: adminUpdatePreferencesSchema } } },
    responses: {
      200: { description: 'Preferences updated', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: 'Invalid request body', content: { 'application/json': { schema: errorResponseSchema } } },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
      404: { description: 'User not found', content: { 'application/json': { schema: errorResponseSchema } } },
    },
  },
}
