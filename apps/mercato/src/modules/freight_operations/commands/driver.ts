import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { FreightDriverAlert, FreightDriverRating, FreightDriverRestBreak, FreightOrder } from '../data/entities'
import {
  driverRatingSchema,
  driverRestEndSchema,
  driverRestStartSchema,
  driverSosSchema,
  type DriverRestEndInput,
  type DriverRestStartInput,
  type DriverSosInput,
} from '../data/validators'
import { z } from 'zod'
import { resolveScope } from './crud'
import { raiseFreightError } from '../lib/errors'
import { emitFreightEvent } from '../events'

function entityManager(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

const REST_BREAK_RESOURCE = 'freight_operations:freight_driver_rest_break'
const DRIVER_ALERT_RESOURCE = 'freight_operations:freight_driver_alert'

const driverRestStartCommand: CommandHandler<DriverRestStartInput, { breakId: string }> = {
  id: 'freight_operations.driver.rest_start',
  async execute(rawInput, ctx) {
    const input = driverRestStartSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const existing = await em.findOne(FreightDriverRestBreak, {
      driverId: input.driverId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      endedAt: null,
      deletedAt: null,
    })
    if (existing) return raiseFreightError(409, 'rest_break_open', 'A rest break is already open.')
    const breakRecord = em.create(FreightDriverRestBreak, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      driverId: input.driverId,
      tripId: input.tripId ?? null,
      startedAt: new Date(),
    })
    await em.persist(breakRecord).flush()
    await emitFreightEvent('freight_operations.driver.rest_started', {
      id: breakRecord.id,
      driverId: input.driverId,
      tripId: breakRecord.tripId ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      startedAt: breakRecord.startedAt.toISOString(),
    })
    return { breakId: breakRecord.id }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Start driver rest break',
      resourceKind: REST_BREAK_RESOURCE,
      resourceId: result.breakId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const driverRestEndCommand: CommandHandler<DriverRestEndInput, { breakId: string }> = {
  id: 'freight_operations.driver.rest_end',
  async execute(rawInput, ctx) {
    const input = driverRestEndSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const breakRecord = await em.findOne(FreightDriverRestBreak, {
      id: input.breakId,
      driverId: input.driverId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!breakRecord) return raiseFreightError(404, 'rest_break_not_found', 'Rest break not found.')
    if (breakRecord.endedAt) return raiseFreightError(409, 'rest_break_closed', 'The rest break is already closed.')
    breakRecord.endedAt = new Date()
    breakRecord.updatedAt = breakRecord.endedAt
    await em.persist(breakRecord).flush()
    await emitFreightEvent('freight_operations.driver.rest_ended', {
      id: breakRecord.id,
      driverId: input.driverId,
      tripId: breakRecord.tripId ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      endedAt: breakRecord.endedAt.toISOString(),
    })
    return { breakId: breakRecord.id }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'End driver rest break',
      resourceKind: REST_BREAK_RESOURCE,
      resourceId: result.breakId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const driverSosCommand: CommandHandler<DriverSosInput, { alertId: string }> = {
  id: 'freight_operations.driver.sos',
  async execute(rawInput, ctx) {
    const input = driverSosSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const alert = em.create(FreightDriverAlert, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      driverId: input.driverId,
      tripId: input.tripId ?? null,
      orderId: input.orderId ?? null,
      kind: 'sos',
      latitude: input.latitude === undefined || input.latitude === null ? null : String(input.latitude),
      longitude: input.longitude === undefined || input.longitude === null ? null : String(input.longitude),
      note: input.note ?? null,
      createdBy: ctx.auth?.sub ?? null,
    })
    await em.persist(alert).flush()
    await emitFreightEvent('freight_operations.driver.sos', {
      id: alert.id,
      driverId: input.driverId,
      tripId: alert.tripId ?? null,
      orderId: alert.orderId ?? null,
      latitude: alert.latitude ?? null,
      longitude: alert.longitude ?? null,
      note: alert.note ?? null,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { alertId: alert.id }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Raise driver SOS',
      resourceKind: DRIVER_ALERT_RESOURCE,
      resourceId: result.alertId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

const driverRateSchema = driverRatingSchema.extend({
  customerId: z.string().uuid(),
})

type DriverRateInput = z.infer<typeof driverRateSchema>

const driverRateCommand: CommandHandler<DriverRateInput, { ratingId: string; rating: number }> = {
  id: 'freight_operations.driver.rate',
  async execute(rawInput, ctx) {
    const input = driverRateSchema.parse(rawInput)
    const scope = resolveScope(ctx)
    const em = entityManager(ctx)
    const order = await em.findOne(FreightOrder, {
      id: input.orderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!order) return raiseFreightError(404, 'order_not_found', 'Freight order not found.')
    if (order.customerId !== input.customerId) {
      return raiseFreightError(403, 'order_not_owned', 'This order does not belong to the customer.')
    }
    if (!order.driverId) {
      return raiseFreightError(409, 'order_has_no_driver', 'The order has no driver to rate.')
    }
    if (!['delivered', 'completed', 'invoiced'].includes(order.status)) {
      return raiseFreightError(409, 'order_not_delivered', 'The driver can be rated after delivery.')
    }
    const existing = await em.findOne(FreightDriverRating, {
      orderId: order.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (existing) {
      existing.rating = input.rating
      existing.comment = input.comment ?? null
      existing.updatedAt = new Date()
      await em.persist(existing).flush()
      await emitFreightEvent('freight_operations.driver.rated', {
        id: existing.id,
        orderId: order.id,
        driverId: existing.driverId,
        rating: existing.rating,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      return { ratingId: existing.id, rating: existing.rating }
    }
    const rating = em.create(FreightDriverRating, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      orderId: order.id,
      driverId: order.driverId,
      customerId: input.customerId,
      rating: input.rating,
      comment: input.comment ?? null,
      createdBy: ctx.auth?.sub ?? null,
    })
    await em.persist(rating).flush()
    await emitFreightEvent('freight_operations.driver.rated', {
      id: rating.id,
      orderId: order.id,
      driverId: rating.driverId,
      rating: rating.rating,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    return { ratingId: rating.id, rating: rating.rating }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx)
    return {
      actionLabel: 'Rate driver',
      resourceKind: 'freight_operations:freight_driver_rating',
      resourceId: result.ratingId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
  },
}

registerCommand(driverRateCommand)
registerCommand(driverRestStartCommand)
registerCommand(driverRestEndCommand)
registerCommand(driverSosCommand)
