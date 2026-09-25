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
