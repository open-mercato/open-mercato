import { formatDate } from './leases/leaseModel'
import { formatWallClockTime } from './bookings/bookingModel'

export type UsageBlockerRow = {
  kind: 'lease' | 'booking'
  id: string
  label: string
  unitId: string
  until: string | null
  startsAt?: string | null
  endsAt?: string | null
  startsOn?: string | null
  endsOn?: string | null
}

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}/

function formatWallClock(value: string, locale: string): string {
  return `${formatDate(value.slice(0, 10), locale)} ${formatWallClockTime(value, locale)}`
}

function bookingRange(startsAt: string, endsAt: string | null | undefined, locale: string): string {
  const start = formatWallClock(startsAt, locale)
  if (!endsAt || !WALL_CLOCK.test(endsAt)) return start
  const end = endsAt.slice(0, 10) === startsAt.slice(0, 10) ? formatWallClockTime(endsAt, locale) : formatWallClock(endsAt, locale)
  return `${start}–${end}`
}

function stripRawSuffix(label: string, raw: string): string {
  const suffix = ` · ${raw.slice(0, 16)}`
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label
}

export function formatUsageBlocker(blocker: UsageBlockerRow, locale: string): string {
  if (blocker.kind === 'booking') {
    if (!blocker.startsAt || !WALL_CLOCK.test(blocker.startsAt)) return blocker.label
    return `${stripRawSuffix(blocker.label, blocker.startsAt)} · ${bookingRange(blocker.startsAt, blocker.endsAt, locale)}`
  }
  if (blocker.startsOn && blocker.endsOn && CALENDAR_DAY.test(blocker.startsOn) && CALENDAR_DAY.test(blocker.endsOn)) {
    return `${blocker.label} · ${formatDate(blocker.startsOn, locale)} — ${formatDate(blocker.endsOn, locale)}`
  }
  if (blocker.until && CALENDAR_DAY.test(blocker.until)) return `${blocker.label} · ${formatDate(blocker.until, locale)}`
  return blocker.label
}
