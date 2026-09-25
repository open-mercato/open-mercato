import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { z } from 'zod'
import { TransportDriver, TransportTripSchedule } from '../data/entities'
import { raiseTransportError } from '../lib/errors'
import {
  TRANSPORT_TRIP_ENTITY_ID,
  transportDriverEvents,
  transportDriverIndexer,
  transportTripEvents,
  transportTripIndexer,
} from './transport'

export const completeTripSchema = z.object({ id: z.string().uuid() })
export type CompleteTripInput = z.infer<typeof completeTripSchema>

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw new CrudHttpError(400, { error: 'Tenant and organization context are required.' })
  return { tenantId, organizationId }
}

const completeTripCommand: CommandHandler<CompleteTripInput, { tripId: string; completedAt: Date }> = {
  id: 'transport_operations.trips.complete',
  async execute(rawInput, ctx) {
    const input = completeTripSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (transactionEm) => {
      const trip = await transactionEm.findOne(TransportTripSchedule, {
        id: input.id, ...scope, deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!trip) return raiseTransportError(404, 'trip_not_found', 'Trip schedule not found.')
      if (trip.status !== 'in_progress') return raiseTransportError(409, 'trip_not_in_progress', 'Only trips in progress can be completed.')

      const driver = await transactionEm.findOne(TransportDriver, {
        id: trip.driverId, ...scope, deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!driver || driver.status !== 'on_trip') return raiseTransportError(409, 'driver_not_on_trip', 'The assigned driver is not on this trip.')

      const completedAt = new Date()
      trip.status = 'completed'
      trip.actualEndTime = completedAt
      trip.updatedAt = completedAt
      driver.status = 'available'
      driver.updatedAt = completedAt
      await transactionEm.persist([trip, driver]).flush()
      return { trip, driver, completedAt }
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
    return { tripId: result.trip.id, completedAt: result.completedAt }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Complete trip',
      resourceKind: TRANSPORT_TRIP_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(completeTripCommand)
