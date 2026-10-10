import type { EntityManager } from '@mikro-orm/postgresql'
import { raiseFreightError } from './errors'
import {
  findTransportDriver,
  findTransportVehicle,
  hasTransportScheduleOverlap,
  type TransportScope,
} from './transportReference'

export type FreightAssignmentInput = {
  orderId?: string
  vehicleId: string
  driverId: string
  start: Date
  end: Date
}

export type FreightAssignmentSnapshots = {
  vehicleSnapshot: Record<string, unknown> | null
  driverSnapshot: Record<string, unknown> | null
}

/**
 * Freight's own availability rules, over its order board plus the peer fleet
 * board when it exists. Parallel of `transport_operations`'s
 * `assertTripAssignmentAvailable`, deliberately not imported: freight must keep
 * working when the peer is disabled, and the peer's command state machine owns
 * its own board.
 */
export async function assertFreightAssignmentAvailable(
  em: EntityManager,
  input: FreightAssignmentInput,
  scope: TransportScope,
): Promise<FreightAssignmentSnapshots> {
  if (input.end <= input.start) {
    return raiseFreightError(400, 'invalid_assignment_window', 'The assignment end must be after its start.')
  }

  const [vehicleLookup, driverLookup] = await Promise.all([
    findTransportVehicle(em, scope, input.vehicleId),
    findTransportDriver(em, scope, input.driverId),
  ])

  if (vehicleLookup.available) {
    const vehicle = vehicleLookup.vehicle
    if (!vehicle || vehicle.status !== 'active') {
      return raiseFreightError(409, 'vehicle_unavailable', 'The selected vehicle is unavailable.')
    }
  }
  if (driverLookup.available) {
    const driver = driverLookup.driver
    if (!driver || driver.status === 'suspended' || driver.status === 'on_leave') {
      return raiseFreightError(409, 'driver_unavailable', 'The selected driver is unavailable.')
    }
    if (driver.licenseExpiry && new Date(driver.licenseExpiry).getTime() < Date.now()) {
      return raiseFreightError(409, 'driver_license_expired', 'The selected driver has an expired license.')
    }
  }

  const rows = await em.getConnection().execute<{ id: string }[]>(
    `
      select id from freight_orders
      where tenant_id = ? and organization_id = ? and deleted_at is null
        and status in ('assigned', 'in_transit', 'delivered')
        and (vehicle_id = ? or driver_id = ?)
        and coalesce(requested_pickup_at, created_at) < ?
        and coalesce(requested_delivery_at, coalesce(requested_pickup_at, created_at) + interval '1 day') > ?
        ${input.orderId ? 'and id <> ?' : ''}
      limit 1
    `,
    [
      scope.tenantId,
      scope.organizationId,
      input.vehicleId,
      input.driverId,
      input.end,
      input.start,
      ...(input.orderId ? [input.orderId] : []),
    ],
  )
  if (rows.length > 0) {
    return raiseFreightError(409, 'assignment_overlap', 'The vehicle or driver already has an overlapping job.')
  }

  const fleetOverlap = await hasTransportScheduleOverlap(em, scope, {
    vehicleId: input.vehicleId,
    driverId: input.driverId,
    start: input.start,
    end: input.end,
  })
  if (fleetOverlap) {
    return raiseFreightError(409, 'assignment_overlap', 'The vehicle or driver already has an overlapping job.')
  }

  return {
    vehicleSnapshot: vehicleLookup.vehicle
      ? {
          id: vehicleLookup.vehicle.id,
          plateNumber: vehicleLookup.vehicle.plateNumber,
          make: vehicleLookup.vehicle.make,
          model: vehicleLookup.vehicle.model,
        }
      : null,
    driverSnapshot: driverLookup.driver
      ? {
          id: driverLookup.driver.id,
          fullName: driverLookup.driver.fullName,
          phone: driverLookup.driver.phone,
          licenseNumber: driverLookup.driver.licenseNumber,
        }
      : null,
  }
}
