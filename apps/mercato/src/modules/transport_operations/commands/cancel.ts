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

export const cancelTripSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(2000).optional(),
})
export type CancelTripInput = z.infer<typeof cancelTripSchema>

function resolveScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw new CrudHttpError(400, { error: 'Tenant and organization context are required.' })
  return { tenantId, organizationId }
}

const cancelTripCommand: CommandHandler<CancelTripInput, { tripId: string; cancelledAt: Date }> = {
  id: 'transport_operations.trips.cancel',
  async execute(rawInput, ctx) {
    const input = cancelTripSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const result = await em.transactional(async (transactionEm) => {
      const trip = await transactionEm.findOne(TransportTripSchedule, {
        id: input.id,
        ...scope,
        deletedAt: null,
      }, { lockMode: LockMode.PESSIMISTIC_WRITE })
      if (!trip) return raiseTransportError(404, 'trip_not_found', 'Trip schedule not found.')
      if (trip.status !== 'scheduled' && trip.status !== 'in_progress') {
        return raiseTransportError(409, 'trip_not_cancellable', 'Only scheduled or in-progress trips can be cancelled.')
      }
      const cancelledAt = new Date()
      let driver: TransportDriver | null = null
      if (trip.status === 'in_progress') {
        driver = await transactionEm.findOne(TransportDriver, {
          id: trip.driverId,
          ...scope,
          deletedAt: null,
        }, { lockMode: LockMode.PESSIMISTIC_WRITE })
        if (driver?.status === 'on_trip') {
          driver.status = 'available'
          driver.updatedAt = cancelledAt
          await transactionEm.persist(driver)
        }
        trip.actualEndTime = cancelledAt
      }
      trip.status = 'cancelled'
      trip.cancellationReason = input.reason ?? null
      trip.updatedAt = cancelledAt
      await transactionEm.persist(trip).flush()
      return { trip, driver, cancelledAt }
    })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: result.trip,
      identifiers: { id: result.trip.id, ...scope },
      actorUserId: ctx.auth?.sub ?? null,
      events: transportTripEvents,
      indexer: transportTripIndexer,
    })
    if (result.driver) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: result.driver,
        identifiers: { id: result.driver.id, ...scope },
        actorUserId: ctx.auth?.sub ?? null,
        events: transportDriverEvents,
        indexer: transportDriverIndexer,
      })
    }
    return { tripId: result.trip.id, cancelledAt: result.cancelledAt }
  },
  buildLog: ({ input, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Cancel trip',
      resourceKind: TRANSPORT_TRIP_ENTITY_ID,
      resourceId: input.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(cancelTripCommand)

export { cancelTripCommand }
