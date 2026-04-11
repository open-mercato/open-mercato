
export function formatDateTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

/**
 * Normalize a date value to the `YYYY-MM-DD` shape expected by
 * `<input type="date">`. Accepts ISO strings, plain date strings, and
 * `Date` instances. When the input already begins with `YYYY-MM-DD`
 * (as `toISOString()` output always does) those characters are taken
 * directly, avoiding any timezone reinterpretation.
 */
export function toDateInputValue(value?: string | Date | null): string | null {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) return null
    return parsed.toISOString().slice(0, 10)
  }
  return null
}
export type RelativeTimeTranslator = (
  key: string,
  fallback?: string,
  params?: Record<string, string | number>
) => string

export type FormatRelativeTimeOptions = {
  translate?: RelativeTimeTranslator
  locale?: string | string[]
}

type RelativeTimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export function formatRelativeTime(
  value?: string | null,
  options?: FormatRelativeTimeOptions
): string | null {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const now = Date.now()
  const diffSeconds = (date.getTime() - now) / 1000
  const absSeconds = Math.abs(diffSeconds)
  const translate = options?.translate

  const rtf =
    typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
      ? new Intl.RelativeTimeFormat(options?.locale, { numeric: 'auto' })
      : null

const format = (unit: RelativeTimeUnit, divisor: number) => {
  const valueToFormat = Math.round(diffSeconds / divisor)
  const isPast = diffSeconds < 0

  if (translate) {
    const suffixKey = isPast ? 'time.relative.ago' : 'time.relative.fromNow'
    const fallbackSuffix = isPast ? 'ago' : 'from now'
    const suffix = translate(suffixKey, fallbackSuffix)
    const magnitude = Math.abs(valueToFormat)
    return `${magnitude} ${unit}${magnitude === 1 ? '' : 's'} ${suffix}`
  }

  if (rtf) return rtf.format(valueToFormat, unit)

  const fallbackSuffix = isPast ? 'ago' : 'from now'
  const magnitude = Math.abs(valueToFormat)
  return `${magnitude} ${unit}${magnitude === 1 ? '' : 's'} ${fallbackSuffix}`
  }

  if (absSeconds < 45) return format('second', 1)
  if (absSeconds < 45 * 60) return format('minute', 60)
  if (absSeconds < 24 * 60 * 60) return format('hour', 60 * 60)
  if (absSeconds < 7 * 24 * 60 * 60) return format('day', 24 * 60 * 60)
  if (absSeconds < 30 * 24 * 60 * 60) return format('week', 7 * 24 * 60 * 60)
  if (absSeconds < 365 * 24 * 60 * 60) return format('month', 30 * 24 * 60 * 60)
  return format('year', 365 * 24 * 60 * 60)
}
