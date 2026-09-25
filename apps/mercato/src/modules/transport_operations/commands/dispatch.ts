import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { z } from 'zod'
import { TransportDriver, TransportTripSchedule } from '../data/entities'
import { assertTripAssignmentAvailable } from '../lib/transportService'
import { raiseTransportError } from '../lib/errors'
import {
  TRANSPORT_TRIP_ENTITY_ID,
  transportDriverEvents,
  transportDriverIndexer,
  transportTripEvents,
  transportTripIndexer,
} from './transport'

export const dispatchTripSchema = z.object({ id: z.string().uuid() })
export type DispatchTripInput = z.infer<typeof dispatchTripSchema>

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw new CrudHttpError(400, { error: 'Tenant and organization context are required.' })
  return { tenantId, organizationId }
}

const dispatchTripCommand: CommandHandler<DispatchTripInput, { tripId: string; startedAt: Date }> = {
  id: 'transport_operations.trips.dispatch',
  async execute(rawInput, ctx) {
    const input = dispatchTripSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (transactionEm) => {
      const trip = await transactionEm.findOne(TransportTripSchedule, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!trip) return raiseTransportError(404, 'trip_not_found', 'Trip schedule not found.')
      if (trip.status !== 'scheduled') return raiseTransportError(409, 'trip_not_scheduled', 'Only scheduled trips can be dispatched.')

      const driver = await transactionEm.findOne(TransportDriver, {
        id: trip.driverId,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!driver || driver.status !== 'available') {
        return raiseTransportError(409, 'assigned_driver_unavailable', 'The assigned driver is unavailable.')
      }
      await assertTripAssignmentAvailable(transactionEm, {
        id: trip.id,
        routeId: trip.routeId,
        vehicleId: trip.vehicleId,
        driverId: trip.driverId,
        scheduledStartTime: trip.scheduledStartTime,
        scheduledEndTime: trip.scheduledEndTime,
      }, scope)

      const startedAt = new Date()
      trip.status = 'in_progress'
      trip.actualStartTime = startedAt
      trip.updatedAt = startedAt
      driver.status = 'on_trip'
      driver.updatedAt = startedAt
      await transactionEm.persist([trip, driver]).flush()
      return { trip, driver, startedAt }
    })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine, action: 'updated', entity: result.trip,
      identifiers: { id: result.trip.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: transportTripEvents, indexer: transportTripIndexer,
    })
    await emitCrudSideEffects({
      dataEngine, action: 'updated', entity: result.driver,
      identifiers: { id: result.driver.id, ...scope }, actorUserId: ctx.auth?.sub ?? null,
      events: transportDriverEvents, indexer: transportDriverIndexer,
    })
    return { tripId: result.trip.id, startedAt: result.startedAt }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Dispatch trip',
      resourceKind: TRANSPORT_TRIP_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(dispatchTripCommand)
