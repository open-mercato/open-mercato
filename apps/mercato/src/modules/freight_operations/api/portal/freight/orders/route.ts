import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { FreightDriverRating, FreightOrder } from '../../../../data/entities'
import { createPortalOrderSchema } from '../../../../data/validators'
import '../../../../commands/orders'

const logger = createLogger('freight_operations')

export const metadata = {
  path: '/portal/freight/orders',
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

const PORTAL_VIEW_FEATURE = 'portal.freight.view'
const PORTAL_CREATE_FEATURE = 'portal.freight.orders.create'

function customerIds(customerEntityId: string | null | undefined, personEntityId: string | null | undefined): string[] {
  return [customerEntityId, personEntityId].filter((id): id is string => Boolean(id))
}

function displayStatus(status: string, source: string): string {
  if (source === 'customer_portal' && status === 'draft') return 'submitted'
  return status
}

export async function GET(req: Request) {
  try {
    const auth = await getCustomerAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    if (!auth.orgId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const container = await createRequestContainer()
    const rbac = container.resolve('customerRbacService') as CustomerRbacService
    const allowed = await rbac.userHasAllFeatures(auth.sub, [PORTAL_VIEW_FEATURE], {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const ids = customerIds(auth.customerEntityId, auth.personEntityId)
    if (!ids.length) return NextResponse.json({ items: [], total: 0 })

    const em = container.resolve('em') as EntityManager
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
    const orders = await findWithDecryption(
      em,
      FreightOrder,
      {
        ...scope,
        source: 'customer_portal',
        customerId: { $in: ids },
        deletedAt: null,
      },
      { orderBy: { createdAt: 'desc' }, limit: 100 },
      scope,
    ) as FreightOrder[]

    const ratings = orders.length
      ? await findWithDecryption(
          em,
          FreightDriverRating,
          {
            ...scope,
            orderId: { $in: orders.map((order) => order.id) },
            customerId: { $in: ids },
            deletedAt: null,
          },
          {},
          scope,
        ) as FreightDriverRating[]
      : []
    const ratingByOrder = new Map(ratings.map((rating) => [rating.orderId, rating]))

    return NextResponse.json({
      items: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: displayStatus(order.status, order.source),
        cargoDescription: order.cargoDescription,
        pickupLocation: order.pickupLocation,
        dropoffLocation: order.dropoffLocation,
        requestedPickupAt: order.requestedPickupAt ?? null,
        requestedDeliveryAt: order.requestedDeliveryAt ?? null,
        truckTypeRequired: order.truckTypeRequired,
        cargoQuantity: order.cargoQuantity ?? null,
        cargoUnit: order.cargoUnit ?? null,
        cargoWeightKg: order.cargoWeightKg ?? null,
        cargoVolumeM3: order.cargoVolumeM3 ?? null,
        cargoHazardous: order.cargoHazardous,
        cargoRefrigerated: order.cargoRefrigerated,
        notes: order.notes ?? null,
        submittedAt: order.submittedAt ?? null,
        driverRating: ratingByOrder.has(order.id)
          ? {
              rating: ratingByOrder.get(order.id)?.rating ?? null,
              comment: ratingByOrder.get(order.id)?.comment ?? null,
            }
          : null,
        createdAt: order.createdAt,
      })),
      total: orders.length,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('freight_operations.portal_orders.failed', { err })
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getCustomerAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    if (!auth.orgId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })

    const container = await createRequestContainer()
    const rbac = container.resolve('customerRbacService') as CustomerRbacService
    const allowed = await rbac.userHasAllFeatures(auth.sub, [PORTAL_CREATE_FEATURE], {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const customerId = auth.customerEntityId ?? auth.personEntityId
    if (!customerId) {
      return NextResponse.json({ error: 'No customer is linked to this portal user' }, { status: 409 })
    }

    const raw = await readJsonSafe(req, {})
    const input = createPortalOrderSchema.parse(raw ?? {})
    const customerSnapshot = {
      id: customerId,
      kind: auth.customerEntityId ? ('company' as const) : ('person' as const),
      displayName: auth.displayName,
      primaryEmail: auth.email,
      primaryPhone: null,
    }

    const ctx: CommandRuntimeContext = {
      container,
      auth: {
        sub: auth.sub,
        tenantId: auth.tenantId,
        orgId: auth.orgId,
        isSuperAdmin: false,
        isApiKey: false,
      } as unknown as CommandRuntimeContext['auth'],
      organizationScope: null,
      selectedOrganizationId: auth.orgId,
      organizationIds: [auth.orgId],
      request: req,
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      Record<string, unknown>,
      { orderId: string; orderNumber: string }
    >('freight_operations.orders.submit_external', {
      input: { ...input, customerId, customerSnapshot },
      ctx,
    })
    return NextResponse.json(
      { ok: true, orderId: result.orderId, orderNumber: result.orderNumber },
      { status: 201 },
    )
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid input', details: err.issues }, { status: 400 })
    }
    logger.error('freight_operations.portal_order_create.failed', { err })
    return NextResponse.json({ error: 'Failed to submit the order' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Customer portal transport orders',
  methods: {
    GET: {
      summary: 'List the authenticated customer’s submitted transport orders',
      responses: [
        {
          status: 200,
          description: 'The customer’s orders',
          schema: z.object({
            items: z.array(z.object({
              id: z.string().uuid(),
              orderNumber: z.string(),
              status: z.string(),
              cargoDescription: z.string(),
              pickupLocation: z.string(),
              dropoffLocation: z.string(),
              requestedPickupAt: z.string().nullable().optional(),
              requestedDeliveryAt: z.string().nullable().optional(),
            })),
            total: z.number(),
          }),
        },
      ],
    },
    POST: {
      summary: 'Submit a transport order for staff review',
      requestBody: { contentType: 'application/json', schema: createPortalOrderSchema },
      responses: [
        {
          status: 201,
          description: 'Order submitted',
          schema: z.object({
            ok: z.boolean(),
            orderId: z.string().uuid(),
            orderNumber: z.string(),
          }),
        },
      ],
    },
  },
}
