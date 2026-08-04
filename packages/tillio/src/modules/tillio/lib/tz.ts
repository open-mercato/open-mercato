export const TILLIO_TIMEZONE = 'Europe/Warsaw'

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type WallClock = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function readWallClock(date: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const wall = readWallClock(date, timeZone)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return asUtc - (date.getTime() - date.getMilliseconds())
}

// Two passes: the first offset is read at the naive instant, which lands in the
// wrong side of a DST transition for wall-clock times near the switch. Reading
// the offset again at the corrected instant settles it.
function zonedWallClockToUtc(
  day: string,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  if (!DAY_PATTERN.test(day)) {
    throw new Error(`[internal] Expected a YYYY-MM-DD day, received "${day}".`)
  }
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  const naive = Date.UTC(year, month - 1, dayOfMonth, hour, minute, second)
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone)
  return new Date(naive - zoneOffsetMs(new Date(firstPass), timeZone))
}

export function zonedDayStart(day: string, timeZone: string = TILLIO_TIMEZONE): Date {
  return zonedWallClockToUtc(day, 0, 0, 0, timeZone)
}

export function zonedDayEnd(day: string, timeZone: string = TILLIO_TIMEZONE): Date {
  return zonedWallClockToUtc(day, 23, 59, 0, timeZone)
}

export function formatTillioTimestamp(date: Date, timeZone: string = TILLIO_TIMEZONE): string {
  const wall = readWallClock(date, timeZone)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`
}

const TZ_SUFFIX_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i
const WALL_CLOCK_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

// Tillio returns `date` in two shapes depending on the operator:
//  - Ringostat: ISO with an explicit offset ("2026-04-11T12:47:28+0200") -> new Date is unambiguous.
//  - Play: a Europe/Warsaw wall-clock time with no zone ("2026-05-09 08:49:39"). `new Date` would
//    read it in the process-local zone, which is wrong on any server that is not Warsaw, so we
//    resolve it explicitly through the Tillio timezone instead.
export function parseTillioTimestamp(
  value: string | null | undefined,
  timeZone: string = TILLIO_TIMEZONE,
): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (TZ_SUFFIX_PATTERN.test(trimmed)) {
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  const match = WALL_CLOCK_PATTERN.exec(trimmed)
  if (match) {
    const [, day, hour, minute, second] = match
    const [year, month, dayOfMonth] = day.split('-').map(Number)
    // Tillio can emit a zeroed/blank stamp ("0000-00-00 00:00:00") for a missing date; it slips
    // past the regex but is not a real calendar day, so treat it as "no timestamp" (matching what
    // `new Date` used to yield here: Invalid Date -> null).
    if (year < 1971 || month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null
    return zonedWallClockToUtc(day, Number(hour), Number(minute), second ? Number(second) : 0, timeZone)
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
