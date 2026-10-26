import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { compareIsoDates, localToday } from './recurrence'

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
