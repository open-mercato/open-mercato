const MS_PER_DAY = 24 * 60 * 60 * 1000

export function pluralCategory(locale: string, count: number): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale).select(count)
  } catch {
    return count === 1 ? 'one' : 'other'
  }
}

export function eventDisplayTitle(title: string | null | undefined, fallback: string): string {
  return title && title.trim().length > 0 ? title : fallback
}

export function composeAccessibleName(
  parts: Array<string | null | undefined>,
  separator = ', ',
): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(separator)
}

function parseDateInput(value: string): number {
  const parsed = new Date(`${value}T00:00:00`)
  return parsed.getTime()
}

/**
 * Number of calendar days a scheduled event spans when its end date falls on a
 * later day than its start date. Returns 0 for same-day, end-before-start, or
 * unparseable inputs, so callers can treat 0 as "not multi-day".
 */
export function multiDayEventSpan(startDate: string, endDate: string): number {
  const start = parseDateInput(startDate)
  const end = parseDateInput(endDate)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  const dayDiff = Math.round((end - start) / MS_PER_DAY)
  if (dayDiff < 1) return 0
  return dayDiff + 1
}
