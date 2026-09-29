import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { PushNotificationDelivery } from '../../../data/entities'

const logger = createLogger('push_notifications')
import { deliveryDetailItemSchema } from '../../../data/validators'

// Read-only detail for a single push delivery row (admin observability).
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['push_notifications.view_deliveries'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

function serializeDelivery(delivery: PushNotificationDelivery) {
  return {
    id: delivery.id,
    tenant_id: delivery.tenantId,
    organization_id: delivery.organizationId ?? null,
    notification_id: delivery.notificationId ?? null,
    notification_type_id: delivery.notificationTypeId,
    user_device_id: delivery.userDeviceId,
    user_id: delivery.userId,
    provider: delivery.provider,
    token_snapshot: delivery.tokenSnapshot,
    status: delivery.status,
    attempts: delivery.attempts,
    last_error: delivery.lastError ?? null,
    payload: delivery.payload ?? null,
    provider_response: delivery.providerResponse ?? null,
    created_at: delivery.createdAt ? delivery.createdAt.toISOString() : null,
    sent_at: delivery.sentAt ? delivery.sentAt.toISOString() : null,
    next_retry_at: delivery.nextRetryAt ? delivery.nextRetryAt.toISOString() : null,
    updated_at: delivery.updatedAt ? delivery.updatedAt.toISOString() : null,
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: translate('push_notifications.errors.unauthorized', 'Unauthorized') }, { status: 401 })
    }
    const parsedParams = paramsSchema.safeParse({ id: params.id })
    if (!parsedParams.success) {
      return NextResponse.json({ error: translate('push_notifications.errors.invalid_id', 'Invalid delivery id') }, { status: 400 })
    }
    const em = container.resolve('em') as EntityManager
    const delivery = await em.findOne(PushNotificationDelivery, { id: parsedParams.data.id, tenantId: auth.tenantId })
    if (!delivery) {
      return NextResponse.json({ error: translate('push_notifications.errors.not_found', 'Delivery not found') }, { status: 404 })
    }
    // Standard org read scoping (matches the list route + devices): an unrestricted admin reads any
    // row in the tenant, including tenant-level (NULL-org) ones; an org-restricted admin may read only
    // rows in an allowed org — a NULL-org target is denied (fail-closed).
    if (
      !isOrganizationReadAccessAllowed({
        scope: await resolveOrganizationScopeForRequest({ container, auth, request: req }),
        auth,
        organizationId: delivery.organizationId ?? null,
      })
    ) {
      return NextResponse.json({ error: translate('push_notifications.errors.forbidden', 'Access denied') }, { status: 403 })
    }
    const item = serializeDelivery(delivery)
    // Audit the read: this hand-rolled detail route bypasses makeCrudRoute (which logs list reads
    // for free), and it exposes per-user delivery detail (user/device ids, payload). Mirrors the
    // other hand-rolled core read routes (directory tenants/orgs, auth roles/users, feature_toggles).
    await logCrudAccess({
      container,
      auth,
      request: req,
      items: [item],
      idField: 'id',
      resourceKind: 'push_notifications.push_notification_delivery',
      organizationId: delivery.organizationId ?? null,
      tenantId: auth.tenantId ?? null,
      accessType: 'read:item',
    })
    return NextResponse.json({ item })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('push_notifications.deliveries.GET failed', { err })
    return NextResponse.json({ error: translate('push_notifications.errors.server_error', 'Something went wrong') }, { status: 500 })
  }
}

const errorResponseSchema = z.object({ error: z.string() })
const detailResponseSchema = z.object({ item: deliveryDetailItemSchema })

export const openApi: OpenApiRouteDoc = {
  tag: 'PushNotifications',
  summary: 'Read a single push delivery log row',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Get a push delivery',
      description: 'Admin: fetch a single push delivery row (payload + provider response; no full push token).',
      responses: [{ status: 200, description: 'Push delivery', schema: detailResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Missing push_notifications.view_deliveries', schema: errorResponseSchema },
        { status: 404, description: 'Delivery not found', schema: errorResponseSchema },
      ],
    },
  },
}
