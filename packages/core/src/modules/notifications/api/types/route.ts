import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { z } from 'zod'
import { NotificationType, NotificationTypeOverride } from '../../data/entities'
import { getNotificationType, syncNotificationTypes } from '../../lib/notification-type-registry'
import { notificationTypeItemSchema, updateNotificationTypeSchema } from '../../data/validators'
import { errorResponseSchema } from '../openapi'
import {
  NOTIFICATION_SETTINGS_RESOURCE_KIND,
  notificationCrudErrorResponse,
  runGuardedNotificationWrite,
} from '../../lib/routeHelpers'

const logger = createLogger('notifications').child({ component: 'types-api' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['notifications.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['notifications.manage'] },
}

/**
 * Catalogue item with the caller tenant's stored overrides merged in — matching
 * `resolveEligibleChannels` in the delivery gate, so preference UIs lock exactly the cells
 * delivery would reject. `channels: null` = no restriction (every registered channel).
 * `updatedAt` is the override row's version token for optimistic locking (`null` when the
 * tenant stores no override yet).
 */
const typeItem = (row: NotificationType, override?: NotificationTypeOverride | null) => ({
  id: row.id,
  labelKey: row.labelKey,
  descriptionKey: row.descriptionKey ?? null,
  category: row.category ?? null,
  silent: row.silent === true,
  nonOptOut: (override?.nonOptOut ?? row.nonOptOut) === true,
  channels: override?.channels ?? getNotificationType(row.id)?.channels ?? null,
  storedChannels: override?.channels ?? null,
  storedNonOptOut: override?.nonOptOut ?? null,
  updatedAt: override?.updatedAt ? override.updatedAt.toISOString() : null,
})

export async function GET(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const container = await createRequestContainer()
  try {
    const em = container.resolve('em') as EntityManager
    // Read-through mirror: ensure the catalogue is reflected in the DB (once per process).
    await syncNotificationTypes(em)
    const rows = await em.find(
      NotificationType,
      { $or: [{ tenantId: null }, { tenantId: auth.tenantId }] },
      { orderBy: { id: 'asc' } },
    )
    const overrides = await em.find(NotificationTypeOverride, {
      tenantId: auth.tenantId,
      notificationTypeId: { $in: rows.map((row) => row.id) },
    })
    const overrideByType = new Map(overrides.map((override) => [override.notificationTypeId, override]))
    return NextResponse.json({ items: rows.map((row) => typeItem(row, overrideByType.get(row.id))) })
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

export async function PATCH(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  const tenantId = auth.tenantId

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: t('api.errors.invalidPayload', 'Invalid request body') },
      { status: 400 },
    )
  }

  const parsed = updateNotificationTypeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: t('notifications.types.invalidChannels', 'Invalid channels payload') },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  try {
    const em = container.resolve('em') as EntityManager
    await syncNotificationTypes(em)
    const row = await em.findOne(NotificationType, {
      id: parsed.data.id,
      $or: [{ tenantId: null }, { tenantId }],
    })
    if (!row) {
      return NextResponse.json(
        { error: t('notifications.types.unknownType', 'Unknown notification type') },
        { status: 404 },
      )
    }
    const existing = await em.findOne(NotificationTypeOverride, {
      tenantId,
      notificationTypeId: row.id,
    })

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
        resourceId: row.id,
        operation: 'update',
        payload: parsed.data as unknown as Record<string, unknown>,
      },
      async () => {
        // Same 409 contract as the CRUD guard: a stale admin view (another operator saved
        // since this client loaded the catalogue) must not silently clobber the newer
        // override — the full `channels` array replaces, so a blind write loses edits.
        enforceCommandOptimisticLock({
          resourceKind: NOTIFICATION_SETTINGS_RESOURCE_KIND,
          resourceId: row.id,
          current: existing?.updatedAt ?? null,
          request: req,
        })
        const nextChannels = parsed.data.channels !== undefined ? parsed.data.channels : existing?.channels ?? null
        const nextNonOptOut = parsed.data.nonOptOut !== undefined ? parsed.data.nonOptOut : existing?.nonOptOut ?? null
        let override: NotificationTypeOverride | null = existing
        if (nextChannels === null && nextNonOptOut === null) {
          // Both overrides cleared ⇒ the code declarations apply again; drop the row
          // instead of keeping an all-null husk.
          if (existing) em.remove(existing)
          override = null
        } else if (existing) {
          existing.channels = nextChannels
          existing.nonOptOut = nextNonOptOut
        } else {
          override = em.create(NotificationTypeOverride, {
            tenantId,
            notificationTypeId: row.id,
            channels: nextChannels,
            nonOptOut: nextNonOptOut,
          })
          em.persist(override)
        }
        await em.flush()
        return typeItem(row, override)
      },
    )
    if (!guarded.ok) return guarded.response
    return NextResponse.json({ ok: true, item: guarded.result })
  } catch (error) {
    const crudResponse = notificationCrudErrorResponse(error)
    if (crudResponse) return crudResponse
    logger.error('notification type override update failed', {
      typeId: parsed.data.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: t('api.errors.internal', 'Internal error') },
      { status: 500 },
    )
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

export const openApi = {
  GET: {
    summary: 'List notification types',
    description: 'Returns the notification type catalogue (system-wide + tenant) so clients can render a preferences screen. `channels` is the effective channel eligibility for the caller\'s tenant (stored override, else the code-declared set; `null` = every channel); a channel outside it never delivers in that tenant and cannot be enabled by users. `updatedAt` is the override row\'s optimistic-lock version (`null` when the tenant stores no override).',
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'Notification type catalogue',
        content: {
          'application/json': {
            schema: z.object({ items: z.array(notificationTypeItemSchema) }),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
    },
  },
  PATCH: {
    summary: 'Override a notification type\'s channel eligibility and opt-out governance for the caller\'s tenant',
    description: 'Tenant-scoped operator overrides for a notification type (stored in `notification_type_overrides`; other tenants are unaffected). `channels` replaces the code-declared eligibility (a channel outside the effective set is completely off for the tenant: it beats user preferences and `nonOptOut`, and preference UIs lock the cell). `nonOptOut` overrides the code-declared opt-out governance (`true` forces the type on for users, `false` makes a required type user-editable). Omitted fields stay untouched; pass `null` to clear a stored override and inherit the code declaration. Sends the standard optimistic-lock header contract: pass the item\'s `updatedAt` as `x-om-ext-optimistic-lock-expected-updated-at` to detect concurrent edits (409 on mismatch).',
    tags: ['Notifications'],
    requestBody: {
      required: true,
      content: {
        'application/json': { schema: updateNotificationTypeSchema },
      },
    },
    responses: {
      200: {
        description: 'Override saved',
        content: {
          'application/json': {
            schema: z.object({
              ok: z.literal(true),
              item: notificationTypeItemSchema,
            }),
          },
        },
      },
      400: {
        description: 'Invalid request body',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      404: {
        description: 'Unknown notification type',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
      409: {
        description: 'Optimistic-lock conflict — another operator saved a newer override',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
    },
  },
}
