import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { FreightDeliveryNote, FreightOrder } from '../../../data/entities'

const logger = createLogger('freight_operations')

export const metadata = {
  path: '/freight_operations/public/tracking',
  GET: { requireAuth: false },
}

function snapshotString(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const value = (snapshot as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export async function GET(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get('token')?.trim()
    if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const order = await em.findOne(FreightOrder, {
      trackingToken: token,
      deletedAt: null,
    })
    if (!order) return NextResponse.json({ error: 'Tracking link not found' }, { status: 404 })

    const deliveryNote = await em.findOne(
      FreightDeliveryNote,
      {
        freightOrderId: order.id,
        tenantId: order.tenantId,
        organizationId: order.organizationId,
        status: { $in: ['issued', 'delivered'] },
        deletedAt: null,
      },
      { orderBy: { issuedAt: 'desc' } },
    )

    const body = {
      orderNumber: order.orderNumber,
      status: order.status,
      cargoDescription: order.cargoDescription,
      pickupLocation: order.pickupLocation,
      dropoffLocation: order.dropoffLocation,
      requestedPickupAt: order.requestedPickupAt ?? null,
      requestedDeliveryAt: order.requestedDeliveryAt ?? null,
      deliveredAt: order.deliveredAt ?? null,
      completedAt: order.completedAt ?? null,
      driverName: snapshotString(order.driverSnapshot, 'fullName'),
      vehiclePlate: snapshotString(order.vehicleSnapshot, 'plateNumber'),
      deliveryNoteNumber: deliveryNote?.noteNumber ?? null,
      updatedAt: order.updatedAt,
    }
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    logger.error('freight_operations.public_tracking.failed', { err })
    return NextResponse.json({ error: 'Unable to load the tracking status' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Public order tracking by token',
  methods: {
    GET: {
      summary: 'Read the non-sensitive status of an order by its public tracking token',
      responses: [{
        status: 200,
        description: 'Order tracking status',
        schema: z.object({
          orderNumber: z.string(),
          status: z.string(),
          cargoDescription: z.string(),
          pickupLocation: z.string(),
          dropoffLocation: z.string(),
          requestedPickupAt: z.string().nullable().optional(),
          requestedDeliveryAt: z.string().nullable().optional(),
          deliveredAt: z.string().nullable().optional(),
          completedAt: z.string().nullable().optional(),
          driverName: z.string().nullable().optional(),
          vehiclePlate: z.string().nullable().optional(),
          deliveryNoteNumber: z.string().nullable().optional(),
          updatedAt: z.string().nullable().optional(),
        }),
      }],
    },
  },
}
