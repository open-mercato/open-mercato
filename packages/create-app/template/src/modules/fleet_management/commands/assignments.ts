import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { FleetVehicle, FleetVehicleAssignment, FleetVehicleOdometerLog } from '../data/entities'
import { createVehicleAssignmentSchema, returnVehicleAssignmentSchema } from '../data/validators'
import { assertAssignmentReturnable, assertVehicleAssignable } from '../lib/fleetService'
import { raiseFleetError } from '../lib/errors'
import {
  FLEET_ASSIGNMENT_ENTITY_ID,
  FLEET_ODOMETER_LOG_ENTITY_ID,
  FLEET_VEHICLE_ENTITY_ID,
  fleetAssignmentEvents,
  fleetAssignmentIndexer,
  fleetOdometerLogEvents,
  fleetOdometerLogIndexer,
  fleetVehicleEvents,
  fleetVehicleIndexer,
} from './fleet'

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw new CrudHttpError(400, { error: '[internal] Tenant and organization context are required.' })
  return { tenantId, organizationId }
}

function optionalDate(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const handoverVehicleCommand: CommandHandler<
  Record<string, unknown>,
  { assignmentId: string; vehicleId: string; assignedAt: Date }
> = {
  id: 'fleet_management.assignments.handover',
  async execute(rawInput, ctx) {
    const input = createVehicleAssignmentSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (transactionEm) => {
      const vehicle = await transactionEm.findOne(FleetVehicle, {
        id: input.vehicleId,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!vehicle) return raiseFleetError(404, 'vehicle_not_found', 'Vehicle not found.')
      await assertVehicleAssignable(transactionEm, {
        vehicleId: input.vehicleId,
        employeeId: input.employeeId,
        handoverOdometer: input.handoverOdometer ?? null,
      }, scope)

      const assignedAt = new Date()
      const handoverOdometer = input.handoverOdometer ?? vehicle.currentOdometer
      const assignment = transactionEm.create(FleetVehicleAssignment, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        vehicleId: input.vehicleId,
        employeeId: input.employeeId,
        status: 'active',
        assignedAt,
        dueReturnAt: optionalDate(input.dueReturnAt),
        handoverOdometer,
        custodyNotes: input.custodyNotes ?? null,
        createdBy: ctx.auth?.sub ?? null,
        createdAt: assignedAt,
        updatedAt: assignedAt,
        deletedAt: null,
      })

      vehicle.status = 'assigned'
      vehicle.assignedEmployeeId = input.employeeId
      vehicle.currentOdometer = handoverOdometer
      vehicle.updatedAt = assignedAt

      // Flush before writing the log: a freshly created entity has no primary key until the flush
      // assigns one, so reading `assignment.id` first would store a NULL link. The return path never
      // hits this because it loads the assignment it is closing.
      await transactionEm.persist([assignment, vehicle]).flush()

      // The handover reading is logged too, not only the return. A custody change is the one moment
      // the mileage is agreed by two parties, and a vehicle held long-term would otherwise have no
      // reading in its history until it came back — which is exactly the stretch a maintenance
      // interval has to cover. The reading is already stored on the assignment; this keeps the
      // vehicle's own history consistent with the return path instead of trusting one of the two.
      const odometerLog = transactionEm.create(FleetVehicleOdometerLog, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        vehicleId: vehicle.id,
        reading: handoverOdometer,
        recordedAt: assignedAt,
        source: 'assignment_handover',
        assignmentId: assignment.id,
        notes: input.custodyNotes ?? null,
        createdBy: ctx.auth?.sub ?? null,
        createdAt: assignedAt,
        updatedAt: assignedAt,
        deletedAt: null,
      })

      await transactionEm.persist(odometerLog).flush()
      return { assignment, vehicle, odometerLog, assignedAt }
    })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine, action: 'created', entity: result.assignment,
      identifiers: { id: result.assignment.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: fleetAssignmentEvents, indexer: fleetAssignmentIndexer,
    })
    await emitCrudSideEffects({
      dataEngine, action: 'updated', entity: result.vehicle,
      identifiers: { id: result.vehicle.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: fleetVehicleEvents, indexer: fleetVehicleIndexer,
    })
    await emitCrudSideEffects({
      dataEngine, action: 'created', entity: result.odometerLog,
      identifiers: { id: result.odometerLog.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: fleetOdometerLogEvents, indexer: fleetOdometerLogIndexer,
    })
    return { assignmentId: result.assignment.id, vehicleId: result.vehicle.id, assignedAt: result.assignedAt }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Hand over vehicle custody',
      resourceKind: FLEET_ASSIGNMENT_ENTITY_ID,
      resourceId: result.assignmentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const returnVehicleCommand: CommandHandler<
  Record<string, unknown>,
  { assignmentId: string; vehicleId: string; returnedAt: Date; returnOdometer: number }
> = {
  id: 'fleet_management.assignments.return',
  async execute(rawInput, ctx) {
    const input = returnVehicleAssignmentSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (transactionEm) => {
      await assertAssignmentReturnable(transactionEm, { id: input.id, returnOdometer: input.returnOdometer }, scope)
      const assignment = await transactionEm.findOne(FleetVehicleAssignment, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!assignment) return raiseFleetError(404, 'assignment_not_found', 'Assignment not found.')

      const vehicle = await transactionEm.findOne(FleetVehicle, {
        id: assignment.vehicleId,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!vehicle) return raiseFleetError(404, 'vehicle_not_found', 'Vehicle not found.')

      const returnedAt = optionalDate(input.returnedAt) ?? new Date()
      assignment.status = 'returned'
      assignment.returnedAt = returnedAt
      assignment.returnOdometer = input.returnOdometer
      if (input.custodyNotes) assignment.custodyNotes = input.custodyNotes
      assignment.updatedAt = returnedAt

      vehicle.status = vehicle.status === 'maintenance' ? 'maintenance' : 'active'
      vehicle.assignedEmployeeId = null
      vehicle.currentOdometer = input.returnOdometer
      vehicle.updatedAt = returnedAt

      const odometerLog = transactionEm.create(FleetVehicleOdometerLog, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        vehicleId: vehicle.id,
        reading: input.returnOdometer,
        recordedAt: returnedAt,
        source: 'assignment_return',
        assignmentId: assignment.id,
        notes: input.custodyNotes ?? null,
        createdBy: ctx.auth?.sub ?? null,
        createdAt: returnedAt,
        updatedAt: returnedAt,
        deletedAt: null,
      })

      await transactionEm.persist([assignment, vehicle, odometerLog]).flush()
      return { assignment, vehicle, odometerLog, returnedAt }
    })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine, action: 'updated', entity: result.assignment,
      identifiers: { id: result.assignment.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: fleetAssignmentEvents, indexer: fleetAssignmentIndexer,
    })
    await emitCrudSideEffects({
      dataEngine, action: 'updated', entity: result.vehicle,
      identifiers: { id: result.vehicle.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: fleetVehicleEvents, indexer: fleetVehicleIndexer,
    })
    await emitCrudSideEffects({
      dataEngine, action: 'created', entity: result.odometerLog,
      identifiers: { id: result.odometerLog.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: fleetOdometerLogEvents, indexer: fleetOdometerLogIndexer,
    })
    return {
      assignmentId: result.assignment.id,
      vehicleId: result.vehicle.id,
      returnedAt: result.returnedAt,
      returnOdometer: input.returnOdometer,
    }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Return vehicle custody',
      resourceKind: FLEET_ASSIGNMENT_ENTITY_ID,
      resourceId: result.assignmentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(handoverVehicleCommand)
registerCommand(returnVehicleCommand)
