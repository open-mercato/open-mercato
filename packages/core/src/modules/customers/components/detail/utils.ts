"use client"

export function formatDateTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

export function formatDate(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString()
}

export function formatRelativeTime(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const now = Date.now()
  const diffSeconds = (date.getTime() - now) / 1000
  const absSeconds = Math.abs(diffSeconds)
  const rtf =
    typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
      ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
      : null
  const format = (unit: Intl.RelativeTimeFormatUnit, divisor: number) => {
    const valueToFormat = Math.round(diffSeconds / divisor)
    if (rtf) return rtf.format(valueToFormat, unit)
    const suffix = valueToFormat <= 0 ? 'ago' : 'from now'
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

export function toLocalDateTimeInput(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (input: number) => `${input}`.padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}
