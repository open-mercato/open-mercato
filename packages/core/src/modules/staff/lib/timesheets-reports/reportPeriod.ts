/**
 * `period_from` / `period_to` are `date` columns, and MikroORM hydrates a `date`
 * column as a `YYYY-MM-DD` string even though the entity declares `Date`. A
 * reader that only accepts `instanceof Date` therefore drops the period on every
 * loaded report, so the sheet and its exports read the value through here.
 */
export function formatReportPeriodDate(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}
