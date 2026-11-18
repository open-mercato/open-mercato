import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Booking, SalesOperation } from '../data/entities'
import type { ClassifiedSalesError } from './salesErrors'
import { describeDuplicateOutcome, describeSalesError } from './salesErrorText'
import { moveOrderToCancelledStatus, type OperationRunContext, type OperationTargetHandler } from './salesOperationRunner'
import { emitBookingEvent, markBookingChanged } from './bookingEvents'
import { lockBookingWithUnit } from './bookingRecords'
import { notifyStaff, type StaffNotificationType } from './staffNotifications'
import type { StaffAudience } from './staffRecipients'
import type { Scope } from './productUse'
import { normalizeWallClock } from './wallClock'
import { recordOperation, TERMINAL_OPERATION_STATUSES } from './salesOperations'
import { loadSettings } from './settings'

const logger = createLogger('property_management')

async function loadBooking(tx: EntityManager, scope: Scope, id: string): Promise<Booking | null> {
  return findOneWithDecryption(tx, Booking, { id, ...scope }, { refresh: true }, scope)
}

function holdsOperation(booking: Booking | null, token: string): booking is Booking {
  return Boolean(booking && booking.status === 'pending' && booking.holdToken === token)
}

function scheduleNotification(
  ctx: OperationRunContext,
  booking: Booking,
  type: StaffNotificationType,
  error: ClassifiedSalesError | null,
  audience: StaffAudience = 'building',
): void {
  const reference = `${booking.productName} · ${normalizeWallClock(booking.startsAt).replace('T', ' ')}`
  ctx.postCommit.push(async () => {
    const bodyVariables = { reference, error: await describeSalesError(error) }
    await notifyStaff({
      container: ctx.container,
      em: ctx.tx.fork(),
      scope: ctx.scope,
      type,
      buildingId: booking.buildingId,
      audience,
      bookingId: booking.id,
      bodyVariables,
      groupKey: `${type}:${ctx.op.id}`,
    })
  })
}

function scheduleBookingChanged(ctx: OperationRunContext, booking: Booking): void {
  ctx.postCommit.push(() => markBookingChanged(ctx.container, booking))
}

async function isHoldValid(ctx: OperationRunContext): Promise<boolean> {
  if (ctx.op.kind !== 'booking_order') return true
  return holdsOperation(await loadBooking(ctx.tx, ctx.scope, ctx.op.targetId), ctx.op.token)
}

async function finish(ctx: OperationRunContext): Promise<'done' | 'invalid'> {
  const { op, tx, scope } = ctx
  if (op.kind !== 'booking_order') return 'done'
  const booking = await lockBookingWithUnit(tx, scope, op.targetId)
  if (!holdsOperation(booking, op.token)) return 'invalid'
  booking.status = 'confirmed'
  booking.salesOrderId = op.salesDocumentId ?? null
  booking.holdToken = null
  booking.updatedAt = new Date()
  scheduleBookingChanged(ctx, booking)
  return 'done'
}

const onDone = async (): Promise<void> => undefined

async function onRefused(ctx: OperationRunContext, error: ClassifiedSalesError): Promise<void> {
  const { op, tx, scope } = ctx
  if (op.kind !== 'booking_order') {
    logger.warn('A booking sales status change was refused', { operationId: op.id, code: error.code })
    if (op.kind !== 'order_status') return
    const booking = await loadBooking(tx, scope, op.targetId)
    if (booking) scheduleNotification(ctx, booking, 'property_management.booking.order_cancel_refused', error)
    return
  }
  const booking = await lockBookingWithUnit(tx, scope, op.targetId)
  if (!holdsOperation(booking, op.token)) return
  booking.status = 'cancelled'
  booking.cancelReason = 'order_refused'
  booking.holdToken = null
  booking.updatedAt = new Date()
  logger.warn('Sales refused a booking order; the booking was cancelled', { operationId: op.id, bookingId: booking.id, code: error.code })
  ctx.postCommit.push(() => emitBookingEvent('property_management.booking.cancelled', booking, { error: error.code }))
  scheduleBookingChanged(ctx, booking)
  scheduleNotification(ctx, booking, 'property_management.booking.order_refused', error)
}

