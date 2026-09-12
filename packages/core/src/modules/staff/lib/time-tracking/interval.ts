export const MINUTES_PER_DAY = 1440

export type IntervalInput = {
  start?: string | null
  end?: string | null
  durationMinutes?: number | null
}

export type ComputedIntervalField = 'start' | 'end' | 'duration' | null

export type DerivedInterval = {
  start: string | null
  end: string | null
  durationMinutes: number | null
  computed: ComputedIntervalField
  crossesMidnight: boolean
}

const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})$/

export function parseClock(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const match = CLOCK_PATTERN.exec(value.trim())
  if (!match) return null
  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function formatClock(minutesOfDay: number): string {
  const normalized = ((Math.round(minutesOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hours = Math.floor(normalized / 60)
  const minutes = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function normalizeDuration(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

export function deriveInterval(input: IntervalInput): DerivedInterval {
  const start = parseClock(input.start)
  const end = parseClock(input.end)
  const duration = normalizeDuration(input.durationMinutes)

  if (start !== null && end !== null) {
    const crossesMidnight = end < start
    const computedDuration = crossesMidnight ? MINUTES_PER_DAY - start + end : end - start
    return {
      start: formatClock(start),
      end: formatClock(end),
      durationMinutes: computedDuration,
      computed: duration === computedDuration ? null : 'duration',
      crossesMidnight,
    }
  }

  if (start !== null && duration !== null) {
    const absoluteEnd = start + duration
    return {
      start: formatClock(start),
      end: formatClock(absoluteEnd),
      durationMinutes: duration,
      computed: 'end',
      crossesMidnight: absoluteEnd >= MINUTES_PER_DAY,
    }
  }

  if (end !== null && duration !== null) {
    const absoluteStart = end - duration
    return {
      start: formatClock(absoluteStart),
      end: formatClock(end),
      durationMinutes: duration,
      computed: 'start',
      crossesMidnight: absoluteStart < 0,
    }
  }

  return {
    start: start === null ? null : formatClock(start),
    end: end === null ? null : formatClock(end),
    durationMinutes: duration,
    computed: null,
    crossesMidnight: false,
  }
}
