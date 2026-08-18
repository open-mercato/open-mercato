import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { NotificationType } from '../../../../../data/entities'
import { syncNotificationTypes } from '../../../../../lib/notification-type-registry'
import { computeChannelsPatch } from '../../../../../lib/typeChannelSettings'
import {
  applyTypeOverride,
  loadTypeOverrideForUpdate,
  resolveCatalogueTranslate,
  resolveEffectiveChannels,
  resolveRegisteredChannelIds,
  typeItem,
} from '../../../../../lib/typeCatalogue'
import { notificationTypeItemSchema } from '../../../../../data/validators'
import { errorResponseSchema } from '../../../../openapi'
import {
  NOTIFICATION_SETTINGS_RESOURCE_KIND,
  notificationCrudErrorResponse,
  runGuardedNotificationWrite,
} from '../../../../../lib/routeHelpers'

const logger = createLogger('notifications').child({ component: 'type-channels-api' })

const paramsSchema = z.object({
  id: z.string().min(1),
  channel: z.string().min(1),
})

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['notifications.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['notifications.manage'] },
}

type RouteContext = { params?: { id?: string; channel?: string } | Promise<{ id?: string; channel?: string }> }

async function readParams(ctx: RouteContext) {
  const raw = await ctx.params
  return paramsSchema.parse({ id: raw?.id, channel: raw?.channel })
}

/**
 * Enable (`PUT`) or disable (`DELETE`) ONE channel for a notification type in the caller's tenant.
 *
 * Why a per-channel sub-resource rather than PATCHing the whole `channels` array: the array form
 * makes the client read-modify-write the full set, so two operators editing the same type from
 * stale views silently clobber each other — and while no override row exists yet there is no
 * `updated_at` to version-lock against, so the optimistic-lock guard cannot even detect it. Here
 * the server derives the next set from the CURRENT stored state under a row lock, so a concurrent
 * toggle of a different channel survives. Same shape as the other member-collection endpoints in
 * the repo (`customers/people/{id}/companies/{companyId}`, `catalog` media attach/detach).
 *
 * The full-array `PATCH /api/notifications/types` stays supported and unchanged for callers that
 * genuinely want to set the whole set at once.
 */
async function toggleChannel(req: Request, ctx: RouteContext, enabled: boolean): Promise<Response> {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) {
    return NextResponse.json({ error: t('api.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  const tenantId = auth.tenantId

  let params: z.infer<typeof paramsSchema>
  try {
    params = await readParams(ctx)
  } catch {
    return NextResponse.json(
      { error: t('api.errors.invalidPayload', 'Invalid request body') },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  try {
    const em = container.resolve('em') as EntityManager
    await syncNotificationTypes(em)
    const row = await em.findOne(NotificationType, {
      id: params.id,
      $or: [{ tenantId: null }, { tenantId }],
    })
    if (!row) {
      return NextResponse.json(
        { error: t('notifications.types.unknownType', 'Unknown notification type') },
        { status: 404 },
      )
    }

    // Reject unregistered channels up front: silently storing one would put a dead entry in the
    // eligibility set that no delivery strategy can ever satisfy.
    const registeredChannelIds = resolveRegisteredChannelIds()
    if (!registeredChannelIds.includes(params.channel)) {
      return NextResponse.json(
        { error: t('notifications.types.unknownChannel', 'Unknown notification channel') },
        { status: 404 },
      )
    }

    const translate = await resolveCatalogueTranslate(req)

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
        payload: { id: row.id, channel: params.channel, enabled },
      },
      async () => {
        // optimistic-lock-exempt: notification type channel add/remove. The next set is derived
        // server-side from the current stored state inside a transaction that holds a row lock on
        // the override, so a concurrent toggle cannot be lost — there is no shared aggregate for a
        // version check to protect. Mirrors the add/remove endpoints in customers/catalog/staff.
        const applyOnce = async () => {
          return em.transactional(async (tem) => {
            const existing = await loadTypeOverrideForUpdate(tem, tenantId, row.id)
            const base = resolveEffectiveChannels(row.id, existing?.channels, registeredChannelIds)
            // Unchecking the last channel maps to `null` (clear the override → the code-declared
            // default reapplies) rather than an empty set, which would black-hole the type.
            const nextChannels = computeChannelsPatch(base, params.channel, enabled)
            const override = applyTypeOverride(tem, {
              tenantId,
              notificationTypeId: row.id,
              existing,
              nextChannels,
              nextNonOptOut: existing?.nonOptOut ?? null,
            })
            await tem.flush()
            return typeItem(row, override, translate)
          })
        }

        try {
          return await applyOnce()
        } catch (err) {
          // First-write race: no row existed to lock, so a concurrent INSERT for this
          // (tenant, type) won and the partial unique index rejected ours. A single-channel
          // toggle is idempotent, so re-apply it on top of the winner instead of surfacing a
          // conflict the operator would only have to resolve by clicking again.
          if (!isUniqueViolation(err)) throw err
          em.clear()
          return applyOnce()
        }
      },
    )
    if (!guarded.ok) return guarded.response
    return NextResponse.json({ ok: true, item: guarded.result })
  } catch (error) {
    const crudResponse = notificationCrudErrorResponse(error)
    if (crudResponse) return crudResponse
    logger.error('notification type channel toggle failed', {
      typeId: params.id,
      channel: params.channel,
      enabled,
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

export async function PUT(req: Request, ctx: RouteContext): Promise<Response> {
  return toggleChannel(req, ctx, true)
}

export async function DELETE(req: Request, ctx: RouteContext): Promise<Response> {
  return toggleChannel(req, ctx, false)
}

const toggleResponseSchema = z.object({
  ok: z.literal(true),
  item: notificationTypeItemSchema,
})

export const openApi = {
  PUT: {
    summary: 'Enable one delivery channel for a notification type',
    description:
      'Adds a single channel to the tenant\'s eligibility set for this notification type. The next set is derived server-side from the currently stored state under a row lock, so concurrent toggles of different channels do not overwrite each other — prefer this over `PATCH /api/notifications/types` with a full `channels` array whenever a UI toggles one cell at a time. Idempotent: enabling an already-enabled channel is a no-op. Returns the refreshed catalogue item.',
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'Updated notification type',
        content: { 'application/json': { schema: toggleResponseSchema } },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
      404: {
        description: 'Unknown notification type or unregistered channel',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
    },
  },
  DELETE: {
    summary: 'Disable one delivery channel for a notification type',
    description:
      'Removes a single channel from the tenant\'s eligibility set for this notification type, with the same concurrency-safe server-side derivation as `PUT`. Removing the last remaining channel clears the override entirely so the code-declared default reapplies (an empty set is never stored — it would leave the type undeliverable). Idempotent: disabling an already-disabled channel is a no-op.',
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'Updated notification type',
        content: { 'application/json': { schema: toggleResponseSchema } },
      },
      401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
      404: {
        description: 'Unknown notification type or unregistered channel',
        content: { 'application/json': { schema: errorResponseSchema } },
      },
    },
  },
}
