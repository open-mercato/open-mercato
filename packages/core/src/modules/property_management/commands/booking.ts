import { randomUUID } from 'node:crypto'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Booking, Building, Unavailability, Unit, type BookingCancelReason, type SalesOperation } from '../data/entities'
import {
  bookingCancelSchema,
  bookingCreateSchema,
  bookingIdSchema,
  type BookingCancelInput,
  type BookingCreateInput,
} from '../data/validators'
import { conflictError, forbiddenError, notFoundError, unprocessableError } from '../lib/errors'
import { subjectsOf, windowIntersects, windowOf } from '../lib/availabilityResolver'
import { checkBookingRules, MAX_HOURLY_BOOKING_HOURS, type BookingRuleIssue } from '../lib/bookingSlots'
import {
  assertBuildingOpenForBooking,
  assertUnitAvailableForBooking,
  bookingRangeOf,
  bookingPriceContext,
  buildBookingOrderPayload,
  findOverlappingBookings,
  loadPermittedBooking,
  lockBookingWithUnit,
  resolveBookingParty,
  resolveBookingProduct,
} from '../lib/bookingRecords'
import { bookingCrudEvents, bookingCrudIndexer, emitBookingEvent, markBookingChanged } from '../lib/bookingEvents'
import { applyingClosuresOf, isHeldBackByClosure } from '../lib/bookingSweep'
import { loadPermittedUnit, lockUnitRow } from '../lib/leaseRecords'
import { formatAmount, multiplyAmount } from '../lib/money'
import { openPeriodPrice, recordPeriodPrice, resolvePriceSnapshot, type Scope } from '../lib/productUse'
import { enqueueSalesOperations, recordOperation, recordOperations, type RecordOperationInput } from '../lib/salesOperations'
import { loadSettings, type SettingsValues } from '../lib/settings'
import { HOLDING_BOOKING_STATUSES } from '../lib/usageGuards'
import { bookingHasEnded } from '../lib/bookingCancel'
import { loadBuildingOpening, openingWindowFor } from '../lib/openingHours'
import { compareWallClock, datePartOf, localNow, normalizeWallClock, toStoredWallClock } from '../lib/wallClock'
import { buildCrudLog, emitSideEffects, ensureScope, resolveEm, resolvePermitted } from './shared'

export const BOOKING_RESOURCE_KIND = 'property_management.booking'

export type BookingCreateResult = { bookingId: string; status: 'pending'; operationId: string }
export type BookingCancelResult = { bookingId: string; status: 'cancelled'; operationId: string | null }
export type BookingCompleteResult = { bookingId: string; completed: boolean }

type RuleMessage = { key: string; fallback: string; status: 409 | 422; params?: Record<string, string | number> }

const RULE_MESSAGES: Record<BookingRuleIssue, RuleMessage> = {
  booking_time_invalid: { key: 'property_management.errors.bookingTimeInvalid', fallback: 'Choose a valid start and end time.', status: 422 },
  booking_not_on_the_hour: { key: 'property_management.errors.bookingNotOnTheHour', fallback: 'Bookings start and end on the hour.', status: 422 },
  booking_crosses_midnight: { key: 'property_management.errors.bookingCrossesMidnight', fallback: 'A booking cannot cross midnight.', status: 422 },
  booking_too_long: {
    key: 'property_management.errors.bookingTooLong',
    fallback: 'A booking lasts at most {hours} hours.',
    status: 422,
    params: { hours: MAX_HOURLY_BOOKING_HOURS },
  },
  booking_not_whole_day: { key: 'property_management.errors.bookingNotWholeDay', fallback: 'This unit is booked by the day. Book the whole day.', status: 422 },
  booking_outside_opening_hours: {
    key: 'property_management.errors.bookingOutsideOpeningHours',
    fallback: "The booking is outside the building's opening hours.",
    status: 409,
  },
  booking_in_past: { key: 'property_management.errors.bookingInPast', fallback: 'The booking time has already passed.', status: 422 },
  booking_billing_unit_invalid: { key: 'property_management.errors.unitNotBookable', fallback: 'This unit is not bookable.', status: 422 },
}

