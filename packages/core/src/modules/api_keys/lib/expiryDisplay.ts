import { formatDisplayDate, formatDisplayDateTime, toUtcDateInputValue } from '@open-mercato/ui/primitives/date-format'

function isUtcMidnight(date: Date): boolean {
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0
}

/**
 * The create form submits a bare `yyyy-MM-dd`, stored as UTC midnight, so that value names a calendar
 * day and is read back in UTC; an expiry set with a time of day through the API or CLI stays an instant.
 */
export function formatApiKeyExpiry(value: string | null | undefined, locale?: string): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return isUtcMidnight(parsed)
    ? formatDisplayDate(toUtcDateInputValue(parsed), locale)
    : formatDisplayDateTime(parsed, locale)
}
