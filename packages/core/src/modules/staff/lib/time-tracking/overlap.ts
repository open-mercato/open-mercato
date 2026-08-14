import { MINUTES_PER_DAY, deriveInterval, parseClock } from './interval'

export type OverlapSpan = {
  id?: string | null
  date: string
  start?: string | null
  end?: string | null
  durationMinutes?: number | null
}

export type Overlap = {
  id: string | null
  entry: OverlapSpan
  overlapMinutes: number
}

export type FindOverlapsOptions = {
  excludeId?: string
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const MS_PER_DAY = 86400000

function toEpochDay(date: string | null | undefined): number | null {
  if (typeof date !== 'string') return null
  const match = DATE_ONLY_PATTERN.exec(date.trim())
  if (!match) return null
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (!Number.isFinite(utc)) return null
  return Math.round(utc / MS_PER_DAY)
}

function toAbsoluteSpan(span: OverlapSpan): { start: number; end: number } | null {
  const epochDay = toEpochDay(span?.date)
  if (epochDay === null) return null
  const derived = deriveInterval({
    start: span.start,
    end: span.end,
    durationMinutes: span.durationMinutes,
  })
  const startOfDay = parseClock(derived.start)
  if (startOfDay === null) return null
  const duration = derived.durationMinutes
  if (duration === null || duration <= 0) return null
  const start = epochDay * MINUTES_PER_DAY + startOfDay
  return { start, end: start + duration }
}

export function findOverlaps(
  candidate: OverlapSpan,
  existing: readonly OverlapSpan[],
  opts?: FindOverlapsOptions,
): Overlap[] {
  const candidateSpan = toAbsoluteSpan(candidate)
  if (!candidateSpan) return []

  const excludeId = opts?.excludeId
  const overlaps: Overlap[] = []

  for (const other of existing ?? []) {
    if (!other) continue
    if (excludeId !== undefined && other.id === excludeId) continue
    const otherSpan = toAbsoluteSpan(other)
    if (!otherSpan) continue
    if (candidateSpan.start >= otherSpan.end || otherSpan.start >= candidateSpan.end) continue
    overlaps.push({
      id: other.id ?? null,
      entry: other,
      overlapMinutes:
        Math.min(candidateSpan.end, otherSpan.end) - Math.max(candidateSpan.start, otherSpan.start),
    })
  }

  return overlaps
}
