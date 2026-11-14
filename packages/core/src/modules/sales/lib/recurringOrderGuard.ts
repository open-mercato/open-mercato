import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesOrderRecurrence } from '../data/entities'
import { compareIsoDates, localToday, type RecurrenceSchedule } from './recurrence'
import { findOrderRecurrence, hasRecurringPeriods, schedulesEqual } from './recurrenceStore'

export type RecurringErrorCode =
  | 'recurring_quote_started'
  | 'recurring_quote_no_lines'
  | 'recurring_order_locked'
  | 'recurring_order_use_cancel'
  | 'recurring_order_invoiced'
  | 'recurring_order_invoiced_stop'

const FALLBACK_MESSAGES: Record<RecurringErrorCode, string> = {
  recurring_quote_started: 'This recurring quote starts in the past. Create a new quote with a current start date.',
  recurring_quote_no_lines: 'Add at least one line before sending or converting a recurring quote.',
  recurring_order_locked: 'This recurring order has been invoiced. Create a new recurring order instead of editing it.',
  recurring_order_use_cancel: "A canceled or on-hold order can't keep a recurring schedule. Remove the schedule first.",
  recurring_order_invoiced: 'A recurring order with issued invoices cannot be deleted.',
  recurring_order_invoiced_stop: "A recurring order with issued invoices can't be canceled or put on hold.",
}

const STATUS_BY_CODE: Record<RecurringErrorCode, number> = {
  recurring_quote_started: 422,
  recurring_quote_no_lines: 422,
  recurring_order_locked: 409,
  recurring_order_use_cancel: 409,
  recurring_order_invoiced: 409,
  recurring_order_invoiced_stop: 409,
}

export async function recurringError(code: RecurringErrorCode): Promise<CrudHttpError> {
  const { translate } = await resolveTranslations()
  return new CrudHttpError(STATUS_BY_CODE[code], {
    error: translate(`sales.recurring.errors.${code}`, FALLBACK_MESSAGES[code]),
    code,
  })
}

/**
 * A recurring quote may only be accepted or converted on or before its start date (R7),
 * and only with at least one line.
 */
export async function assertRecurringQuoteConvertible(
  recurrence: { startsOn: string } | null | undefined,
  lineCount: number,
  today: string = localToday(),
): Promise<void> {
  if (!recurrence) return
  if (compareIsoDates(recurrence.startsOn, today) < 0) throw await recurringError('recurring_quote_started')
  if (lineCount < 1) throw await recurringError('recurring_quote_no_lines')
}

type OrderScope = { id: string; tenantId: string; organizationId: string }

const STOPPING_ORDER_STATUSES = new Set(['canceled', 'cancelled', 'on_hold'])
const UNFINISHED_RECURRENCE_STATUSES = new Set(['scheduled', 'active', 'cancelling'])

/**
 * Lines, order-level adjustments, the recurrence and the fields that change what is billed
 * are frozen once a recurring order has an issued period (R5).
 */
export async function assertOrderRecurrenceUnlocked(em: EntityManager, order: OrderScope): Promise<void> {
  if (await hasRecurringPeriods(em, order)) throw await recurringError('recurring_order_locked')
}

/**
 * A canceled or on-hold order may not carry an unfinished recurrence (R10): the schedule has to
 * be removed first, or stopped with *Cancel recurring order* once that ships. An invoiced
 * schedule cannot be removed (R5), so that refusal does not point at removing it. `nextStatus` and
 * `nextRecurrence` are the values the write leaves on the order; `nextRecurrence` is `undefined`
 * when the write keeps the current one. Order writes MUST call it after the order row lock that
 * recurrence writes take, so a concurrent recurrence write cannot slip between this check and
 * the status write; quote conversion calls it under the quote lock, before the order exists.
 */
export async function assertRecurringOrderStatusAllowed(
  em: EntityManager,
  order: OrderScope,
  nextStatus: string | null | undefined,
  nextRecurrence?: RecurrenceSchedule | null,
): Promise<void> {
  const status = typeof nextStatus === 'string' ? nextStatus.trim() : ''
  if (!STOPPING_ORDER_STATUSES.has(status) || nextRecurrence === null) return
  const recurrence = await findOrderRecurrence(em, order)
  const keepsCurrent = nextRecurrence === undefined || (!!recurrence && schedulesEqual(recurrence, nextRecurrence))
  const unfinished = keepsCurrent
    ? !!recurrence && UNFINISHED_RECURRENCE_STATUSES.has(recurrence.status)
    : true
  if (!unfinished) return
  if (await hasRecurringPeriods(em, order)) throw await recurringError('recurring_order_invoiced_stop')
  throw await recurringError('recurring_order_use_cancel')
}

/**
 * A recurring order with any period cannot be deleted. Locks the recurrence row first so the
 * check cannot race the invoicing worker, which takes the same lock before issuing a period.
 * MUST run inside the delete's transaction.
 */
export async function assertRecurringOrderDeletable(em: EntityManager, order: OrderScope): Promise<void> {
  const recurrence = await findOneWithDecryption(
    em,
    SalesOrderRecurrence,
    { orderId: order.id, tenantId: order.tenantId, organizationId: order.organizationId },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    { tenantId: order.tenantId, organizationId: order.organizationId },
  )
  if (!recurrence) return
  if (await hasRecurringPeriods(em, order)) throw await recurringError('recurring_order_invoiced')
}
