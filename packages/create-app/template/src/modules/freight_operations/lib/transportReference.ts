import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Read-only coupling to the transport_operations fleet master data.
 *
 * Freight never declares a hard dependency on transport_operations and never
 * joins its tables through the ORM: records carry the id plus a snapshot, and
 * every lookup here reads the peer's table by name with tenant/org scope,
 * tolerating a missing table (`42P01`) so the module degrades to manual entry
 * when transport_operations is disabled.
 */

export type TransportScope = { tenantId: string; organizationId: string }

export type TransportVehicleReference = {
  id: string
  plateNumber: string
  make: string
  model: string
  status: string
}

export type TransportDriverReference = {
  id: string
  fullName: string
  phone: string
  status: string
  licenseNumber: string
  licenseExpiry: string | null
}

export type TransportRouteReference = {
  id: string
  code: string
  name: string
  startLocation: string
  endLocation: string
}

const MAX_REFERENCE_ROWS = 500

function isMissingRelationError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('42P01') || /relation .* does not exist/i.test(message)
}

async function tolerantRows<T>(em: EntityManager, sql: string, params: unknown[]): Promise<T[] | null> {
  try {
    return await em.getConnection().execute<T[]>(sql, params)
  } catch (err) {
    if (isMissingRelationError(err)) return null
    throw err
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function readDateString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function listTransportVehicles(
  em: EntityManager,
  scope: TransportScope,
): Promise<TransportVehicleReference[] | null> {
  const rows = await tolerantRows<Record<string, unknown>>(
    em,
    `select id, plate_number, make, model, status from transport_vehicles
     where tenant_id = ? and organization_id = ? and deleted_at is null
     order by plate_number asc limit ${MAX_REFERENCE_ROWS}`,
    [scope.tenantId, scope.organizationId],
  )
  if (rows === null) return null
  return rows.map((row) => ({
    id: readString(row.id),
    plateNumber: readString(row.plate_number),
    make: readString(row.make),
    model: readString(row.model),
    status: readString(row.status),
  }))
}

export async function listTransportDrivers(
  em: EntityManager,
  scope: TransportScope,
): Promise<TransportDriverReference[] | null> {
  const rows = await tolerantRows<Record<string, unknown>>(
    em,
    `select id, full_name, phone, status, license_number, license_expiry from transport_drivers
     where tenant_id = ? and organization_id = ? and deleted_at is null
     order by full_name asc limit ${MAX_REFERENCE_ROWS}`,
    [scope.tenantId, scope.organizationId],
  )
  if (rows === null) return null
  return rows.map((row) => ({
    id: readString(row.id),
    fullName: readString(row.full_name),
    phone: readString(row.phone),
    status: readString(row.status),
    licenseNumber: readString(row.license_number),
    licenseExpiry: readDateString(row.license_expiry),
  }))
}

export async function listTransportRoutes(
  em: EntityManager,
  scope: TransportScope,
): Promise<TransportRouteReference[] | null> {
  const rows = await tolerantRows<Record<string, unknown>>(
    em,
    `select id, code, name, start_location, end_location from transport_routes
     where tenant_id = ? and organization_id = ? and deleted_at is null
     order by code asc limit ${MAX_REFERENCE_ROWS}`,
    [scope.tenantId, scope.organizationId],
  )
  if (rows === null) return null
  return rows.map((row) => ({
    id: readString(row.id),
    code: readString(row.code),
    name: readString(row.name),
    startLocation: readString(row.start_location),
    endLocation: readString(row.end_location),
  }))
}

export async function findTransportVehicle(
  em: EntityManager,
  scope: TransportScope,
  id: string,
): Promise<{ available: boolean; vehicle: TransportVehicleReference | null }> {
  const rows = await tolerantRows<Record<string, unknown>>(
    em,
    `select id, plate_number, make, model, status from transport_vehicles
     where tenant_id = ? and organization_id = ? and id = ? and deleted_at is null limit 1`,
    [scope.tenantId, scope.organizationId, id],
  )
  if (rows === null) return { available: false, vehicle: null }
  const row = rows[0]
  if (!row) return { available: true, vehicle: null }
  return {
    available: true,
    vehicle: {
      id: readString(row.id),
      plateNumber: readString(row.plate_number),
      make: readString(row.make),
      model: readString(row.model),
      status: readString(row.status),
    },
  }
}

export async function findTransportDriver(
  em: EntityManager,
  scope: TransportScope,
  id: string,
): Promise<{ available: boolean; driver: TransportDriverReference | null }> {
  const rows = await tolerantRows<Record<string, unknown>>(
    em,
    `select id, full_name, phone, status, license_number, license_expiry from transport_drivers
     where tenant_id = ? and organization_id = ? and id = ? and deleted_at is null limit 1`,
    [scope.tenantId, scope.organizationId, id],
  )
  if (rows === null) return { available: false, driver: null }
  const row = rows[0]
  if (!row) return { available: true, driver: null }
  return {
    available: true,
    driver: {
      id: readString(row.id),
      fullName: readString(row.full_name),
      phone: readString(row.phone),
      status: readString(row.status),
      licenseNumber: readString(row.license_number),
      licenseExpiry: readDateString(row.license_expiry),
    },
  }
}

/**
 * Overlapping trips on the fleet board (`transport_trip_schedules`), used as a
 * secondary occupancy check next to freight's own order board. Returns `false`
 * when the check could not run (transport absent), so the caller keeps only its
 * own overlapping check — degraded, never failing.
 */
export async function hasTransportScheduleOverlap(
  em: EntityManager,
  scope: TransportScope,
  input: { vehicleId: string; driverId: string; start: Date; end: Date },
): Promise<boolean> {
  const rows = await tolerantRows<{ id: string }>(
    em,
    `select id from transport_trip_schedules
     where tenant_id = ? and organization_id = ? and deleted_at is null
       and status in ('scheduled', 'in_progress')
       and (vehicle_id = ? or driver_id = ?)
       and scheduled_start_time < ? and scheduled_end_time > ?
     limit 1`,
    [scope.tenantId, scope.organizationId, input.vehicleId, input.driverId, input.end, input.start],
  )
  return Boolean(rows && rows.length > 0)
}