function scopeOfInput(input: { tenantId: string; organizationId: string }): Scope {
  return { tenantId: input.tenantId, organizationId: input.organizationId }
}

async function ruleError(issue: BookingRuleIssue) {
  const message = RULE_MESSAGES[issue]
  const extra = { code: issue, fieldErrors: { startsAt: message.key } }
  return message.status === 409
    ? conflictError(message.key, message.fallback, extra, message.params)
    : unprocessableError(message.key, message.fallback, extra, message.params)
}

async function requireBookingSettings(settings: SettingsValues): Promise<{ channelId: string; cancelledStatusEntryId: string }> {
  if (!settings.billingChannelId) {
    throw await unprocessableError(
      'property_management.errors.bookingBillingChannelMissing',
      'Choose the sales channel for booking documents in Property Management settings first.',
      { code: 'billing_channel_missing' },
    )
  }
  if (!settings.cancelledOrderStatusEntryId) {
    throw await unprocessableError(
      'property_management.errors.cancelledStatusMissing',
      'Choose the sales order status used for cancelled bookings in Property Management settings first.',
      { code: 'cancelled_status_missing' },
    )
  }
  return { channelId: settings.billingChannelId, cancelledStatusEntryId: settings.cancelledOrderStatusEntryId }
}

async function createBooking(input: BookingCreateInput, ctx: CommandRuntimeContext): Promise<BookingCreateResult> {
  const scope = scopeOfInput(input)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const permitted = await resolvePermitted(ctx, scope)
  const { channelId } = await requireBookingSettings(await loadSettings(em, scope))
  const unit = await loadPermittedUnit(em, scope, permitted, input.unitId)
  const product = await resolveBookingProduct(em, scope, unit)
  const periodPrice = await openPeriodPrice(em, ctx.container, scope, unit.id, { channelId })
  const building = await findOneWithDecryption(em, Building, { id: unit.buildingId, ...scope, deletedAt: null }, undefined, scope)
  const ruleInput = { startsAt: input.startsAt, endsAt: input.endsAt, billingUnit: product.billingUnit }
  const opening = building ? await loadBuildingOpening(em, scope, building) : null
  const rules = checkBookingRules({ ...ruleInput, opening: openingWindowFor(opening, datePartOf(input.startsAt)), now: localNow() })
  if (!rules.ok) throw await ruleError(rules.issue)
  const range = { start: normalizeWallClock(input.startsAt), end: normalizeWallClock(input.endsAt) }
  const party = await resolveBookingParty(em, scope, input)
  const price = await resolvePriceSnapshot(
    em,
    ctx.container,
    scope,
    product.catalogProductId,
    bookingPriceContext({ channelId, startsAt: range.start, quantity: rules.quantity, party }),
  )
  if (!price.priceAmount || !price.currencyCode) {
    throw await unprocessableError('property_management.errors.bookingPriceMissing', 'The unit product has no price, so it cannot be booked.', {
      code: 'booking_price_missing',
    })
  }
  const unitPrice = formatAmount(price.priceAmount)
  const totalAmount = multiplyAmount(price.priceAmount, rules.quantity)
  const token = randomUUID()
  const outcome = await em.fork().transactional(async (trx) => {
    const lockedBuilding = await assertBuildingOpenForBooking(trx, scope, unit.buildingId)
    const currentOpening = await loadBuildingOpening(trx, scope, lockedBuilding)
    const recheck = checkBookingRules({ ...ruleInput, opening: openingWindowFor(currentOpening, datePartOf(input.startsAt)), now: localNow() })
    if (!recheck.ok) throw await ruleError(recheck.issue)
    const locked = await lockUnitRow(trx, scope, unit.id)
    const current = await resolveBookingProduct(trx, scope, locked)
    if (current.periodId !== product.periodId || current.billingUnit !== product.billingUnit) {
      throw await conflictError('property_management.errors.bookingProductChanged', 'The unit product changed meanwhile. Reload and try again.', {
        code: 'booking_product_changed',
      })
    }
    const overlapping = await findOverlappingBookings(trx, scope, locked.id, range)
    if (overlapping.length) {
      throw await conflictError('property_management.errors.bookingSlotTaken', 'This time is already booked.', {
        code: 'booking_slot_taken',
        conflicts: overlapping.map((booking) => bookingRangeOf(booking)),
      })
    }
    await assertUnitAvailableForBooking(trx, scope, locked, range)
    await recordPeriodPrice(trx, scope, locked.id, product.catalogProductId, periodPrice)
    const booking = trx.create(Booking, {
      id: randomUUID(),
      ...scope,
      buildingId: locked.buildingId,
      unitId: locked.id,
      customerCompanyId: party.customerCompanyId,
      bookedByPersonId: party.bookedByPersonId,
      customerUserId: party.customerUserId,
      startsAt: toStoredWallClock(range.start),
      endsAt: toStoredWallClock(range.end),
      status: 'pending',
      holdToken: token,
      catalogProductId: product.catalogProductId,
      productName: product.productName,
      unitPrice,
      quantity: rules.quantity,
      billingUnit: product.billingUnit,
      totalAmount,
      currencyCode: price.currencyCode,
      notes: input.notes ?? null,
    })
    trx.persist(booking)
    const operation = await recordOperation(trx, scope, {
      kind: 'booking_order',
      subjectKey: `booking_order:${booking.id}`,
      payload: buildBookingOrderPayload({ booking, unitName: locked.name, channelId }),
      targetType: 'booking',
      targetId: booking.id,
      token,
    })
    await trx.flush()
    return { booking, operation }
  })
  await enqueueSalesOperations([outcome.operation.id])
  await emitSideEffects(ctx, 'created', outcome.booking, { indexer: bookingCrudIndexer, events: bookingCrudEvents })
  return { bookingId: outcome.booking.id, status: 'pending', operationId: outcome.operation.id }
}

