export const MAX_DURATION_MINUTES = 1440

export type DurationParseFailureReason = 'empty' | 'unparseable'

export type ParseDurationResult =
  | { ok: true; minutes: number }
  | { ok: false; reason: DurationParseFailureReason }

export type DurationFormatStyle = 'hm' | 'clock' | 'decimal'

const CLOCK_PATTERN = /^(\d{1,3}):([0-5]\d)$/
const UNIT_PATTERN = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+(?:[.,]\d+)?)m(?:in)?)?$/
const BARE_NUMBER_PATTERN = /^\d+(?:[.,]\d+)?$/

function toNumber(value: string): number {
  return Number.parseFloat(value.replace(',', '.'))
}

function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0
  if (minutes < 0) return 0
  if (minutes > MAX_DURATION_MINUTES) return MAX_DURATION_MINUTES
  return Math.round(minutes)
}

export function parseDuration(input: string): ParseDurationResult {
  if (typeof input !== 'string') return { ok: false, reason: 'unparseable' }
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }

  const compact = trimmed.replace(/\s+/g, '').toLowerCase()
  if (compact.startsWith('-')) return { ok: false, reason: 'unparseable' }

  const clock = CLOCK_PATTERN.exec(compact)
  if (clock) {
    const hours = Number.parseInt(clock[1], 10)
    const minutes = Number.parseInt(clock[2], 10)
    return { ok: true, minutes: clampMinutes(hours * 60 + minutes) }
  }

  const units = UNIT_PATTERN.exec(compact)
  if (units && (units[1] !== undefined || units[2] !== undefined)) {
    const hours = units[1] !== undefined ? toNumber(units[1]) : 0
    const minutes = units[2] !== undefined ? toNumber(units[2]) : 0
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return { ok: false, reason: 'unparseable' }
    return { ok: true, minutes: clampMinutes(hours * 60 + minutes) }
  }

  if (BARE_NUMBER_PATTERN.test(compact)) {
    const hours = toNumber(compact)
    if (!Number.isFinite(hours)) return { ok: false, reason: 'unparseable' }
    return { ok: true, minutes: clampMinutes(hours * 60) }
  }

  return { ok: false, reason: 'unparseable' }
}

export function formatDuration(minutes: number, style: DurationFormatStyle): string {
  const safe = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0
  const hours = Math.floor(safe / 60)
  const rest = safe % 60

  if (style === 'clock') return `${hours}:${String(rest).padStart(2, '0')}`
  if (style === 'decimal') return (safe / 60).toFixed(2)
  if (hours === 0) return `${rest}m`
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}
