/**
 * Canonical interval-format rules for recurring schedules.
 *
 * Both the scheduler runtime and the API validators that reject a schedule
 * before it is persisted read the format from here, so the documented format
 * (`<number><unit>`, e.g. `15m`, `1h`, `24h`) cannot drift between the layer
 * that accepts a value and the layer that has to run it.
 */
export const MIN_SCHEDULE_INTERVAL_MS = 60 * 1000

export const SCHEDULE_INTERVAL_PATTERN = /^(\d+)(s|m|h|d)$/

const UNIT_MULTIPLIERS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
}

export type ScheduleIntervalUnit = 's' | 'm' | 'h' | 'd'

export type ScheduleIntervalParts = {
  amount: number
  unit: ScheduleIntervalUnit
}

export function matchScheduleInterval(interval: string): ScheduleIntervalParts | null {
  const match = SCHEDULE_INTERVAL_PATTERN.exec(interval)
  if (!match) return null
  return { amount: Number.parseInt(match[1], 10), unit: match[2] as ScheduleIntervalUnit }
}

export function parseScheduleInterval(interval: string): number {
  const parts = matchScheduleInterval(interval)
  if (!parts) {
    throw new Error(`Invalid interval format: ${interval}. Expected format: <number><unit> (e.g., 15m, 2h, 1d)`)
  }
  return parts.amount * UNIT_MULTIPLIERS[parts.unit]
}

export function isValidScheduleInterval(interval: string): boolean {
  const parts = matchScheduleInterval(interval)
  if (!parts) return false
  return parts.amount * UNIT_MULTIPLIERS[parts.unit] >= MIN_SCHEDULE_INTERVAL_MS
}
