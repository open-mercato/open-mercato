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
    if (rtf) return rtf.format(valueToFormat, unit)

    const fallbackSuffix = valueToFormat <= 0 ? 'ago' : 'from now'
    const suffixKey = valueToFormat <= 0 ? 'time.relative.ago' : 'time.relative.fromNow'
    const suffix = translate ? translate(suffixKey, fallbackSuffix) : fallbackSuffix
    const magnitude = Math.abs(valueToFormat)
    return `${magnitude} ${unit}${magnitude === 1 ? '' : 's'} ${suffix}`
  }

  if (absSeconds < 45) return format('second', 1)
  if (absSeconds < 45 * 60) return format('minute', 60)
  if (absSeconds < 24 * 60 * 60) return format('hour', 60 * 60)
  if (absSeconds < 7 * 24 * 60 * 60) return format('day', 24 * 60 * 60)
  if (absSeconds < 30 * 24 * 60 * 60) return format('week', 7 * 24 * 60 * 60)
  if (absSeconds < 365 * 24 * 60 * 60) return format('month', 30 * 24 * 60 * 60)
  return format('year', 365 * 24 * 60 * 60)
}
