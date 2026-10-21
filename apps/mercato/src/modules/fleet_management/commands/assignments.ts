import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { FleetVehicleAssignment, FleetVehicleOdometerLog } from '../data/entities'
import { createVehicleAssignmentSchema, returnVehicleAssignmentSchema } from '../data/validators'
import {
  assertAssignmentReturnable,
  assertVehicleAssignable,
  findFleetVehicle,
  updateFleetVehicleOdometer,
} from '../lib/fleetService'
import { raiseFleetError } from '../lib/errors'
import {
  FLEET_ASSIGNMENT_ENTITY_ID,
  FLEET_ODOMETER_LOG_ENTITY_ID,
  fleetAssignmentEvents,
  fleetAssignmentIndexer,
  fleetOdometerLogEvents,
  fleetOdometerLogIndexer,
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
  { assignmentId: string; vehicleId: string; assignedAt: Date; pendingApproval: boolean }
> = {
  id: 'fleet_management.assignments.handover',
  async execute(rawInput, ctx) {
    const input = createVehicleAssignmentSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const created = await em.transactional(async (transactionEm) => {
      const vehicle = await findFleetVehicle(transactionEm, scope, input.vehicleId, { forUpdate: true })
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
        status: 'pending_approval',
        assignedAt,
        dueReturnAt: optionalDate(input.dueReturnAt),
        handoverOdometer,
        custodyNotes: input.custodyNotes ?? null,
        createdBy: ctx.auth?.sub ?? null,
        createdAt: assignedAt,
        updatedAt: assignedAt,
        deletedAt: null,
      })
      await transactionEm.persist(assignment).flush()
      return { assignment, vehicle, handoverOdometer }
    })

    let approvalRequestId: string | null = null
    try {
      const commandBus = ctx.container.resolve('commandBus') as CommandBus
      const submitted = await commandBus.execute<Record<string, unknown>, {
        submitted: boolean
        approvalRequestId?: string
      }>('hr_management.approvals.submit_for_entity', {
        input: {
          entityType: 'fleet_vehicle_assignment',
          entityId: created.assignment.id,
          summary: `Vehicle custody ${created.vehicle.plateNumber}`,
          payload: {
            assignmentId: created.assignment.id,
            vehicleId: created.vehicle.id,
            employeeId: created.assignment.employeeId,
          },
        },
        ctx,
      })
      if (submitted.result.submitted) {
        approvalRequestId = submitted.result.approvalRequestId ?? null
      }
    } catch (error) {
      if (error instanceof CrudHttpError) throw error
      approvalRequestId = null
    }

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    let activatedAt: Date | null = null
    let odometerLog: FleetVehicleOdometerLog | null = null
    if (approvalRequestId) {
      created.assignment.approvalRequestId = approvalRequestId
      created.assignment.updatedAt = new Date()
      await em.flush()
    } else {
      const activated = await em.transactional(async (transactionEm) => {
        const vehicle = await findFleetVehicle(transactionEm, scope, created.vehicle.id, { forUpdate: true })
        const assignment = await transactionEm.findOne(FleetVehicleAssignment, {
          id: created.assignment.id,
          ...scope,
          deletedAt: null,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (!vehicle || !assignment) return raiseFleetError(404, 'assignment_not_found', 'Assignment not found.')
        const now = new Date()
        assignment.status = 'active'
        assignment.assignedAt = now
        assignment.updatedAt = now
        const log = transactionEm.create(FleetVehicleOdometerLog, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          vehicleId: vehicle.id,
          reading: assignment.handoverOdometer ?? vehicle.currentOdometer,
          recordedAt: now,
          source: 'assignment_handover',
          assignmentId: assignment.id,
          notes: assignment.custodyNotes ?? null,
          createdBy: ctx.auth?.sub ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        await updateFleetVehicleOdometer(
          transactionEm,
          scope,
          vehicle.id,
          assignment.handoverOdometer ?? vehicle.currentOdometer,
          now,
        )
        await transactionEm.persist([assignment, log]).flush()
        return { assignment, log, now }
      })
      activatedAt = activated.now
      odometerLog = activated.log
      created.assignment.status = activated.assignment.status
      created.assignment.assignedAt = activated.assignment.assignedAt
    }

    await emitCrudSideEffects({
      dataEngine, action: 'created', entity: created.assignment,
      identifiers: { id: created.assignment.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: fleetAssignmentEvents, indexer: fleetAssignmentIndexer,
    })
    if (odometerLog) {
      await emitCrudSideEffects({
        dataEngine, action: 'created', entity: odometerLog,
        identifiers: { id: odometerLog.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
        events: fleetOdometerLogEvents, indexer: fleetOdometerLogIndexer,
      })
    }
    return {
      assignmentId: created.assignment.id,
      vehicleId: created.vehicle.id,
      assignedAt: activatedAt ?? created.assignment.createdAt,
      pendingApproval: Boolean(approvalRequestId),
    }
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

      const vehicle = await findFleetVehicle(transactionEm, scope, assignment.vehicleId, { forUpdate: true })
      if (!vehicle) return raiseFleetError(404, 'vehicle_not_found', 'Vehicle not found.')

      const returnedAt = optionalDate(input.returnedAt) ?? new Date()
      assignment.status = 'returned'
      assignment.returnedAt = returnedAt
      assignment.returnOdometer = input.returnOdometer
      if (input.custodyNotes) assignment.custodyNotes = input.custodyNotes
      assignment.updatedAt = returnedAt

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

      await updateFleetVehicleOdometer(transactionEm, scope, vehicle.id, input.returnOdometer, returnedAt)
      await transactionEm.persist([assignment, odometerLog]).flush()
      return { assignment, vehicle, odometerLog, returnedAt }
    })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine, action: 'updated', entity: result.assignment,
      identifiers: { id: result.assignment.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: fleetAssignmentEvents, indexer: fleetAssignmentIndexer,
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
