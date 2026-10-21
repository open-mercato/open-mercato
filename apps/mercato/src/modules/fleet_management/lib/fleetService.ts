import type { EntityManager } from '@mikro-orm/postgresql'
import { raiseFleetError } from './errors'
import { FleetVehicleAssignment, FleetVehicleDocument } from '../data/entities'

export type FleetScope = { tenantId: string; organizationId: string }

export type VehicleAssignmentInput = {
  id?: string
  vehicleId: string
  employeeId: string
  handoverOdometer?: number | null
}

export type ReturnVehicleInput = {
  id: string
  returnOdometer: number
}

export type FleetDashboardSummary = {
  activeVehicles: number
  assignedVehicles: number
  vehiclesInMaintenance: number
  expiringDocuments: number
  activeAssignments: number
  overdueAssignments: number
}

export type FleetVehicleReference = {
  id: string
  plateNumber: string
  status: string
  currentOdometer: number
}

export const FLEET_DOCUMENT_EXPIRY_WINDOW_DAYS = 30

function isMissingRelationError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('42P01') || /relation .* does not exist/i.test(message)
}

function readNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/**
 * The vehicle register lives in `transport_operations` (decision record
 * 2026-10-19). Fleet reads it by table name with tenant/org scope — no ORM
 * relation and no direct entity import — matching the tolerant pattern the
 * freight, rental and school-transport modules already use. A missing peer table
 * degrades to "vehicle not found" rather than a 500.
 */
export async function findFleetVehicle(
  em: EntityManager,
  scope: FleetScope,
  vehicleId: string,
  options: { forUpdate?: boolean } = {},
): Promise<FleetVehicleReference | null> {
  try {
    const rows = await em.getConnection().execute<Record<string, unknown>[]>(
      `select id, plate_number, status, current_odometer from transport_vehicles
       where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null
       ${options.forUpdate ? 'for update' : ''}`,
      [vehicleId, scope.tenantId, scope.organizationId],
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: readString(row.id),
      plateNumber: readString(row.plate_number),
      status: readString(row.status),
      currentOdometer: readNumber(row.current_odometer),
    }
  } catch (err) {
    if (isMissingRelationError(err)) return null
    throw err
  }
}

/**
 * Advances the register's odometer. The odometer log is the history; this column
 * is the current reading every screen and availability check reads.
 */
export async function updateFleetVehicleOdometer(
  em: EntityManager,
  scope: FleetScope,
  vehicleId: string,
  reading: number,
  at: Date,
): Promise<void> {
  try {
    await em.getConnection().execute(
      `update transport_vehicles
       set current_odometer = greatest(coalesce(current_odometer, 0), ?), updated_at = ?
       where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null`,
      [reading, at, vehicleId, scope.tenantId, scope.organizationId],
    )
  } catch (err) {
    if (isMissingRelationError(err)) return
    throw err
  }
}

export async function assertVehicleAssignable(
  em: EntityManager,
  input: VehicleAssignmentInput,
  scope: FleetScope,
): Promise<void> {
  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const vehicle = await findFleetVehicle(em, scope, input.vehicleId)
  if (!vehicle) return raiseFleetError(400, 'vehicle_unavailable', 'The selected vehicle is not available.')
  if (vehicle.status === 'maintenance' || vehicle.status === 'out_of_service') {
    return raiseFleetError(409, 'vehicle_unavailable', 'The selected vehicle is not available.')
  }
  if (typeof input.handoverOdometer === 'number' && input.handoverOdometer < vehicle.currentOdometer) {
    return raiseFleetError(409, 'odometer_below_current', 'The handover odometer cannot be lower than the vehicle current reading.')
  }

  const openAssignment = await em.findOne(FleetVehicleAssignment, {
    ...scoped,
    ...(input.id ? { id: { $ne: input.id } } : {}),
    vehicleId: input.vehicleId,
    status: { $in: ['pending_approval', 'active'] },
  })
  if (openAssignment) {
    return raiseFleetError(409, 'assignment_already_open', 'The vehicle already has an open custody assignment.')
  }
}