export async function enforceBookingLock(ctx: CommandRuntimeContext, booking: Booking): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: BOOKING_RESOURCE_KIND,
    resourceId: booking.id,
    current: booking.updatedAt,
    request: ctx.request ?? null,
  })
}

export type ReleaseBookingOptions = {
  reason: BookingCancelReason
  unavailabilityId?: string | null
  cancelledStatusEntryId: string | null
}

async function cancelledStatusMissingError() {
  return unprocessableError(
    'property_management.errors.cancelledStatusMissing',
    'Choose the sales order status used for cancelled bookings in Property Management settings first.',
    { code: 'cancelled_status_missing' },
  )
}

function bookingOrderCancellationInput(booking: Booking & { salesOrderId: string }, cancelledStatusEntryId: string): RecordOperationInput {
  return {
    kind: 'order_status',
    subjectKey: `order_status:${booking.salesOrderId}:cancelled`,
    payload: { orderId: booking.salesOrderId, statusEntryId: cancelledStatusEntryId },
    targetType: 'booking',
    targetId: booking.id,
  }
}

function hasSalesOrder(booking: Booking): booking is Booking & { salesOrderId: string } {
  return Boolean(booking.salesOrderId)
}

function needsCancelledStatus(booking: Booking): boolean {
  return hasSalesOrder(booking) || booking.status === 'pending'
}

export async function recordBookingOrderCancellation(
  trx: EntityManager,
  scope: Scope,
  booking: Booking,
  cancelledStatusEntryId: string | null,
): Promise<SalesOperation | null> {
  if (!needsCancelledStatus(booking)) return null
  if (!cancelledStatusEntryId) throw await cancelledStatusMissingError()
  if (!hasSalesOrder(booking)) return null
  return recordOperation(trx, scope, bookingOrderCancellationInput(booking, cancelledStatusEntryId))
}

export async function recordBookingOrderCancellations(
  trx: EntityManager,
  scope: Scope,
  bookings: readonly Booking[],
  cancelledStatusEntryId: string | null,
): Promise<SalesOperation[]> {
  if (!bookings.some(needsCancelledStatus)) return []
  if (!cancelledStatusEntryId) throw await cancelledStatusMissingError()
  const withOrders = bookings.filter(hasSalesOrder)
  if (!withOrders.length) return []
  return recordOperations(trx, scope, withOrders.map((booking) => bookingOrderCancellationInput(booking, cancelledStatusEntryId)))
}

