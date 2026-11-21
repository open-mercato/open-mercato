import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { ShippingCarrierService } from '../../lib/shipping-service'
import { isShipmentIdempotencyConflictError } from '../../lib/shipment-idempotency'
import { shippingCarrierUpstreamErrorResponse } from '../../lib/upstream-error-response'
import { carrierShipmentListQuerySchema, carrierShipmentListSchema, createShipmentSchema } from '../../data/validators'
import { CarrierShipment } from '../../data/entities'
import { shippingCarriersTag } from '../openapi'

function resolveGuardUserId(auth: {
  sub?: string | null
  userId?: string | null
  keyId?: string | null
}): string {
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

export const metadata = {
  path: '/shipping-carriers/shipments',
  GET: { requireAuth: true },
  POST: { requireAuth: true, requireFeatures: ['shipping_carriers.manage'] },
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: translate('shipping_carriers.history.unauthorized') }, { status: 401 })
  }
  const container = await createRequestContainer()
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const rbac = container.resolve('rbacService') as RbacService
  const canRead = await rbac.userHasAllFeatures(auth.sub, ['shipping_carriers.view'], scope)
    || await rbac.userHasAllFeatures(auth.sub, ['shipping_carriers.manage'], scope)
  if (!canRead) return NextResponse.json({ error: translate('shipping_carriers.history.forbidden') }, { status: 403 })

  const parsed = carrierShipmentListQuerySchema.safeParse(buildQueryParams(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: translate('shipping_carriers.history.invalidQuery'), details: parsed.error.flatten() }, { status: 400 })
  }
  const { orderId, page, pageSize } = parsed.data
  const em = container.resolve('em') as EntityManager
  const filter = { ...scope, orderId, deletedAt: null }
  const total = await em.count(CarrierShipment, filter)
  const records = await findWithDecryption(em, CarrierShipment, filter, {
    fields: ['id', 'orderId', 'providerKey', 'carrierShipmentId', 'trackingNumber', 'unifiedStatus', 'createdAt', 'updatedAt'],
    orderBy: { createdAt: 'DESC', id: 'DESC' },
    limit: pageSize,
    offset: (page - 1) * pageSize,
  }, scope)
  const items = records.map((record) => ({
    id: record.id,
    orderId: record.orderId,
    providerKey: record.providerKey,
    carrierShipmentId: record.carrierShipmentId,
    trackingNumber: record.trackingNumber,
    status: record.unifiedStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }))
  return NextResponse.json({ items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const payload = await readJsonSafe<unknown>(req)
  const parsed = createShipmentSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }
  const container = await createRequestContainer()
  const guardUserId = resolveGuardUserId(auth)
  const guardResult = await validateCrudMutationGuard(container, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: guardUserId,
    resourceKind: 'shipping_carriers.shipment',
    resourceId: parsed.data.orderId,
    operation: 'create',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data as Record<string, unknown>,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const service = container.resolve('shippingCarrierService') as ShippingCarrierService
  try {
    const shipment = await service.createShipment({
      ...parsed.data,
      organizationId: auth.orgId as string,
      tenantId: auth.tenantId,
    })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
        userId: guardUserId,
        resourceKind: 'shipping_carriers.shipment',
        resourceId: parsed.data.orderId,
        operation: 'create',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({
      shipmentId: shipment.id,
      carrierShipmentId: shipment.carrierShipmentId,
      trackingNumber: shipment.trackingNumber,
      status: shipment.unifiedStatus,
      labelUrl: shipment.labelUrl,
    }, { status: 201 })
  } catch (error: unknown) {
    if (isShipmentIdempotencyConflictError(error)) {
      return NextResponse.json(
        { error: 'Shipment idempotency conflict', code: 'idempotency_conflict' },
        { status: 409 },
      )
    }
    return shippingCarrierUpstreamErrorResponse('shipments.create', error)
  }
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'Create shipment',
  methods: {
    GET: {
      summary: 'List carrier shipments for an order',
      tags: [shippingCarriersTag],
      query: carrierShipmentListQuerySchema,
      responses: [{ status: 200, description: 'Scoped carrier shipment summaries', schema: carrierShipmentListSchema }],
      errors: [
        { status: 400, description: 'Invalid query' },
        { status: 401, description: 'Unauthorized or no concrete organization scope' },
        { status: 403, description: 'Missing shipping carrier permissions' },
      ],
    },
    POST: {
      summary: 'Create shipment',
      tags: [shippingCarriersTag],
      responses: [
        { status: 201, description: 'Shipment created' },
        { status: 409, description: 'Idempotency conflict: the idempotency key was reused with a different payload' },
        { status: 422, description: 'Validation failed' },
        { status: 502, description: 'Provider upstream error' },
      ],
    },
  },
}
