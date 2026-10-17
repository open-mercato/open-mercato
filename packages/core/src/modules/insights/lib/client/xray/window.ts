export const XRAY_PRESET_WINDOWS = ['7d', '30d', '90d'] as const

export type XrayPresetWindow = (typeof XRAY_PRESET_WINDOWS)[number]

export const XRAY_DEFAULT_WINDOW: XrayPresetWindow = '30d'

export const XRAY_CUSTOM_WINDOW_MAX_DAYS = 180

const DAY_MS = 24 * 60 * 60 * 1000

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The analytics window of the X-Ray pages: a default window (calendar days in the organization's
 * configured time zone, served from rollups) or a custom range of local calendar days, inclusive
 * on both ends (`yyyy-MM-dd`), sent as `[start 00:00, end + 1 day 00:00)` in the browser's zone.
 */
export type XrayWindowState =
  | { kind: 'preset'; key: XrayPresetWindow }
  | { kind: 'custom'; start: string; end: string }

export type XrayCustomWindowIssue = 'invalid' | 'order' | 'too_long'

export function isPresetWindow(value: unknown): value is XrayPresetWindow {
  return typeof value === 'string' && (XRAY_PRESET_WINDOWS as readonly string[]).includes(value)
}

/** A local calendar day (`yyyy-MM-dd`) as the `Date` of its local midnight, or `null` when malformed. */
export function parseLocalDay(value: string): Date | null {
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return date
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The local calendar day of a `Date` as `yyyy-MM-dd`. */
export function formatLocalDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The exclusive end instant of a custom window: local midnight after its last day. */
function nextLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
}

/**
 * The instants of a custom window, or the reason it cannot be requested. The length check uses the
 * same rule as the API (`to - from` at most 180 × 24 h), so a range accepted here is never refused
 * with `window_too_large`.
 */
export function resolveCustomWindow(start: string, end: string): { from: string; to: string } | { issue: XrayCustomWindowIssue } {
  const startDate = parseLocalDay(start)
  const endDate = parseLocalDay(end)
  if (!startDate || !endDate) return { issue: 'invalid' }
  if (endDate.getTime() < startDate.getTime()) return { issue: 'order' }
  const toDate = nextLocalMidnight(endDate)
  if (toDate.getTime() - startDate.getTime() > XRAY_CUSTOM_WINDOW_MAX_DAYS * DAY_MS) return { issue: 'too_long' }
  return { from: startDate.toISOString(), to: toDate.toISOString() }
}

export function browserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone.length > 0 && zone.length <= 64 ? zone : null
  } catch {
    return null
  }
}

/**
 * Query parameters of a window. A default window omits the time zone, so the organization's
 * configured zone (and its precomputed rollups) applies; a custom one is labelled in the
 * browser's zone. `null` when a custom window is invalid (nothing is requested then).
 */
export function windowQueryParams(window: XrayWindowState): Record<string, string> | null {
  if (window.kind === 'preset') return { window: window.key }
  const resolved = resolveCustomWindow(window.start, window.end)
  if ('issue' in resolved) return null
  const zone = browserTimeZone()
  return zone ? { from: resolved.from, to: resolved.to, timeZone: zone } : { from: resolved.from, to: resolved.to }
}

/** Serializes a window for the page URL (`w=30d` or `w=2026-01-01..2026-02-01`). */
export function serializeWindow(window: XrayWindowState): string {
  return window.kind === 'preset' ? window.key : `${window.start}..${window.end}`
}

/** Reads a window from the page URL; anything malformed falls back to the default window. */
export function parseWindowParam(value: string | null | undefined): XrayWindowState {
  if (isPresetWindow(value)) return { kind: 'preset', key: value }
  if (typeof value === 'string') {
    const [start, end, ...rest] = value.split('..')
    if (rest.length === 0 && start && end && !('issue' in resolveCustomWindow(start, end))) {
      return { kind: 'custom', start, end }
    }
  }
  return { kind: 'preset', key: XRAY_DEFAULT_WINDOW }
}
