import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import type { SalesRecurrenceFrequency } from './recurrence'

export type RecurrenceLabelInput = {
  frequency: SalesRecurrenceFrequency
  startsOn: string
  periodCount?: number | null
}

const FREQUENCY_FALLBACKS: Record<SalesRecurrenceFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

/** Formats a calendar date (`YYYY-MM-DD`) without shifting it through the viewer's timezone. */
export function formatRecurrenceDate(value: string | null | undefined, locale?: string): string {
  if (!value) return ''
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
  } catch {
    return value
  }
}

export function formatRecurrenceFrequency(frequency: SalesRecurrenceFrequency, translate: TranslateWithFallbackFn): string {
  return translate(`sales.recurring.frequency.${frequency}`, FREQUENCY_FALLBACKS[frequency])
}

/** "Monthly from 1 Oct 2026, 24 payments" / "Monthly from 1 Oct 2026, no end date". */
export function formatRecurrenceSchedule(
  recurrence: RecurrenceLabelInput,
  translate: TranslateWithFallbackFn,
  locale?: string,
): string {
  const params = {
    frequency: formatRecurrenceFrequency(recurrence.frequency, translate),
    startsOn: formatRecurrenceDate(recurrence.startsOn, locale),
    count: recurrence.periodCount ?? 0,
  }
  if (!recurrence.periodCount) {
    return translate('sales.recurring.schedule.openEnded', '{frequency} from {startsOn}, no end date', params)
  }
  if (recurrence.periodCount === 1) {
    return translate('sales.recurring.schedule.single', '{frequency} from {startsOn}, 1 payment', params)
  }
  return translate('sales.recurring.schedule.withCount', '{frequency} from {startsOn}, {count} payments', params)
}
