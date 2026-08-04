const MINUTES_PER_HOUR = 60

export const MAX_DURATION_MINUTES = 24 * MINUTES_PER_HOUR

export type DurationParseError = 'invalid' | 'out_of_range'

export type DurationParseResult =
  | { ok: true; minutes: number }
  | { ok: false; reason: DurationParseError }

const CLOCK_PATTERN = /^(\d+):([0-5]?\d)$/
const DECIMAL_HOURS_PATTERN = /^\d+(?:[.,]\d+)?$/
const UNIT_PATTERN = /^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+(?:[.,]\d+)?)\s*m(?:in)?)?$/

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replace(',', '.'))
}

function resolveMinutes(rawMinutes: number): DurationParseResult {
  if (!Number.isFinite(rawMinutes)) return { ok: false, reason: 'invalid' }
  const minutes = Math.round(rawMinutes)
  if (minutes < 0) return { ok: false, reason: 'invalid' }
  if (minutes > MAX_DURATION_MINUTES) return { ok: false, reason: 'out_of_range' }
  return { ok: true, minutes }
}

export function parseDurationInput(value: string): DurationParseResult {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return { ok: true, minutes: 0 }

  const clock = CLOCK_PATTERN.exec(normalized)
  if (clock) {
    return resolveMinutes(toNumber(clock[1]) * MINUTES_PER_HOUR + toNumber(clock[2]))
  }

  if (DECIMAL_HOURS_PATTERN.test(normalized)) {
    return resolveMinutes(toNumber(normalized) * MINUTES_PER_HOUR)
  }

  const units = UNIT_PATTERN.exec(normalized)
  if (units && (units[1] !== undefined || units[2] !== undefined)) {
    const hours = units[1] === undefined ? 0 : toNumber(units[1])
    const minutes = units[2] === undefined ? 0 : toNumber(units[2])
    return resolveMinutes(hours * MINUTES_PER_HOUR + minutes)
  }

  return { ok: false, reason: 'invalid' }
}

export function formatMinutesAsDecimal(minutes: number): string {
  if (minutes === 0) return ''
  const hours = minutes / MINUTES_PER_HOUR
  return hours % 1 === 0 ? String(hours) : hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
