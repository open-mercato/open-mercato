import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { EntityManager } from '@mikro-orm/postgresql'
import { FreightDriverRestBreak, FreightOrder, FreightTrip } from '../../../data/entities'
import { resolveDriverForUser } from '../../../lib/driverIdentity'

const logger = createLogger('freight_operations')

export const metadata = {
  path: '/freight_operations/driver/work',
  GET: { requireAuth: true, requireFeatures: ['freight.driver_app'] },
}

const ORDER_STATUSES = ['assigned', 'in_transit', 'delivered'] as const
const TRIP_STATUSES = ['planned', 'dispatched', 'in_transit', 'delivered'] as const

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const userId = auth.sub ?? auth.userId
    if (!userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const scope = { tenantId: auth.tenantId, organizationId }
    const em = container.resolve('em') as EntityManager
    const driver = await resolveDriverForUser(em, scope, userId)
    if (!driver) {
      return NextResponse.json(
        { error: 'No driver record is linked to this user.' },
        { status: 403 },
      )
    }

    const [orders, trips, openBreak] = await Promise.all([
      findWithDecryption(
        em,
        FreightOrder,
        {
          ...scope,
          driverId: driver.id,
          status: { $in: [...ORDER_STATUSES] },
          deletedAt: null,
        },
        { orderBy: { requestedPickupAt: 'asc', createdAt: 'desc' }, limit: 100 },
        scope,
      ) as Promise<FreightOrder[]>,
      findWithDecryption(
        em,
        FreightTrip,
        {
          ...scope,
          driverId: driver.id,
          executionStatus: { $in: [...TRIP_STATUSES] },
          deletedAt: null,
        },
        { orderBy: { executionDate: 'asc', createdAt: 'desc' }, limit: 100 },
        scope,
      ) as Promise<FreightTrip[]>,
      em.findOne(FreightDriverRestBreak, {
        ...scope,
        driverId: driver.id,
        endedAt: null,
        deletedAt: null,
      }),
    ])

    return NextResponse.json({
      driver,
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        cargoDescription: order.cargoDescription,
        pickupLocation: order.pickupLocation,
        dropoffLocation: order.dropoffLocation,
        requestedPickupAt: order.requestedPickupAt ?? null,
        requestedDeliveryAt: order.requestedDeliveryAt ?? null,
        customerSnapshot: order.customerSnapshot,
        podReference: order.podReference ?? null,
        updatedAt: order.updatedAt ?? null,
      })),
      trips: trips.map((trip) => ({
        id: trip.id,
        tripNumber: trip.tripNumber,
        executionStatus: trip.executionStatus,
        origin: trip.origin,
        destination: trip.destination,
        executionDate: trip.executionDate,
        customerSnapshot: trip.customerSnapshot,
        podReference: trip.podReference ?? null,
        updatedAt: trip.updatedAt ?? null,
      })),
      openRestBreak: openBreak
        ? {
            id: openBreak.id,
            tripId: openBreak.tripId ?? null,
            startedAt: openBreak.startedAt,
          }
        : null,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('freight_operations.driver_work.failed', { err })
    return NextResponse.json({ error: 'Failed to load driver work' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Driver workspace work list',
  methods: {
    GET: {
      summary: 'Return the signed-in driver’s assigned orders, trips and open rest break',
      responses: [
        {
          status: 200,
          description: 'Driver profile and assigned work',
          schema: z.object({
            driver: z.object({
              id: z.string().uuid(),
              fullName: z.string(),
              phone: z.string(),
              status: z.string(),
            }),
            orders: z.array(z.object({
              id: z.string().uuid(),
              orderNumber: z.string(),
              status: z.string(),
              cargoDescription: z.string(),
              pickupLocation: z.string(),
              dropoffLocation: z.string(),
              updatedAt: z.string().nullable().optional(),
            })),
            trips: z.array(z.object({
              id: z.string().uuid(),
              tripNumber: z.string(),
              executionStatus: z.string(),
              origin: z.string(),
              destination: z.string(),
              updatedAt: z.string().nullable().optional(),
            })),
            openRestBreak: z.object({
              id: z.string().uuid(),
              tripId: z.string().uuid().nullable().optional(),
              startedAt: z.string(),
            }).nullable(),
          }),
        },
      ],
    },
  },
}
