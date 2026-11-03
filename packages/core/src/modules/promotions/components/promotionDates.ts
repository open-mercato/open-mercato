const PROMOTION_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/

export function promotionCalendarDate(value: string | null): string | null {
  if (!value) return null
  const dateOnly = PROMOTION_DATE_PATTERN.exec(value)?.[1]
  if (!dateOnly) return null
  const date = new Date(`${dateOnly}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateOnly) return null
  return dateOnly
}

export function formatPromotionCalendarDate(
  value: string | null,
  locales?: string | string[],
): string | null {
  const dateOnly = promotionCalendarDate(value)
  if (!dateOnly) return null
  return new Date(`${dateOnly}T00:00:00.000Z`).toLocaleDateString(locales, { timeZone: 'UTC' })
}
