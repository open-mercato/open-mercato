import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { TransportDriver, TransportRoute, TransportTripSchedule, TransportVehicle } from '../data/entities'
import {
  createDriverSchema,
  createRouteSchema,
  createTripScheduleSchema,
  createVehicleSchema,
  updateDriverSchema,
  updateRouteSchema,
  updateTripScheduleSchema,
  updateVehicleSchema,
} from '../data/validators'
import { registerCrudCommands } from './crud'
import {
  assertTripAssignmentAvailable,
  assertVehicleIdentityUnique,
  type TransportScope,
} from '../lib/transportService'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'

export function makeEvents<TEntity extends object>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'transport_operations',
    entity,
    persistent: true,
    buildPayload: ({ identifiers }) => ({
      id: identifiers.id,
      organizationId: identifiers.organizationId,
      tenantId: identifiers.tenantId,
    }),
  }
}

export function makeIndexer<TEntity extends object>(entityType: string): CrudIndexerConfig<TEntity> {
  return { entityType }
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value))
}

function scopeFrom(ctx: CommandRuntimeContext): TransportScope {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) throw new Error('[internal] Transport scope is unavailable')
  return { tenantId, organizationId }
}

function tripAssignment(input: Record<string, unknown>, id?: string) {
  return {
    ...(id ? { id } : {}),
    routeId: String(input.routeId),
    vehicleId: String(input.vehicleId),
    driverId: String(input.driverId),
    scheduledStartTime: toDate(input.scheduledStartTime),
    scheduledEndTime: toDate(input.scheduledEndTime),
  }
}

export const TRANSPORT_VEHICLE_ENTITY_ID = 'transport_operations:transport_vehicle' as const
export const TRANSPORT_DRIVER_ENTITY_ID = 'transport_operations:transport_driver' as const
export const TRANSPORT_ROUTE_ENTITY_ID = 'transport_operations:transport_route' as const
export const TRANSPORT_TRIP_ENTITY_ID = 'transport_operations:transport_trip_schedule' as const
export const transportVehicleEvents = makeEvents<TransportVehicle>('vehicle')
export const transportVehicleIndexer = makeIndexer<TransportVehicle>(TRANSPORT_VEHICLE_ENTITY_ID)
export const transportDriverEvents = makeEvents<TransportDriver>('driver')
export const transportDriverIndexer = makeIndexer<TransportDriver>(TRANSPORT_DRIVER_ENTITY_ID)
export const transportRouteEvents = makeEvents<TransportRoute>('route')
export const transportRouteIndexer = makeIndexer<TransportRoute>(TRANSPORT_ROUTE_ENTITY_ID)
export const transportTripEvents = makeEvents<TransportTripSchedule>('trip_schedule')
export const transportTripIndexer = makeIndexer<TransportTripSchedule>(TRANSPORT_TRIP_ENTITY_ID)

registerCrudCommands({
  entity: TransportVehicle,
  entityId: TRANSPORT_VEHICLE_ENTITY_ID,
  resource: 'vehicles',
  createSchema: createVehicleSchema,
  updateSchema: updateVehicleSchema,
  toCreateData: (input) => input,
  toUpdateData: (input) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id')),
  beforeCreate: async (input, scope, ctx) => {
    await assertVehicleIdentityUnique(ctx.container.resolve('em') as EntityManager, scope, {
      plateNumber: input.plateNumber,
      vin: input.vin,
    })
  },
  beforeUpdate: async (input, current, scope, ctx) => {
    await assertVehicleIdentityUnique(ctx.container.resolve('em') as EntityManager, scope, {
      // A partial update that does not touch the plate must still be checked
      // against the plate the row already has, or an edit that only changes the
      // model would silently keep a value that clashes with a newer row.
      plateNumber: input.plateNumber ?? current.plateNumber,
      vin: input.vin ?? current.vin,
      excludeId: current.id,
    })
  },
  events: transportVehicleEvents,
  indexer: transportVehicleIndexer,
})

registerCrudCommands({
  entity: TransportDriver,
  entityId: TRANSPORT_DRIVER_ENTITY_ID,
  resource: 'drivers',
  createSchema: createDriverSchema,
  updateSchema: updateDriverSchema,
  toCreateData: (input) => ({ ...input, licenseExpiry: toDate(input.licenseExpiry) }),
  toUpdateData: (input) => {
    const { id: _id, licenseExpiry, ...patch } = input
    return licenseExpiry === undefined ? patch : { ...patch, licenseExpiry: toDate(licenseExpiry) }
  },
  events: transportDriverEvents,
  indexer: transportDriverIndexer,
})

registerCrudCommands({
  entity: TransportRoute,
  entityId: TRANSPORT_ROUTE_ENTITY_ID,
  resource: 'routes',
  createSchema: createRouteSchema,
  updateSchema: updateRouteSchema,
  toCreateData: (input) => input,
  toUpdateData: (input) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id')),
  events: transportRouteEvents,
  indexer: transportRouteIndexer,
})

registerCrudCommands({
  entity: TransportTripSchedule,
  entityId: TRANSPORT_TRIP_ENTITY_ID,
  resource: 'trips',
  createSchema: createTripScheduleSchema,
  updateSchema: updateTripScheduleSchema,
  toCreateData: (input) => ({
    ...input,
    scheduledStartTime: toDate(input.scheduledStartTime),
    scheduledEndTime: toDate(input.scheduledEndTime),
    status: 'scheduled' as const,
  }),
  toUpdateData: (input) => {
    const { id: _id, scheduledStartTime, scheduledEndTime, ...patch } = input
    return {
      ...patch,
      ...(scheduledStartTime === undefined ? {} : { scheduledStartTime: toDate(scheduledStartTime) }),
      ...(scheduledEndTime === undefined ? {} : { scheduledEndTime: toDate(scheduledEndTime) }),
    }
  },
  events: transportTripEvents,
  indexer: transportTripIndexer,
  beforeCreate: async (input, scope, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await assertTripAssignmentAvailable(em, tripAssignment(input), scope)
  },
  beforeUpdate: async (input, current, scope, ctx) => {
    const row = current as TransportTripSchedule
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await assertTripAssignmentAvailable(em, {
      id: row.id,
      routeId: typeof input.routeId === 'string' ? input.routeId : row.routeId,
      vehicleId: typeof input.vehicleId === 'string' ? input.vehicleId : row.vehicleId,
      driverId: typeof input.driverId === 'string' ? input.driverId : row.driverId,
      scheduledStartTime: input.scheduledStartTime === undefined ? row.scheduledStartTime : toDate(input.scheduledStartTime),
      scheduledEndTime: input.scheduledEndTime === undefined ? row.scheduledEndTime : toDate(input.scheduledEndTime),
    }, scope)
  },
})
