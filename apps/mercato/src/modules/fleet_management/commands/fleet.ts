import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  registerCommand,
  type CommandBus,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
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

function readResourceId(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const value = (input as { id?: unknown }).id
  return typeof value === 'string' ? value : ''
}

export const FLEET_VEHICLE_ENTITY_ID = 'fleet_management:fleet_vehicle' as const
export const FLEET_VEHICLE_RESOURCE_KIND = 'transport_operations:transport_vehicle' as const
export const FLEET_VEHICLE_DOCUMENT_ENTITY_ID = 'fleet_management:fleet_vehicle_document' as const
export const FLEET_ASSIGNMENT_ENTITY_ID = 'fleet_management:fleet_vehicle_assignment' as const
export const FLEET_ODOMETER_LOG_ENTITY_ID = 'fleet_management:fleet_vehicle_odometer_log' as const

export const fleetVehicleDocumentEvents = makeEvents<FleetVehicleDocument>('vehicle_document')
export const fleetVehicleDocumentIndexer = makeIndexer<FleetVehicleDocument>(FLEET_VEHICLE_DOCUMENT_ENTITY_ID)
export const fleetAssignmentEvents = makeEvents<FleetVehicleAssignment>('assignment')
export const fleetAssignmentIndexer = makeIndexer<FleetVehicleAssignment>(FLEET_ASSIGNMENT_ENTITY_ID)
export const fleetOdometerLogEvents = makeEvents<FleetVehicleOdometerLog>('odometer_log')
export const fleetOdometerLogIndexer = makeIndexer<FleetVehicleOdometerLog>(FLEET_ODOMETER_LOG_ENTITY_ID)

/**
 * Fleet vehicle writes are transport-vehicle writes.
 *
 * `fleet_vehicles` is gone: `transport_vehicles` is the single register (decision
 * record 2026-10-19). The fleet screens keep their endpoints, but every write
 * goes through the transport commands so validation, events, indexing and audit
 * stay in the owning module. `status: 'assigned'` is a fleet-derived state and is
 * stored as the underlying `active` transport status; custody itself lives in the
 * assignment rows.
 */
function toTransportVehicleInput(
  input: Record<string, unknown>,
  mode: 'create' | 'update',
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {}
  for (const key of ['plateNumber', 'sequenceNumber', 'make', 'model', 'year', 'color', 'vehicleType', 'currentOdometer', 'notes']) {
    if (input[key] !== undefined) mapped[key] = input[key]
  }
  if (input.status !== undefined) mapped.status = input.status === 'assigned' ? 'active' : input.status
  if (mode === 'create') {
    mapped.vin = null
    mapped.capacity = 0
  }
  if (mode === 'update' && typeof input.id === 'string') mapped.id = input.id
  return mapped
}

async function executeTransportCommand(
  ctx: CommandRuntimeContext,
  commandId: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const { result } = await commandBus.execute(commandId, { input, ctx })
  return result
}

registerCommand({
  id: 'fleet_management.vehicles.create',
  async execute(raw, ctx) {
    const input = createVehicleSchema.parse(raw)
    const result = await executeTransportCommand(
      ctx,
      'transport_operations.vehicles.create',
      toTransportVehicleInput(input, 'create'),
    )
    const entity = result as { id?: string; updatedAt?: Date } | null
    return { id: entity?.id ?? null, updatedAt: entity?.updatedAt ?? null }
  },
  buildLog: ({ result, ctx }) => {
    const scope = scopeFrom(ctx)
    return {
      actionLabel: 'Create fleet vehicle',
      resourceKind: FLEET_VEHICLE_RESOURCE_KIND,
      resourceId: String((result as { id?: string } | null)?.id ?? ''),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
})

registerCommand({
  id: 'fleet_management.vehicles.update',
  async execute(raw, ctx) {
    const input = updateVehicleSchema.parse(raw)
    await executeTransportCommand(
      ctx,
      'transport_operations.vehicles.update',
      toTransportVehicleInput(input, 'update'),
    )
    return { ok: true }
  },
  buildLog: ({ input, ctx }) => {
    const scope = scopeFrom(ctx)
    return {
      actionLabel: 'Update fleet vehicle',
      resourceKind: FLEET_VEHICLE_RESOURCE_KIND,
      resourceId: readResourceId(input),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
})

registerCommand({
  id: 'fleet_management.vehicles.delete',
  async execute(raw, ctx) {
    const input = z.object({ id: z.string().uuid() }).parse(raw)
    await executeTransportCommand(ctx, 'transport_operations.vehicles.delete', { id: input.id })
    return { id: input.id }
  },
  buildLog: ({ input, ctx }) => {
    const scope = scopeFrom(ctx)
    return {
      actionLabel: 'Delete fleet vehicle',
      resourceKind: FLEET_VEHICLE_RESOURCE_KIND,
      resourceId: readResourceId(input),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
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