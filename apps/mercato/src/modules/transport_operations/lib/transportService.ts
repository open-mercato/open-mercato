import type { EntityManager } from '@mikro-orm/postgresql'
import { raiseTransportError } from './errors'
import { TransportDriver, TransportRoute, TransportTripSchedule, TransportVehicle } from '../data/entities'

export type TransportScope = { tenantId: string; organizationId: string }

export type TripAssignment = {
  id?: string
  routeId: string
  vehicleId: string
  driverId: string
  scheduledStartTime: Date
  scheduledEndTime: Date
}

export type TransportDashboardSummary = {
  activeVehicles: number
  availableDrivers: number
  expiringDriverLicenses: number
  scheduledTrips: number
  tripsInProgress: number
}

export type TransportService = {
  assertTripAssignmentAvailable(input: TripAssignment, scope: TransportScope): Promise<void>
  getDashboardSummary(scope: TransportScope): Promise<TransportDashboardSummary>
}

export async function assertTripAssignmentAvailable(
  em: EntityManager,
  input: TripAssignment,
  scope: TransportScope,
): Promise<void> {
  if (input.scheduledEndTime <= input.scheduledStartTime) {
    return raiseTransportError(400, 'invalid_trip_time', 'Trip end time must be after start time.')
  }

  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const [route, vehicle, driver] = await Promise.all([
    em.findOne(TransportRoute, { ...scoped, id: input.routeId }),
    em.findOne(TransportVehicle, { ...scoped, id: input.vehicleId }),
    em.findOne(TransportDriver, { ...scoped, id: input.driverId }),
  ])
  if (!route) return raiseTransportError(400, 'route_unavailable', 'The selected route is not available.')
  if (!vehicle || vehicle.status !== 'active') {
    return raiseTransportError(409, 'vehicle_unavailable', 'The selected vehicle is unavailable.')
  }
  if (!driver || driver.status === 'suspended' || driver.status === 'on_leave') {
    return raiseTransportError(409, 'driver_unavailable', 'The selected driver is unavailable.')
  }
  if (new Date(driver.licenseExpiry).getTime() < Date.now()) {
    return raiseTransportError(409, 'driver_license_expired', 'The selected driver has an expired license.')
  }

  const overlapping = await em.findOne(TransportTripSchedule, {
    ...scoped,
    ...(input.id ? { id: { $ne: input.id } } : {}),
    status: { $in: ['scheduled', 'in_progress'] },
    scheduledStartTime: { $lt: input.scheduledEndTime },
    scheduledEndTime: { $gt: input.scheduledStartTime },
    $or: [{ vehicleId: input.vehicleId }, { driverId: input.driverId }],
  })
  if (overlapping) return raiseTransportError(409, 'trip_assignment_overlap', 'The vehicle or driver already has a trip during this time.')
}

export function createTransportService(em: EntityManager): TransportService {
  return {
    assertTripAssignmentAvailable: (input, scope) => assertTripAssignmentAvailable(em, input, scope),
    async getDashboardSummary(scope) {
      const base = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
      const licenseCutoff = new Date()
      licenseCutoff.setDate(licenseCutoff.getDate() + 30)
      const [activeVehicles, availableDrivers, expiringDriverLicenses, scheduledTrips, tripsInProgress] = await Promise.all([
        em.count(TransportVehicle, { ...base, status: 'active' }),
        em.count(TransportDriver, { ...base, status: 'available' }),
        em.count(TransportDriver, { ...base, licenseExpiry: { $lte: licenseCutoff } }),
        em.count(TransportTripSchedule, { ...base, status: 'scheduled' }),
        em.count(TransportTripSchedule, { ...base, status: 'in_progress' }),
      ])
      return { activeVehicles, availableDrivers, expiringDriverLicenses, scheduledTrips, tripsInProgress }
    },
  }
}

/**
 * Uniqueness of a vehicle's identity fields.
 *
 * The database carries unique indexes for these (see the entity's `@Index`
 * expressions) and they remain the backstop, but a constraint violation surfaces
 * as a 500 with a driver message and no field to fix. Checking here turns it into
 * a 409 that names the plate or the VIN, which is what an operator can act on.
 *
 * The check runs inside the writing command's transaction, so it narrows the race
 * rather than closing it — two simultaneous creates can both pass and one then
 * fails on the index. That is the correct division: this is the message, the
 * index is the guarantee. `excludeId` lets an update keep its own values.
 */
export async function assertVehicleIdentityUnique(
  em: EntityManager,
  scope: TransportScope,
  input: { plateNumber?: unknown; vin?: unknown; sequenceNumber?: unknown; excludeId?: string | null },
): Promise<void> {
  const plateNumber = typeof input.plateNumber === 'string' ? input.plateNumber.trim() : ''
  const vin = typeof input.vin === 'string' ? input.vin.trim() : ''
  const sequenceNumber = typeof input.sequenceNumber === 'string' ? input.sequenceNumber.trim() : ''

  if (plateNumber) {
    const clash = await em.findOne(TransportVehicle, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      plateNumber,
      deletedAt: null,
      ...(input.excludeId ? { id: { $ne: input.excludeId } } : {}),
    })
    if (clash) await raiseTransportError(409, 'vehicle_plate_taken', 'Another vehicle already uses this plate number.')
  }

  if (vin) {
    const clash = await em.findOne(TransportVehicle, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      vin,
      deletedAt: null,
      ...(input.excludeId ? { id: { $ne: input.excludeId } } : {}),
    })
    if (clash) await raiseTransportError(409, 'vehicle_vin_taken', 'Another vehicle already uses this VIN.')
  }

  if (sequenceNumber) {
    const clash = await em.findOne(TransportVehicle, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      sequenceNumber,
      deletedAt: null,
      ...(input.excludeId ? { id: { $ne: input.excludeId } } : {}),
    })
    if (clash) await raiseTransportError(409, 'vehicle_sequence_taken', 'Another vehicle already uses this sequence number.')
  }
}
