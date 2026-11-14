import { isDeepStrictEqual } from 'node:util'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  SalesOrderRecurrence,
  SalesQuoteRecurrence,
  SalesRecurringPeriod,
  type SalesOrder,
  type SalesQuote,
} from '../data/entities'
import {
  endsOn,
  type RecurrenceSchedule,
  type SalesOrderRecurrenceStatus,
  type SalesRecurringCancelSettlement,
} from './recurrence'

export type QuoteRecurrenceSnapshot = {
  frequency: RecurrenceSchedule['frequency']
  startsOn: string
  anchorDay: number | null
  periodCount: number | null
}

export type OrderRecurrenceSnapshot = QuoteRecurrenceSnapshot & {
  endsOn: string | null
  nextPeriodIndex: number
  nextInvoiceOn: string
  status: SalesOrderRecurrenceStatus
  scheduleVersion: number
  cancelRequestedAt: string | null
  cancelEffectiveOn: string | null
  cancelSettlement: SalesRecurringCancelSettlement | null
  cancelledByUserId: string | null
  cancelIdempotencyKey: string | null
  cancelResult: { creditMemoIds: string[] } | null
}

export type RecurrenceResponse = QuoteRecurrenceSnapshot & {
  endsOn: string | null
  nextInvoiceOn: string | null
  status: SalesOrderRecurrenceStatus | null
  scheduleVersion: number | null
}

type DocumentScope = { id: string; tenantId: string; organizationId: string }

function scopeOf(document: DocumentScope) {
  return { tenantId: document.tenantId, organizationId: document.organizationId }
}

function toSchedule(input: RecurrenceSchedule): QuoteRecurrenceSnapshot {
  return {
    frequency: input.frequency,
    startsOn: input.startsOn,
    anchorDay: input.anchorDay ?? null,
    periodCount: input.periodCount ?? null,
  }
}

export function schedulesEqual(left: RecurrenceSchedule | null, right: RecurrenceSchedule | null): boolean {
  if (!left || !right) return left === right
  const a = toSchedule(left)
  const b = toSchedule(right)
  return (
    a.frequency === b.frequency &&
    a.startsOn === b.startsOn &&
    a.anchorDay === b.anchorDay &&
    a.periodCount === b.periodCount
  )
}

/**
 * Whether two undo snapshots describe the same recurrence. `scheduleVersion` is left out:
 * every undo bumps it on purpose, so including it would reject the next undo in a chain.
 * `undefined` means the snapshot predates recurrences and matches anything.
 */
export function sameRecurrenceState(
  current: QuoteRecurrenceSnapshot | OrderRecurrenceSnapshot | null | undefined,
  expected: QuoteRecurrenceSnapshot | OrderRecurrenceSnapshot | null | undefined,
): boolean {
  if (expected === undefined) return true
  return isDeepStrictEqual(withoutScheduleVersion(current ?? null), withoutScheduleVersion(expected))
}

function withoutScheduleVersion(snapshot: QuoteRecurrenceSnapshot | OrderRecurrenceSnapshot | null) {
  if (!snapshot || !('scheduleVersion' in snapshot)) return snapshot
  const { scheduleVersion: _scheduleVersion, ...rest } = snapshot
  return rest
}

export function snapshotQuoteRecurrence(entity: SalesQuoteRecurrence): QuoteRecurrenceSnapshot {
  return toSchedule(entity)
}

export function snapshotOrderRecurrence(entity: SalesOrderRecurrence): OrderRecurrenceSnapshot {
  return {
    ...toSchedule(entity),
    endsOn: entity.endsOn ?? null,
    nextPeriodIndex: entity.nextPeriodIndex,
    nextInvoiceOn: entity.nextInvoiceOn,
    status: entity.status,
    scheduleVersion: entity.scheduleVersion,
    cancelRequestedAt: entity.cancelRequestedAt ? entity.cancelRequestedAt.toISOString() : null,
    cancelEffectiveOn: entity.cancelEffectiveOn ?? null,
    cancelSettlement: entity.cancelSettlement ?? null,
    cancelledByUserId: entity.cancelledByUserId ?? null,
    cancelIdempotencyKey: entity.cancelIdempotencyKey ?? null,
    cancelResult: entity.cancelResult ?? null,
  }
}

