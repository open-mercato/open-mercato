import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('transport_operations')

export const metadata = {
  path: '/transport_operations/tracking',
  GET: { requireAuth: true, requireFeatures: ['transport.tracking.view'] },
}

type VehicleRow = {
  id: string
  plate_number: string
  make: string
  model: string
  vehicle_type: string | null
  status: string
  latitude: string | null
  longitude: string | null
  speed_kph: string | null
  heading: string | null
  recorded_at: Date | string | null
  driver_id: string | null
  driver_name: string | null
}

type AlertRow = {
  id: string
  driver_id: string
  driver_name: string | null
  trip_id: string | null
  order_id: string | null
  latitude: string | null
  longitude: string | null
  note: string | null
  created_at: Date | string
}

type TripRow = {
  id: string
  trip_number: string
  vehicle_id: string
  origin: string
  destination: string
  execution_status: string
  requested_delivery_at: Date | string | null
}

function isMissingRelationError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('42P01') || /relation .* does not exist/i.test(message)
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) return NextResponse.json({ error: 'Organization context is required' }, { status: 400 })
    const em = container.resolve('em') as EntityManager

    const vehicles = await em.getConnection().execute<VehicleRow[]>(
      `select v.id, v.plate_number, v.make, v.model, v.vehicle_type, v.status,
              p.latitude, p.longitude, p.speed_kph, p.heading, p.recorded_at,
              p.driver_id, d.full_name as driver_name
         from transport_vehicles v
         left join lateral (
           select pos.latitude, pos.longitude, pos.speed_kph, pos.heading, pos.recorded_at, pos.driver_id
             from transport_vehicle_positions pos
            where pos.vehicle_id = v.id and pos.organization_id = v.organization_id
            order by pos.recorded_at desc
            limit 1
         ) p on true
         left join transport_drivers d on d.id = p.driver_id
        where v.tenant_id = ? and v.organization_id = ? and v.deleted_at is null
        order by v.plate_number asc`,
      [auth.tenantId, organizationId],
    )

    let trips: TripRow[] = []
    try {
      trips = await em.getConnection().execute<TripRow[]>(
        `select t.id, t.trip_number, t.vehicle_id, t.origin, t.destination, t.execution_status,
                o.requested_delivery_at
           from freight_trips t
           left join freight_orders o on o.id = t.freight_order_id
          where t.tenant_id = ? and t.organization_id = ? and t.deleted_at is null
            and t.execution_status in ('dispatched', 'in_transit')
          order by t.execution_date asc`,
        [auth.tenantId, organizationId],
      )
    } catch (err) {
      if (!isMissingRelationError(err)) throw err
    }
    const tripByVehicle = new Map<string, TripRow>()
    for (const trip of trips) {
      if (!tripByVehicle.has(trip.vehicle_id)) tripByVehicle.set(trip.vehicle_id, trip)
    }

    let alerts: AlertRow[] = []
    try {
      alerts = await em.getConnection().execute<AlertRow[]>(
        `select a.id, a.driver_id, d.full_name as driver_name, a.trip_id, a.order_id,
                a.latitude, a.longitude, a.note, a.created_at
           from freight_driver_alerts a
           left join transport_drivers d on d.id = a.driver_id
          where a.tenant_id = ? and a.organization_id = ?
            and a.created_at > now() - interval '24 hours'
          order by a.created_at desc
          limit 20`,
        [auth.tenantId, organizationId],
      )
    } catch (err) {
      if (!isMissingRelationError(err)) throw err
    }

    return NextResponse.json({
      items: vehicles.map((vehicle) => {
        const trip = tripByVehicle.get(vehicle.id)
        return {
          vehicleId: vehicle.id,
          plateNumber: vehicle.plate_number,
          make: vehicle.make,
          model: vehicle.model,
          vehicleType: vehicle.vehicle_type,
          status: vehicle.status,
          position: vehicle.latitude !== null && vehicle.longitude !== null
            ? {
                latitude: Number(vehicle.latitude),
                longitude: Number(vehicle.longitude),
                speedKph: vehicle.speed_kph === null ? null : Number(vehicle.speed_kph),
                heading: vehicle.heading === null ? null : Number(vehicle.heading),
                recordedAt: vehicle.recorded_at,
              }
            : null,
          driverId: vehicle.driver_id,
          driverName: vehicle.driver_name,
          activeTrip: trip
            ? {
                id: trip.id,
                tripNumber: trip.trip_number,
                origin: trip.origin,
                destination: trip.destination,
                executionStatus: trip.execution_status,
                late: Boolean(trip.requested_delivery_at && new Date(trip.requested_delivery_at).getTime() < Date.now()),
              }
            : null,
        }
      }),
      alerts: alerts.map((alert) => ({
        id: alert.id,
        driverId: alert.driver_id,
        driverName: alert.driver_name,
        tripId: alert.trip_id,
        orderId: alert.order_id,
        latitude: alert.latitude === null ? null : Number(alert.latitude),
        longitude: alert.longitude === null ? null : Number(alert.longitude),
        note: alert.note,
        createdAt: alert.created_at,
      })),
      total: vehicles.length,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('transport_operations.tracking.failed', { err })
    return NextResponse.json({ error: 'Failed to load the tracking board' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Transport Operations',
  summary: 'Live vehicle tracking board',
  methods: {
    GET: {
      summary: 'Latest position and active freight trip per vehicle',
      responses: [{
        status: 200,
        description: 'Vehicles with their latest position',
        schema: z.object({
          items: z.array(z.object({
            vehicleId: z.string().uuid(),
            plateNumber: z.string(),
            make: z.string(),
            model: z.string(),
            vehicleType: z.string().nullable().optional(),
            status: z.string(),
            position: z.object({
              latitude: z.number(),
              longitude: z.number(),
              speedKph: z.number().nullable().optional(),
              heading: z.number().nullable().optional(),
              recordedAt: z.string().nullable().optional(),
            }).nullable(),
            driverId: z.string().uuid().nullable().optional(),
            driverName: z.string().nullable().optional(),
            activeTrip: z.object({
              id: z.string().uuid(),
              tripNumber: z.string(),
              origin: z.string(),
              destination: z.string(),
              executionStatus: z.string(),
              late: z.boolean(),
            }).nullable(),
          })),
          alerts: z.array(z.object({
            id: z.string().uuid(),
            driverId: z.string().uuid(),
            driverName: z.string().nullable().optional(),
            tripId: z.string().uuid().nullable().optional(),
            orderId: z.string().uuid().nullable().optional(),
            latitude: z.number().nullable().optional(),
            longitude: z.number().nullable().optional(),
            note: z.string().nullable().optional(),
            createdAt: z.string(),
          })),
          total: z.number(),
        }),
      }],
    },
  },
}
