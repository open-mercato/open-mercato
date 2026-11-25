/**
 * A weekly series that ends "On date" needs that date to be on or after the first one,
 * otherwise it is saved with no occurrences. Both values are `YYYY-MM-DD`, which compare
 * correctly as text. An end date that is not set yet, or a missing start date, is not
 * this error: those are handled by their own required-field checks.
 */
export function isRecurrenceEndBeforeStart(
  endType: 'never' | 'count' | 'date',
  endDate: string,
  startDate: string,
): boolean {
  if (endType !== 'date') return false
  const end = endDate.trim()
  const start = startDate.trim()
  if (!end || !start) return false
  return end < start
}