export function toRecurrenceResponse(
  snapshot: QuoteRecurrenceSnapshot | OrderRecurrenceSnapshot | null,
): RecurrenceResponse | null {
  if (!snapshot) return null
  const order = 'status' in snapshot ? snapshot : null
  return {
    ...toSchedule(snapshot),
    endsOn: order ? order.endsOn : endsOn(snapshot),
    nextInvoiceOn: order ? order.nextInvoiceOn : null,
    status: order ? order.status : null,
    scheduleVersion: order ? order.scheduleVersion : null,
  }
}

export function findQuoteRecurrence(em: EntityManager, quote: DocumentScope) {
  return findOneWithDecryption(
    em,
    SalesQuoteRecurrence,
    { quote: quote.id, ...scopeOf(quote) },
    undefined,
    scopeOf(quote),
  )
}

export function findOrderRecurrence(em: EntityManager, order: DocumentScope) {
  return findOneWithDecryption(
    em,
    SalesOrderRecurrence,
    { orderId: order.id, ...scopeOf(order), deletedAt: null },
    undefined,
    scopeOf(order),
  )
}

/**
 * The order's recurrence row, including one that was removed. A removed recurrence is only
 * marked deleted, even when its order is deleted, so its `scheduleVersion` survives and a
 * recurrence added back later keeps counting from it.
 */
export function findOrderRecurrenceRow(em: EntityManager, order: DocumentScope) {
  return findOneWithDecryption(
    em,
    SalesOrderRecurrence,
    { orderId: order.id, ...scopeOf(order) },
    undefined,
    scopeOf(order),
  )
}

function isLive(entity: SalesOrderRecurrence | null): entity is SalesOrderRecurrence {
  return !!entity && !entity.deletedAt
}

const CLEARED_CANCELLATION = {
  cancelRequestedAt: null,
  cancelEffectiveOn: null,
  cancelSettlement: null,
  cancelledByUserId: null,
  cancelIdempotencyKey: null,
  cancelResult: null,
}

export async function loadQuoteRecurrenceSnapshot(
  em: EntityManager,
  quote: DocumentScope,
): Promise<QuoteRecurrenceSnapshot | null> {
  const entity = await findQuoteRecurrence(em, quote)
  return entity ? snapshotQuoteRecurrence(entity) : null
}

export async function loadOrderRecurrenceSnapshot(
  em: EntityManager,
  order: DocumentScope,
): Promise<OrderRecurrenceSnapshot | null> {
  const entity = await findOrderRecurrence(em, order)
  return entity ? snapshotOrderRecurrence(entity) : null
}

export async function hasRecurringPeriods(em: EntityManager, order: DocumentScope): Promise<boolean> {
  const periods = await findWithDecryption(
    em,
    SalesRecurringPeriod,
    { order: order.id, ...scopeOf(order) },
    { limit: 1, fields: ['id'] },
    scopeOf(order),
  )
  return periods.length > 0
}

/**
 * Creates, replaces or (with `null`) removes the quote's recurrence. Leaves `undefined` alone.
 * Call inside a `withAtomicFlush` phase; the caller flushes.
 */
export async function writeQuoteRecurrence(
  em: EntityManager,
  quote: SalesQuote,
  input: RecurrenceSchedule | null | undefined,
): Promise<void> {
  if (input === undefined) return
  const existing = await findQuoteRecurrence(em, quote)
  if (input === null) {
    if (existing) em.remove(existing)
    return
  }
  const schedule = toSchedule(input)
  if (existing) {
    Object.assign(existing, schedule)
    return
  }
  em.persist(
    em.create(SalesQuoteRecurrence, {
      organizationId: quote.organizationId,
      tenantId: quote.tenantId,
      quote,
      ...schedule,
    }),
  )
}

/**
 * Creates, replaces or (with `null`) removes the order's recurrence before its first invoice.
 * A new or changed schedule restarts at period 0 and bumps `scheduleVersion`; removing it only
 * marks the row deleted, so adding it back continues from the removed row's version.
 * Call inside a `withAtomicFlush` phase after the lock guard; the caller flushes.
 */
export async function writeOrderRecurrence(
  em: EntityManager,
  order: SalesOrder,
  input: RecurrenceSchedule | null | undefined,
): Promise<void> {
  if (input === undefined) return
  const existing = await findOrderRecurrenceRow(em, order)
  if (input === null) {
    if (isLive(existing)) existing.deletedAt = new Date()
    return
  }
  if (isLive(existing) && schedulesEqual(existing, input)) return
  persistOrderRecurrence(em, order, input, existing)
}

