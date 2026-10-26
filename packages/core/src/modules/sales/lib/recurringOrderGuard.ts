import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesOrderRecurrence } from '../data/entities'
import { compareIsoDates, localToday } from './recurrence'
import { findOrderRecurrence, hasRecurringPeriods } from './recurrenceStore'

export type RecurringErrorCode =
  | 'recurring_quote_started'
  | 'recurring_quote_no_lines'
  | 'recurring_order_locked'
  | 'recurring_order_use_cancel'
  | 'recurring_order_invoiced'

const FALLBACK_MESSAGES: Record<RecurringErrorCode, string> = {
  recurring_quote_started: 'This recurring quote starts in the past. Create a new quote with a current start date.',
  recurring_quote_no_lines: 'Add at least one line before sending or converting a recurring quote.',
  recurring_order_locked: 'This recurring order has been invoiced. Create a new recurring order instead of editing it.',
  recurring_order_use_cancel: 'Use "Cancel recurring order" to stop a recurring order.',
  recurring_order_invoiced: 'A recurring order with issued invoices cannot be deleted. Cancel it instead.',
}

const STATUS_BY_CODE: Record<RecurringErrorCode, number> = {
  recurring_quote_started: 422,
  recurring_quote_no_lines: 422,
  recurring_order_locked: 409,
  recurring_order_use_cancel: 409,
  recurring_order_invoiced: 409,
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
 * Only *Cancel recurring order* stops a recurring order (R10): moving it to a canceled or
 * on-hold status is refused while its recurrence is unfinished.
 */
export async function assertRecurringOrderStatusAllowed(
  em: EntityManager,
  order: OrderScope,
  nextStatus: string | null | undefined,
): Promise<void> {
  const status = typeof nextStatus === 'string' ? nextStatus.trim() : ''
  if (!STOPPING_ORDER_STATUSES.has(status)) return
  const recurrence = await findOrderRecurrence(em, order)
  if (recurrence && UNFINISHED_RECURRENCE_STATUSES.has(recurrence.status)) {
    throw await recurringError('recurring_order_use_cancel')
  }
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
    { order: order.id },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    { tenantId: order.tenantId, organizationId: order.organizationId },
  )
  if (!recurrence) return
  if (await hasRecurringPeriods(em, order)) throw await recurringError('recurring_order_invoiced')
}
