import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  FleetVehicle,
  FleetVehicleAssignment,
  FleetVehicleDocument,
  FleetVehicleOdometerLog,
} from '../data/entities'
import {
  createOdometerLogSchema,
  createVehicleAssignmentSchema,
  createVehicleDocumentSchema,
  createVehicleSchema,
  updateVehicleAssignmentSchema,
  updateVehicleDocumentSchema,
  updateVehicleSchema,
} from '../data/validators'
import { registerCrudCommands } from './crud'
import {
  assertFleetVehicleIdentityUnique,
  assertVehicleAssignable,
  type FleetScope,
} from '../lib/fleetService'

export function makeEvents<TEntity extends object>(entity: string): CrudEventsConfig<TEntity> {
  return {
    module: 'fleet_management',
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

function optionalDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined
  return toDate(value)
}

export function scopeFrom(ctx: CommandRuntimeContext): FleetScope {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) throw new Error('[internal] Fleet scope is unavailable')
  return { tenantId, organizationId }
}

export const patched = (input: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id'))

export const FLEET_VEHICLE_ENTITY_ID = 'fleet_management:fleet_vehicle' as const
export const FLEET_VEHICLE_DOCUMENT_ENTITY_ID = 'fleet_management:fleet_vehicle_document' as const
export const FLEET_ASSIGNMENT_ENTITY_ID = 'fleet_management:fleet_vehicle_assignment' as const
export const FLEET_ODOMETER_LOG_ENTITY_ID = 'fleet_management:fleet_vehicle_odometer_log' as const

export const fleetVehicleEvents = makeEvents<FleetVehicle>('vehicle')
export const fleetVehicleIndexer = makeIndexer<FleetVehicle>(FLEET_VEHICLE_ENTITY_ID)
export const fleetVehicleDocumentEvents = makeEvents<FleetVehicleDocument>('vehicle_document')
export const fleetVehicleDocumentIndexer = makeIndexer<FleetVehicleDocument>(FLEET_VEHICLE_DOCUMENT_ENTITY_ID)
export const fleetAssignmentEvents = makeEvents<FleetVehicleAssignment>('assignment')
export const fleetAssignmentIndexer = makeIndexer<FleetVehicleAssignment>(FLEET_ASSIGNMENT_ENTITY_ID)
export const fleetOdometerLogEvents = makeEvents<FleetVehicleOdometerLog>('odometer_log')
export const fleetOdometerLogIndexer = makeIndexer<FleetVehicleOdometerLog>(FLEET_ODOMETER_LOG_ENTITY_ID)

registerCrudCommands({
  entity: FleetVehicle,
  entityId: FLEET_VEHICLE_ENTITY_ID,
  resource: 'vehicles',
  createSchema: createVehicleSchema,
  updateSchema: updateVehicleSchema,
  toCreateData: (input) => input,
  toUpdateData: patched,
  beforeCreate: async (input, scope, ctx) => {
    await assertFleetVehicleIdentityUnique(ctx.container.resolve('em') as EntityManager, scope, {
      plateNumber: input.plateNumber,
      sequenceNumber: input.sequenceNumber,
    })
  },
  beforeUpdate: async (input, current, scope, ctx) => {
    await assertFleetVehicleIdentityUnique(ctx.container.resolve('em') as EntityManager, scope, {
      // Falling back to the stored value matters on a partial update: an edit
      // that only changes the model still has to be checked against the plate
      // and sequence the row keeps.
      plateNumber: input.plateNumber ?? current.plateNumber,
      sequenceNumber: input.sequenceNumber ?? current.sequenceNumber,
      excludeId: current.id,
    })
  },
  events: fleetVehicleEvents,
  indexer: fleetVehicleIndexer,
})

registerCrudCommands({
  entity: FleetVehicleDocument,
  entityId: FLEET_VEHICLE_DOCUMENT_ENTITY_ID,
  resource: 'vehicle_documents',
  createSchema: createVehicleDocumentSchema,
  updateSchema: updateVehicleDocumentSchema,
  toCreateData: (input) => ({
    ...input,
    ...(optionalDate(input.issueDate) ? { issueDate: optionalDate(input.issueDate) } : {}),
    ...(optionalDate(input.expiryDate) ? { expiryDate: optionalDate(input.expiryDate) } : {}),
  }),
  toUpdateData: (input) => {
    const { issueDate, expiryDate, ...patch } = patched(input)
    return {
      ...patch,
      ...(issueDate === undefined ? {} : { issueDate: optionalDate(issueDate) ?? null }),
      ...(expiryDate === undefined ? {} : { expiryDate: optionalDate(expiryDate) ?? null }),
    }
  },
  events: fleetVehicleDocumentEvents,
  indexer: fleetVehicleDocumentIndexer,
})

registerCrudCommands({
  entity: FleetVehicleAssignment,
  entityId: FLEET_ASSIGNMENT_ENTITY_ID,
  resource: 'assignments',
  createSchema: createVehicleAssignmentSchema,
  updateSchema: updateVehicleAssignmentSchema,
  toCreateData: (input) => ({
    ...input,
    status: 'pending_approval' as const,
    ...(optionalDate(input.dueReturnAt) ? { dueReturnAt: optionalDate(input.dueReturnAt) } : {}),
  }),
  toUpdateData: (input) => {
    const { assignedAt, dueReturnAt, returnedAt, ...patch } = patched(input)
    return {
      ...patch,
      ...(assignedAt === undefined ? {} : { assignedAt: optionalDate(assignedAt) ?? null }),
      ...(dueReturnAt === undefined ? {} : { dueReturnAt: optionalDate(dueReturnAt) ?? null }),
      ...(returnedAt === undefined ? {} : { returnedAt: optionalDate(returnedAt) ?? null }),
    }
  },
  events: fleetAssignmentEvents,
  indexer: fleetAssignmentIndexer,
  beforeCreate: async (input, scope, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await assertVehicleAssignable(em, {
      vehicleId: String(input.vehicleId),
      employeeId: String(input.employeeId),
      handoverOdometer: typeof input.handoverOdometer === 'number' ? input.handoverOdometer : null,
    }, scope)
  },
})

registerCrudCommands({
  entity: FleetVehicleOdometerLog,
  entityId: FLEET_ODOMETER_LOG_ENTITY_ID,
  resource: 'odometer_logs',
  createSchema: createOdometerLogSchema,
  updateSchema: createOdometerLogSchema.partial().extend({ id: z.string().uuid() }),
  toCreateData: (input) => ({
    ...input,
    ...(optionalDate(input.recordedAt) ? { recordedAt: optionalDate(input.recordedAt) } : {}),
  }),
  toUpdateData: (input) => {
    const { recordedAt, ...patch } = patched(input)
    return recordedAt === undefined ? patch : { ...patch, recordedAt: optionalDate(recordedAt) ?? null }
  },
  events: fleetOdometerLogEvents,
  indexer: fleetOdometerLogIndexer,
})