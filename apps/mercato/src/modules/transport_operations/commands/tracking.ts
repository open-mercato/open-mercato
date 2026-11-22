import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { TransportVehicle, TransportVehiclePosition } from '../data/entities'
import {
  recordVehiclePositionBatchSchema,
  type RecordVehiclePositionBatchInput,
} from '../data/validators'
import { raiseTransportError } from '../lib/errors'
import { emitTransportEvent } from '../events'

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: 'Tenant and organization context are required.' })
  }
  return { tenantId, organizationId }
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

const recordVehiclePositionsCommand: CommandHandler<
  RecordVehiclePositionBatchInput,
  { inserted: number; ids: string[] }
> = {
  id: 'transport_operations.positions.record',
  async execute(rawInput, ctx) {
    const input = recordVehiclePositionBatchSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const vehicleIds = Array.from(new Set(input.positions.map((position) => position.vehicleId)))
    const vehicles = await em.find(TransportVehicle, {
      id: { $in: vehicleIds },
      ...scope,
      deletedAt: null,
    })
    const known = new Set(vehicles.map((vehicle) => vehicle.id))
    const missing = vehicleIds.filter((id) => !known.has(id))
    if (missing.length) {
      return raiseTransportError(404, 'vehicle_not_found', 'One or more vehicles were not found.')
    }

    const entities = input.positions.map((position) =>
      em.create(TransportVehiclePosition, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        vehicleId: position.vehicleId,
        driverId: position.driverId ?? null,
        tripId: position.tripId ?? null,
        latitude: String(position.latitude),
        longitude: String(position.longitude),
        speedKph: position.speedKph === undefined || position.speedKph === null ? null : String(position.speedKph),
        heading: position.heading === undefined || position.heading === null ? null : String(position.heading),
        recordedAt: toDate(position.recordedAt),
        source: position.source ?? 'manual',
        raw: position.raw ?? null,
      }),
    )
    await em.persist(entities).flush()

    await emitTransportEvent('transport_operations.vehicle.position_recorded', {
      vehicleIds,
      count: entities.length,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { inserted: entities.length, ids: entities.map((entity) => entity.id) }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Record vehicle positions',
      resourceKind: 'transport_operations:transport_vehicle_position',
      resourceId: scope.organizationId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      metadata: { inserted: result.inserted },
    }
  },
}

registerCommand(recordVehiclePositionsCommand)