export function markBookingReleased(booking: Booking, options: Pick<ReleaseBookingOptions, 'reason' | 'unavailabilityId'>): void {
  booking.status = 'cancelled'
  booking.cancelReason = options.reason
  booking.unavailabilityId = options.unavailabilityId ?? null
  booking.holdToken = null
  booking.updatedAt = new Date()
}

export async function releaseHeldBooking(
  trx: EntityManager,
  scope: Scope,
  booking: Booking,
  options: ReleaseBookingOptions,
): Promise<SalesOperation | null> {
  const operation = await recordBookingOrderCancellation(trx, scope, booking, options.cancelledStatusEntryId)
  markBookingReleased(booking, options)
  return operation
}

async function assertUnavailabilityCoversBooking(trx: EntityManager, scope: Scope, booking: Booking, unavailabilityId: string): Promise<void> {
  const closure = await findOneWithDecryption(
    trx,
    Unavailability,
    { id: unavailabilityId, ...scope, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_READ, refresh: true },
    scope,
  )
  const window = closure ? windowOf(closure) : null
  const unit = closure && window ? await findOneWithDecryption(trx, Unit, { id: booking.unitId, ...scope }, undefined, scope) : null
  const covered =
    closure !== null &&
    window !== null &&
    unit !== null &&
    subjectsOf(unit).some((subject) => subject.type === closure.subjectType && subject.id === closure.subjectId) &&
    windowIntersects(window, bookingRangeOf(booking))
  if (!covered) {
    throw await conflictError('property_management.errors.unavailabilityNotCovering', 'The unavailability no longer covers this booking.', {
      code: 'unavailability_not_covering',
    })
  }
}

function authenticatedCustomerUserId(ctx: CommandRuntimeContext, scope: Scope): string | null {
  const auth = ctx.auth
  if (!auth || auth.type !== 'customer') return null
  if (typeof auth.sub !== 'string' || !auth.sub.length) return null
  if (auth.tenantId !== scope.tenantId || auth.orgId !== scope.organizationId) return null
  return auth.sub
}

async function requireCancellingCustomer(ctx: CommandRuntimeContext, scope: Scope, input: BookingCancelInput): Promise<string> {
  const customerUserId = authenticatedCustomerUserId(ctx, scope)
  if (!customerUserId) {
    throw await forbiddenError('property_management.errors.forbidden', 'You do not have permission to do this.', {
      code: 'customer_auth_required',
    })
  }
  if (input.customerUserId && input.customerUserId !== customerUserId) {
    throw await notFoundError('property_management.errors.bookingNotFound', 'Booking not found.')
  }
  return customerUserId
}

async function cancelBooking(input: BookingCancelInput, ctx: CommandRuntimeContext): Promise<BookingCancelResult> {
  const scope = scopeOfInput(input)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const byCustomer = input.reason === 'customer'
  if (input.reason === 'unavailability' && !input.unavailabilityId) {
    throw await unprocessableError('property_management.errors.unavailabilityRequired', 'A cancellation for unavailability names the unavailability.', {
      code: 'unavailability_required',
    })
  }
  const customerUserId = byCustomer ? await requireCancellingCustomer(ctx, scope, input) : null
  const permitted = byCustomer ? null : await resolvePermitted(ctx, scope)
  const current = await loadPermittedBooking(em, scope, permitted, input.id)
  if (byCustomer && current.customerUserId !== customerUserId) {
    throw await notFoundError('property_management.errors.bookingNotFound', 'Booking not found.')
  }
  const settings = await loadSettings(em, scope)
  const outcome = await em.fork().transactional(async (trx) => {
    const booking = await lockBookingWithUnit(trx, scope, current.id)
    if (!booking) throw await notFoundError('property_management.errors.bookingNotFound', 'Booking not found.')
    await enforceBookingLock(ctx, booking)
    if (!HOLDING_BOOKING_STATUSES.includes(booking.status)) {
      throw await conflictError('property_management.errors.bookingNotCancellable', 'Only a pending or confirmed booking can be cancelled.', {
        code: 'booking_not_cancellable',
        status: booking.status,
      })
    }
    if (byCustomer && compareWallClock(normalizeWallClock(booking.startsAt), localNow()) <= 0) {
      throw await conflictError('property_management.errors.bookingAlreadyStarted', 'The booking has already started, so it can no longer be cancelled.', {
        code: 'booking_already_started',
      })
    }
    if (input.reason === 'manager' && bookingHasEnded(booking.endsAt)) {
      throw await conflictError('property_management.errors.bookingAlreadyEnded', 'The booking has already ended, so it can no longer be cancelled.', {
        code: 'booking_already_ended',
      })
    }
    if (input.reason === 'unavailability' && input.unavailabilityId) {
      await assertUnavailabilityCoversBooking(trx, scope, booking, input.unavailabilityId)
    }
    const operation = await releaseHeldBooking(trx, scope, booking, {
      reason: input.reason,
      unavailabilityId: input.reason === 'unavailability' ? input.unavailabilityId ?? null : null,
      cancelledStatusEntryId: settings.cancelledOrderStatusEntryId ?? null,
    })
    await trx.flush()
    return { booking, operation }
  })
  if (outcome.operation) await enqueueSalesOperations([outcome.operation.id])
  await emitBookingEvent('property_management.booking.cancelled', outcome.booking)
  await emitSideEffects(ctx, 'updated', outcome.booking, { indexer: bookingCrudIndexer })
  return { bookingId: outcome.booking.id, status: 'cancelled', operationId: outcome.operation?.id ?? null }
}

