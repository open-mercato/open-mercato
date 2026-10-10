import type { EntityManager } from '@mikro-orm/postgresql'
import { raiseFleetError } from './errors'
import { FleetVehicle, FleetVehicleAssignment, FleetVehicleDocument } from '../data/entities'

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

export const FLEET_DOCUMENT_EXPIRY_WINDOW_DAYS = 30

export async function assertVehicleAssignable(
  em: EntityManager,
  input: VehicleAssignmentInput,
  scope: FleetScope,
): Promise<void> {
  const scoped = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const vehicle = await em.findOne(FleetVehicle, { ...scoped, id: input.vehicleId })
  if (!vehicle) return raiseFleetError(400, 'vehicle_unavailable', 'The selected vehicle is not available.')
  if (vehicle.status === 'maintenance' || vehicle.status === 'out_of_service') {
    return raiseFleetError(409, 'vehicle_unavailable', 'The selected vehicle is not available.')
  }
  if (vehicle.assignedEmployeeId && vehicle.assignedEmployeeId !== input.employeeId) {
    return raiseFleetError(409, 'vehicle_in_custody', 'The selected vehicle is already in another employee custody.')
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

export async function getFleetDashboardSummary(
  em: EntityManager,
  scope: FleetScope,
): Promise<FleetDashboardSummary> {
  const base = { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }
  const expiryCutoff = new Date()
  expiryCutoff.setDate(expiryCutoff.getDate() + FLEET_DOCUMENT_EXPIRY_WINDOW_DAYS)
  const now = new Date()
  const [activeVehicles, assignedVehicles, vehiclesInMaintenance, expiringDocuments, activeAssignments, overdueAssignments] =
    await Promise.all([
      em.count(FleetVehicle, { ...base, status: 'active' }),
      em.count(FleetVehicle, { ...base, status: 'assigned' }),
      em.count(FleetVehicle, { ...base, status: 'maintenance' }),
      em.count(FleetVehicleDocument, { ...base, expiryDate: { $lte: expiryCutoff, $ne: null } }),
      em.count(FleetVehicleAssignment, { ...base, status: 'active' }),
      em.count(FleetVehicleAssignment, { ...base, status: 'active', dueReturnAt: { $lt: now, $ne: null } }),
    ])
  return {
    activeVehicles,
    assignedVehicles,
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
/**
 * Uniqueness of a fleet vehicle's identity fields — the plate and the sequence
 * number the fleet numbers its vehicles by.
 *
 * These are the two values an operator reads a vehicle by, and a duplicate makes
 * both ambiguous: two rows answer to "A B C 1234", and a maintenance log, an
 * assignment or an Istimara renewal can land on the wrong one. The database
 * carries unique indexes on both (see the entity's `@Index` expressions) as the
 * guarantee; checking here produces a 409 that names the field instead of a 500
 * from the constraint.
 *
 * `sequenceNumber` is nullable — a fleet that does not number its vehicles is not
 * made to. An empty string is treated as absent so a form that clears the field
 * does not create a second "no sequence" row that then clashes.
 */
export async function assertFleetVehicleIdentityUnique(
  em: EntityManager,
  scope: FleetScope,
  input: { plateNumber?: unknown; sequenceNumber?: unknown; excludeId?: string | null },
): Promise<void> {
  const plateNumber = typeof input.plateNumber === 'string' ? input.plateNumber.trim() : ''
  const rawSequence = typeof input.sequenceNumber === 'string' ? input.sequenceNumber.trim() : ''
  const sequenceNumber = rawSequence.length > 0 ? rawSequence : null
  const exclude = input.excludeId ? { id: { $ne: input.excludeId } } : {}

  if (plateNumber) {
    const clash = await em.findOne(FleetVehicle, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      plateNumber,
      deletedAt: null,
      ...exclude,
    })
    if (clash) await raiseFleetError(409, 'vehicle_plate_taken', 'Another vehicle already uses this plate number.')
  }

  if (sequenceNumber) {
    const clash = await em.findOne(FleetVehicle, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      sequenceNumber,
      deletedAt: null,
      ...exclude,
    })
    if (clash) await raiseFleetError(409, 'vehicle_sequence_taken', 'Another vehicle already uses this sequence number.')
  }
}