export async function assertAssignmentReturnable(
  em: EntityManager,
  input: ReturnVehicleInput,
  scope: FleetScope,
): Promise<FleetVehicleAssignment> {
  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const assignment = await em.findOne(FleetVehicleAssignment, { ...scoped, id: input.id })
  if (!assignment) return raiseFleetError(404, 'assignment_not_found', 'Assignment not found.')
  if (assignment.status === 'returned' || assignment.returnedAt) {
    return raiseFleetError(409, 'assignment_already_returned', 'This custody assignment was already returned.')
  }
  if (assignment.status === 'cancelled' || assignment.status === 'rejected') {
    return raiseFleetError(409, 'assignment_not_returnable', 'This custody assignment can no longer be returned.')
  }
  if (typeof assignment.handoverOdometer === 'number' && input.returnOdometer < assignment.handoverOdometer) {
    return raiseFleetError(409, 'odometer_below_handover', 'The return odometer cannot be lower than the handover reading.')
  }
  return assignment
}

async function countTransportVehicles(
  em: EntityManager,
  scope: FleetScope,
  predicate: string,
): Promise<number> {
  try {
    const rows = await em.getConnection().execute<Array<{ count: unknown }>>(
      `select count(*)::int as count from transport_vehicles tv
       where tv.tenant_id = ? and tv.organization_id = ? and tv.deleted_at is null and ${predicate}`,
      [scope.tenantId, scope.organizationId],
    )
    return readNumber(rows[0]?.count)
  } catch (err) {
    if (isMissingRelationError(err)) return 0
    throw err
  }
}

export async function getFleetDashboardSummary(
  em: EntityManager,
  scope: FleetScope,
): Promise<FleetDashboardSummary> {
  const base = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const expiryCutoff = new Date()
  expiryCutoff.setDate(expiryCutoff.getDate() + FLEET_DOCUMENT_EXPIRY_WINDOW_DAYS)
  const now = new Date()
  const [activeVehicles, vehiclesInMaintenance, expiringDocuments, activeAssignments, overdueAssignments, assignedRows] =
    await Promise.all([
      countTransportVehicles(
        em,
        scope,
        `tv.status = 'active' and not exists (
           select 1 from fleet_vehicle_assignments a
           where a.vehicle_id = tv.id and a.organization_id = tv.organization_id
             and a.tenant_id = tv.tenant_id and a.deleted_at is null
             and a.status in ('pending_approval', 'active')
         )`,
      ),
      countTransportVehicles(em, scope, `tv.status = 'maintenance'`),
      em.count(FleetVehicleDocument, { ...base, expiryDate: { $lte: expiryCutoff, $ne: null } }),
      em.count(FleetVehicleAssignment, { ...base, status: 'active' }),
      em.count(FleetVehicleAssignment, { ...base, status: 'active', dueReturnAt: { $lt: now, $ne: null } }),
      em.getConnection().execute<Array<{ count: unknown }>>(
        `select count(distinct vehicle_id)::int as count from fleet_vehicle_assignments
         where tenant_id = ? and organization_id = ? and deleted_at is null
           and status in ('pending_approval', 'active')`,
        [scope.tenantId, scope.organizationId],
      ),
    ])
  return {
    activeVehicles,
    assignedVehicles: readNumber(assignedRows[0]?.count),
    vehiclesInMaintenance,
    expiringDocuments,
    activeAssignments,
    overdueAssignments,
  }
}

export type FleetService = {
  assertVehicleAssignable(input: VehicleAssignmentInput, scope: FleetScope): Promise<void>
  assertAssignmentReturnable(input: ReturnVehicleInput, scope: FleetScope): Promise<FleetVehicleAssignment>
  getDashboardSummary(scope: FleetScope): Promise<FleetDashboardSummary>
}

export function createFleetService(em: EntityManager): FleetService {
  return {
    assertVehicleAssignable: (input, scope) => assertVehicleAssignable(em, input, scope),
    assertAssignmentReturnable: (input, scope) => assertAssignmentReturnable(em, input, scope),
    getDashboardSummary: (scope) => getFleetDashboardSummary(em, scope),
  }
}