/**
 * Whether writing `input` would set, change or remove the order's recurrence. An echoed copy
 * of the current schedule is not a change.
 */
export async function orderRecurrenceChanges(
  em: EntityManager,
  order: DocumentScope,
  input: RecurrenceSchedule | null | undefined,
): Promise<boolean> {
  if (input === undefined) return false
  const existing = await findOrderRecurrence(em, order)
  if (input === null) return !!existing
  return !existing || !schedulesEqual(existing, input)
}

function deriveOrderSchedule(input: RecurrenceSchedule) {
  const schedule = toSchedule(input)
  return {
    ...schedule,
    endsOn: endsOn(schedule),
    nextPeriodIndex: 0,
    nextInvoiceOn: schedule.startsOn,
    status: 'scheduled' as const,
  }
}

/**
 * Persists `input` as the order's recurrence without querying — safe to call between mutations
 * and the flush (e.g. while `convert_to_order` builds a new order). `existing` is the order's
 * recurrence row from `findOrderRecurrenceRow`, live or removed; it is reused with the next
 * `scheduleVersion` instead of inserting a second row for the order.
 */
export function persistOrderRecurrence(
  em: EntityManager,
  order: SalesOrder,
  input: RecurrenceSchedule,
  existing: SalesOrderRecurrence | null = null,
): SalesOrderRecurrence {
  if (existing) {
    Object.assign(existing, deriveOrderSchedule(input), CLEARED_CANCELLATION, {
      scheduleVersion: existing.scheduleVersion + 1,
      deletedAt: null,
    })
    return existing
  }
  const entity = em.create(SalesOrderRecurrence, {
    organizationId: order.organizationId,
    tenantId: order.tenantId,
    orderId: order.id,
    ...deriveOrderSchedule(input),
    scheduleVersion: 1,
  })
  em.persist(entity)
  return entity
}

/**
 * Marks the order's recurrence removed when the order itself is deleted. The row outlives the
 * order so that restoring the order (undo) continues from its `scheduleVersion`.
 */
export async function retireOrderRecurrence(em: EntityManager, order: DocumentScope): Promise<void> {
  const now = new Date()
  await em.nativeUpdate(
    SalesOrderRecurrence,
    { orderId: order.id, ...scopeOf(order), deletedAt: null },
    { deletedAt: now, updatedAt: now },
  )
}

/**
 * Puts back the recurrence an undo snapshot recorded (or removes it). An order's
 * `scheduleVersion` only moves forward, so a client holding a pre-undo version still gets a 409.
 * The caller flushes.
 */
export async function restoreQuoteRecurrence(
  em: EntityManager,
  quote: SalesQuote,
  snapshot: QuoteRecurrenceSnapshot | null | undefined,
): Promise<void> {
  if (snapshot === undefined) return
  await writeQuoteRecurrence(em, quote, snapshot)
}

export async function restoreOrderRecurrence(
  em: EntityManager,
  order: SalesOrder,
  snapshot: OrderRecurrenceSnapshot | null | undefined,
): Promise<void> {
  if (snapshot === undefined) return
  const existing = await findOrderRecurrenceRow(em, order)
  if (snapshot === null) {
    if (isLive(existing)) existing.deletedAt = new Date()
    return
  }
  const fields = {
    ...toSchedule(snapshot),
    endsOn: snapshot.endsOn,
    nextPeriodIndex: snapshot.nextPeriodIndex,
    nextInvoiceOn: snapshot.nextInvoiceOn,
    status: snapshot.status,
    scheduleVersion: existing ? Math.max(snapshot.scheduleVersion, existing.scheduleVersion + 1) : snapshot.scheduleVersion,
    cancelRequestedAt: snapshot.cancelRequestedAt ? new Date(snapshot.cancelRequestedAt) : null,
    cancelEffectiveOn: snapshot.cancelEffectiveOn,
    cancelSettlement: snapshot.cancelSettlement,
    cancelledByUserId: snapshot.cancelledByUserId,
    cancelIdempotencyKey: snapshot.cancelIdempotencyKey,
    cancelResult: snapshot.cancelResult,
    deletedAt: null,
  }
  if (existing) {
    Object.assign(existing, fields)
    return
  }
  em.persist(
    em.create(SalesOrderRecurrence, {
      organizationId: order.organizationId,
      tenantId: order.tenantId,
      orderId: order.id,
      ...fields,
    }),
  )
}
