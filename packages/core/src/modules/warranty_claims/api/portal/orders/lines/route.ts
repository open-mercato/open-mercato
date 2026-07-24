import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveEffectiveWarrantyClaimSettings } from '../../../../lib/settings'
import { computeWarrantyEntitlementPreview } from '../../../../lib/warrantyPreview'
import type { WarrantyClaimWarrantyStatus } from '../../../../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('warranty_claims')

const querySchema = z
  .object({
    orderId: z.string().uuid(),
  })
  .strict()

const orderSchema = z.object({
  id: z.string().uuid(),
  placedAt: z.string().nullable(),
})

const orderLineSchema = z.object({
  orderLineId: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  variantId: z.string().uuid().nullable(),
  sku: z.string().nullable(),
  name: z.string().nullable(),
  quantity: z.union([z.string(), z.number()]).nullable(),
  estimatedWarrantyStatus: z.enum(['in_warranty', 'out_of_warranty', 'unknown']),
})

const responseSchema = z.object({
  ok: z.literal(true),
  order: orderSchema,
  items: z.array(orderLineSchema),
})

type PortalOrderLinesContext = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: EntityManager
}

type OwnedOrder = {
  id: string
  placedAt: string | null
}

type PortalOrderLineItem = z.infer<typeof orderLineSchema>

export const metadata = {
  GET: { requireAuth: false },
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function isMissingTableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const candidate = err as { code?: unknown; message?: unknown }
  return candidate.code === '42P01'
    || (typeof candidate.message === 'string' && candidate.message.includes('does not exist'))
}

function amountField(record: Record<string, unknown>, key: string): string | number | null {
  const value = record[key]
  if (typeof value === 'string' || typeof value === 'number') return value
  return null
}

function toIso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return null
}

function estimateWarrantyStatus(placedAt: string | null, defaultWarrantyMonths: number | null): WarrantyClaimWarrantyStatus {
  if (!placedAt) return 'unknown'
  return computeWarrantyEntitlementPreview(new Date(placedAt), defaultWarrantyMonths)
}

async function resolvePortalContext(req: Request): Promise<PortalOrderLinesContext | Response> {
  const auth = await getCustomerAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') }, { status: 401 })
  }
  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.customerAccountNotLinked', 'Customer account is not linked to a customer record') }, { status: 403 })
  }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  return {
    auth,
    customerId: auth.customerEntityId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    container,
    em,
  }
}

type PortalOrderLinesDb = {
  sales_orders: {
    id: string
    placed_at: Date | null
    customer_entity_id: string | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
  sales_order_lines: {
    id: string
    order_id: string
    kind: string | null
    product_id: string | null
    product_variant_id: string | null
    catalog_snapshot: Record<string, unknown> | null
    name: string | null
    quantity: string | number | null
    tenant_id: string | null
    organization_id: string | null
    deleted_at: Date | null
  }
}

async function loadOwnedOrder(
  context: PortalOrderLinesContext,
  orderId: string,
): Promise<OwnedOrder | null> {
  try {
    const db = context.em.getKysely<PortalOrderLinesDb>()
    const row = await db
      .selectFrom('sales_orders')
      .select(['id', 'placed_at'])
      .where('id', '=', orderId)
      .where('tenant_id', '=', context.tenantId)
      .where('organization_id', '=', context.organizationId)
      .where('customer_entity_id', '=', context.customerId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
    if (!row) return null
    return { id: row.id, placedAt: toIso(row.placed_at) }
  } catch (err) {
    if (isMissingTableError(err)) return null
    throw err
  }
}

function serializeOrderLine(
  row: Record<string, unknown>,
  estimatedWarrantyStatus: WarrantyClaimWarrantyStatus,
): PortalOrderLineItem | null {
  if (stringField(row, 'kind') !== 'product') return null
  const id = stringField(row, 'id')
  if (!id) return null
  const snapshot = row.catalog_snapshot && typeof row.catalog_snapshot === 'object' && !Array.isArray(row.catalog_snapshot)
    ? row.catalog_snapshot as Record<string, unknown>
    : {}
  return {
    orderLineId: id,
    productId: stringField(row, 'product_id'),
    variantId: stringField(row, 'product_variant_id'),
    sku: stringField(row, 'sku') ?? stringField(snapshot, 'sku') ?? stringField(snapshot, 'variantSku') ?? stringField(snapshot, 'variant_sku'),
    name: stringField(row, 'name') ?? stringField(snapshot, 'title') ?? stringField(snapshot, 'name'),
    quantity: amountField(row, 'quantity'),
    estimatedWarrantyStatus,
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const query = querySchema.parse(Object.fromEntries(url.searchParams))
    const contextOrResponse = await resolvePortalContext(req)
    if (contextOrResponse instanceof Response) return contextOrResponse
    const context = contextOrResponse
    const { translate } = await resolveTranslations()
    const order = await loadOwnedOrder(context, query.orderId)
    if (!order) {
      return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.orderNotOwned', 'Order not found') }, { status: 404 })
    }

    const settings = await resolveEffectiveWarrantyClaimSettings(context.em, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    const estimatedWarrantyStatus = estimateWarrantyStatus(order.placedAt, settings.defaultWarrantyMonths)
    const db = context.em.getKysely<PortalOrderLinesDb>()
    let rows: Array<Record<string, unknown>> = []
    try {
      rows = await db
        .selectFrom('sales_order_lines')
        .select(['id', 'order_id', 'kind', 'product_id', 'product_variant_id', 'catalog_snapshot', 'name', 'quantity'])
        .where('order_id', '=', order.id)
        .where('tenant_id', '=', context.tenantId)
        .where('organization_id', '=', context.organizationId)
        .where('deleted_at', 'is', null)
        .limit(100)
        .execute() as Array<Record<string, unknown>>
    } catch (err) {
      if (!isMissingTableError(err)) throw err
    }

    return NextResponse.json({
      ok: true,
      order,
      items: rows
        .map((row) => serializeOrderLine(row, estimatedWarrantyStatus))
        .filter((item): item is PortalOrderLineItem => item !== null),
    })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    logger.error('warranty_claims.portal.order_lines.get failed', { err })
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim order line picker',
  methods: {
    GET: {
      summary: 'List product lines for an authenticated customer-owned order',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Customer-owned sales order product lines',
          schema: responseSchema,
        },
      ],
    },
  },
}