const createBookingCommand: CommandHandler<BookingCreateInput, BookingCreateResult> = {
  id: 'property_management.booking.create',
  isUndoable: false,
  async execute(rawInput, ctx) {
    return createBooking(bookingCreateSchema.parse(rawInput ?? {}), ctx)
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.bookingId ?? null, 'property_management.audit.booking.create', 'Create booking', BOOKING_RESOURCE_KIND),
}

const cancelBookingCommand: CommandHandler<BookingCancelInput, BookingCancelResult> = {
  id: 'property_management.booking.cancel',
  isUndoable: false,
  async execute(rawInput, ctx) {
    return cancelBooking(bookingCancelSchema.parse(rawInput ?? {}), ctx)
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.bookingId ?? null, 'property_management.audit.booking.cancel', 'Cancel booking', BOOKING_RESOURCE_KIND),
}

async function isHeldBackByApplyingClosure(trx: EntityManager, scope: Scope, booking: Booking): Promise<boolean> {
  const unit = await findOneWithDecryption(trx, Unit, { id: booking.unitId, ...scope }, undefined, scope)
  if (!unit) return false
  const where: Record<string, unknown> = {
    ...scope,
    applyStatus: 'applying',
    deletedAt: null,
    $or: subjectsOf(unit).map((subject) => ({ subjectType: subject.type, subjectId: subject.id })),
  }
  const rows = await findWithDecryption(trx, Unavailability, where, { lockMode: LockMode.PESSIMISTIC_READ, refresh: true }, scope)
  const closures = applyingClosuresOf(rows)
  return closures !== null && isHeldBackByClosure(unit, booking, closures)
}

const completeBookingCommand: CommandHandler<{ id: string; tenantId: string; organizationId: string }, BookingCompleteResult> = {
  id: 'property_management.booking.complete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = bookingIdSchema.parse(rawInput ?? {})
    const scope = scopeOfInput(input)
    ensureScope(ctx, scope)
    const now = localNow()
    const booking = await resolveEm(ctx).transactional(async (trx) => {
      const locked = await lockBookingWithUnit(trx, scope, input.id)
      if (!locked || locked.status !== 'confirmed' || compareWallClock(normalizeWallClock(locked.endsAt), now) > 0) return null
      if (await isHeldBackByApplyingClosure(trx, scope, locked)) return null
      locked.status = 'completed'
      locked.updatedAt = new Date()
      await trx.flush()
      return locked
    })
    if (booking) {
      await emitBookingEvent('property_management.booking.completed', booking)
      await markBookingChanged(ctx.container, booking)
    }
    return { bookingId: input.id, completed: Boolean(booking) }
  },
}

registerCommand(createBookingCommand)
registerCommand(cancelBookingCommand)
registerCommand(completeBookingCommand)