async function onCompensated(ctx: OperationRunContext): Promise<void> {
  const { op, tx, scope } = ctx
  if (op.kind !== 'booking_order' || !op.salesDocumentId) return
  const booking = await loadBooking(tx, scope, op.targetId)
  if (!booking || booking.salesOrderId) return
  booking.salesOrderId = op.salesDocumentId
  booking.updatedAt = new Date()
  scheduleBookingChanged(ctx, booking)
}

async function onCompensationFailed(ctx: OperationRunContext, error: ClassifiedSalesError, failure: { first: boolean }): Promise<void> {
  if (!failure.first) return
  const booking = await loadBooking(ctx.tx, ctx.scope, ctx.op.targetId)
  if (!booking) return
  scheduleNotification(ctx, booking, 'property_management.booking.order_orphaned', error)
  ctx.postCommit.push(() =>
    emitBookingEvent('property_management.booking.order_orphaned', booking, {
      operationId: ctx.op.id,
      orphanedSalesOrderId: ctx.op.salesDocumentId ?? null,
    }),
  )
}

export function duplicateBookingOrderCancellationSubjectKey(orderId: string): string {
  return `order_status:${orderId}:cancelled`
}

async function scheduleDuplicateOrderCancellation(ctx: OperationRunContext, orderId: string, statusEntryId: string): Promise<void> {
  const subjectKey = duplicateBookingOrderCancellationSubjectKey(orderId)
  const existing = await findOneWithDecryption(ctx.tx, SalesOperation, { ...ctx.scope, subjectKey }, undefined, ctx.scope)
  if (existing) {
    if (!TERMINAL_OPERATION_STATUSES.has(existing.status)) ctx.enqueue([existing.id])
    return
  }
  const operation = await recordOperation(ctx.tx, ctx.scope, {
    kind: 'order_status',
    subjectKey,
    payload: { orderId, statusEntryId },
    targetType: ctx.op.targetType,
    targetId: ctx.op.targetId,
  })
  await ctx.tx.flush()
  ctx.enqueue([operation.id])
}

async function scheduleDuplicateOrderCancellations(ctx: OperationRunContext, orderIds: string[]): Promise<void> {
  if (!orderIds.length) return
  const { cancelledOrderStatusEntryId } = await loadSettings(ctx.tx, ctx.scope)
  if (!cancelledOrderStatusEntryId) return
  for (const orderId of orderIds) await scheduleDuplicateOrderCancellation(ctx, orderId, cancelledOrderStatusEntryId)
}

async function onDuplicated(ctx: OperationRunContext, duplicateIds: string[]): Promise<void> {
  const cancelledIds: string[] = []
  const failedIds: string[] = []
  for (const duplicateId of duplicateIds) {
    try {
      await moveOrderToCancelledStatus(ctx, duplicateId)
      cancelledIds.push(duplicateId)
    } catch (err) {
      failedIds.push(duplicateId)
      logger.error('Compensating a duplicated booking order failed', { operationId: ctx.op.id, duplicateId, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.duplicate_compensation_failed' })
    }
  }
  await scheduleDuplicateOrderCancellations(ctx, failedIds)
  const booking = await loadBooking(ctx.tx, ctx.scope, ctx.op.targetId)
  if (!booking) return
  scheduleNotification(
    ctx,
    booking,
    'property_management.sales_operation.duplicated',
    { kind: 'permanent', status: null, code: 'sales_operation_duplicated', message: await describeDuplicateOutcome(cancelledIds, failedIds) },
    'administrators',
  )
}

export const bookingOperationHandler: OperationTargetHandler = {
  isHoldValid,
  finish,
  onDone,
  onRefused,
  onCompensated,
  onCompensationFailed,
  onDuplicated,
}
