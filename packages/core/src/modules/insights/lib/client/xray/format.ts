import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'

export const XRAY_MAP_START_KEY = '__start__'
export const XRAY_MAP_END_KEY = '__end__'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function isUuidLike(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/** A short, non-misleading form of an identifier (first 8 characters of a UUID). */
export function shortId(value: string): string {
  return isUuidLike(value) ? `${value.slice(0, 8)}…` : value
}

function formatActivityValue(value: string, t: TranslateFn): string {
  if (value === 'other') return t('insights.xray.ui.activity.otherValue')
  if (value === 'none') return t('insights.xray.ui.activity.noneValue')
  return shortId(value)
}

/** Server-resolved activity labels of a response (`activityLabels`), keyed by activity key. */
export type XrayActivityLabelMap = Readonly<Record<string, string>> | null | undefined

function serverLabel(key: string, labels: XrayActivityLabelMap): string | null {
  if (!labels || !Object.prototype.hasOwnProperty.call(labels, key)) return null
  const label = labels[key]
  return typeof label === 'string' && label.trim().length > 0 ? label : null
}

/**
 * A readable label of a projected activity key: the server-resolved label of the response
 * (`activityLabels`, translated declaration labels and dictionary / record labels) when present,
 * else a client fallback. Keys are declared identifiers (`created`, `status:won`,
 * `ownerUserId:changed`, `<milestone>.created`), never free text; in the fallback UUID values
 * are shortened (the full key stays available as the title) and the reserved values `other` /
 * `none` are translated. The result is plain text (React escapes it).
 */
export function formatActivityKey(key: string, t: TranslateFn, labels?: XrayActivityLabelMap): string {
  const resolved = serverLabel(key, labels)
  if (resolved) return resolved
  if (key === XRAY_MAP_START_KEY) return t('insights.xray.ui.activity.start')
  if (key === XRAY_MAP_END_KEY) return t('insights.xray.ui.activity.end')
  if (key === 'created') return t('insights.xray.ui.activity.created')
  if (key === 'deleted') return t('insights.xray.ui.activity.deleted')
  const separator = key.indexOf(':')
  if (separator > 0) {
    const field = key.slice(0, separator)
    const value = key.slice(separator + 1)
    if (value === 'changed') return t('insights.xray.ui.activity.fieldChanged', { field })
    if (value.length > 0) return t('insights.xray.ui.activity.fieldValue', { field, value: formatActivityValue(value, t) })
  }
  return key
}

export function formatActivitySequence(keys: readonly string[], t: TranslateFn, labels?: XrayActivityLabelMap): string {
  return keys.map((key) => formatActivityKey(key, t, labels)).join(' → ')
}

export function formatCount(value: number, locale?: string | null): string {
  try {
    return new Intl.NumberFormat(locale ?? undefined).format(value)
  } catch {
    return String(value)
  }
}

export function formatPercent(value: number, locale?: string | null, fractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(locale ?? undefined, { style: 'percent', maximumFractionDigits: fractionDigits, minimumFractionDigits: 0 }).format(value)
  } catch {
    return `${Math.round(value * 100)}%`
  }
}

export function formatDecimal(value: number, locale?: string | null, fractionDigits = 1): string {
  try {
    return new Intl.NumberFormat(locale ?? undefined, { maximumFractionDigits: fractionDigits, minimumFractionDigits: 0 }).format(value)
  } catch {
    return value.toFixed(fractionDigits)
  }
}

/** A compact duration with its two largest units (`3 d 4 h`, `5 h 10 min`, `45 s`). */
export function formatDurationMs(value: number | null | undefined, t: TranslateFn): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
  const days = Math.floor(value / DAY_MS)
  const hours = Math.floor((value % DAY_MS) / HOUR_MS)
  const minutes = Math.floor((value % HOUR_MS) / MINUTE_MS)
  const seconds = Math.round((value % MINUTE_MS) / 1000)
  if (days > 0) {
    return hours > 0
      ? t('insights.xray.ui.duration.daysHours', { days, hours })
      : t('insights.xray.ui.duration.days', { days })
  }
  if (hours > 0) {
    return minutes > 0
      ? t('insights.xray.ui.duration.hoursMinutes', { hours, minutes })
      : t('insights.xray.ui.duration.hours', { hours })
  }
  if (minutes > 0) return t('insights.xray.ui.duration.minutes', { minutes })
  if (value < 1000) return t('insights.xray.ui.duration.underSecond')
  return t('insights.xray.ui.duration.seconds', { seconds })
}

export function formatWindowSeconds(value: number, t: TranslateFn): string {
  return formatDurationMs(value * 1000, t) ?? String(value)
}

/** A timestamp in the viewer's locale and time zone (the browser's). */
export function formatXrayDateTime(value: string | null | undefined, locale?: string | null): string | null {
  if (!value) return null
  return formatDisplayDateTime(value, locale ?? undefined)
}
