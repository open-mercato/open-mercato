const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DAY_MINUTES = 24 * 60

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export type BusinessWeekday = (typeof WEEKDAYS)[number]

export type BusinessHoursInterval = {
  start: string
  end: string
}

export type BusinessHoursConfig = Record<string, unknown> & {
  timezone?: string
  week?: Partial<Record<BusinessWeekday, BusinessHoursInterval[]>>
  holidays?: string[]
}

type TimeInterval = {
  startMinutes: number
  endMinutes: number
}

type LocalParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}

type NormalizedCalendar = {
  timezone: string
  holidays: Set<string>
  week: Map<BusinessWeekday, TimeInterval[]>
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function wallClockMillisBetween(start: Date, end: Date): number {
  return Math.max(0, end.getTime() - start.getTime())
}

function resolveTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return 'UTC'
  const timezone = value.trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return timezone
  } catch {
    return 'UTC'
  }
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
}

function datePartsInTimezone(date: Date, timezone: string): LocalParts {
  const parts = formatterFor(timezone).formatToParts(date)
  const getPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value
    return value ? Number(value) : 0
  }
  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second'),
    millisecond: date.getUTCMilliseconds(),
  }
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = datePartsInTimezone(date, timezone)
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  )
  return localAsUtc - date.getTime()
}

function zonedLocalToUtc(parts: LocalParts, timezone: string): Date {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  )
  const firstOffset = timezoneOffsetMs(new Date(localAsUtc), timezone)
  const firstCandidate = localAsUtc - firstOffset
  const secondOffset = timezoneOffsetMs(new Date(firstCandidate), timezone)
  return new Date(localAsUtc - secondOffset)
}

function dateKeyFromParts(parts: Pick<LocalParts, 'year' | 'month' | 'day'>): string {
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-')
}

function dateKeyFromDayStamp(dayStamp: number): string {
  const date = new Date(dayStamp)
  return dateKeyFromParts({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  })
}

function weekdayFromDayStamp(dayStamp: number): BusinessWeekday {
  return WEEKDAYS[new Date(dayStamp).getUTCDay()]
}

function localDayStamp(date: Date, timezone: string): number {
  const parts = datePartsInTimezone(date, timezone)
  return Date.UTC(parts.year, parts.month - 1, parts.day)
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = match[3] ? Number(match[3]) : 0
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return null
  if (minute < 0 || minute > 59 || second !== 0) return null
  if (hour === 24 && minute === 0 && second === 0) return DAY_MINUTES
  if (hour < 0 || hour > 23) return null
  return hour * 60 + minute
}

function parseIntervals(value: unknown): TimeInterval[] {
  if (!Array.isArray(value)) return []
  const intervals: TimeInterval[] = []
  for (const rawInterval of value) {
    const interval = toRecord(rawInterval)
    if (!interval) continue
    const startMinutes = parseTime(interval.start)
    const endMinutes = parseTime(interval.end)
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue
    intervals.push({ startMinutes, endMinutes })
  }
  return intervals.sort((left, right) => left.startMinutes - right.startMinutes)
}

function parseHolidays(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()
  return new Set(
    value.filter((item): item is string => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item)),
  )
}

function allDayWeek(): Map<BusinessWeekday, TimeInterval[]> {
  return new Map(WEEKDAYS.map((weekday) => [weekday, [{ startMinutes: 0, endMinutes: DAY_MINUTES }]]))
}

function hasAnyInterval(week: Map<BusinessWeekday, TimeInterval[]>): boolean {
  for (const intervals of week.values()) {
    if (intervals.length > 0) return true
  }
  return false
}

function normalizeCalendar(config: BusinessHoursConfig | null | undefined): NormalizedCalendar | null {
  const record = toRecord(config)
  if (!record) return null

  const timezone = resolveTimezone(record.timezone)
  const holidays = parseHolidays(record.holidays)
  const rawWeek = toRecord(record.week)
  const week = new Map<BusinessWeekday, TimeInterval[]>()
  if (rawWeek) {
    for (const weekday of WEEKDAYS) {
      week.set(weekday, parseIntervals(rawWeek[weekday]))
    }
    if (!hasAnyInterval(week)) return null
  } else if (holidays.size > 0) {
    return { timezone, holidays, week: allDayWeek() }
  } else {
    return null
  }

  return { timezone, holidays, week }
}

function localDateTimeForDay(dayStamp: number, minuteOfDay: number, timezone: string): Date {
  const dayOffset = Math.floor(minuteOfDay / DAY_MINUTES)
  const minutes = minuteOfDay % DAY_MINUTES
  const date = new Date(dayStamp + dayOffset * DAY_MS)
  return zonedLocalToUtc({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
    second: 0,
    millisecond: 0,
  }, timezone)
}

export function businessMillisBetween(
  start: Date,
  end: Date,
  config: BusinessHoursConfig | null | undefined,
): number {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0
  if (end.getTime() <= start.getTime()) return 0

  const calendar = normalizeCalendar(config)
  if (!calendar) return wallClockMillisBetween(start, end)

  const firstDay = localDayStamp(start, calendar.timezone)
  const lastDay = localDayStamp(end, calendar.timezone)
  let elapsed = 0

  for (let dayStamp = firstDay; dayStamp <= lastDay; dayStamp += DAY_MS) {
    const dateKey = dateKeyFromDayStamp(dayStamp)
    if (calendar.holidays.has(dateKey)) continue

    const intervals = calendar.week.get(weekdayFromDayStamp(dayStamp)) ?? []
    for (const interval of intervals) {
      const intervalStart = localDateTimeForDay(dayStamp, interval.startMinutes, calendar.timezone)
      const intervalEnd = localDateTimeForDay(dayStamp, interval.endMinutes, calendar.timezone)
      const overlapStart = Math.max(start.getTime(), intervalStart.getTime())
      const overlapEnd = Math.min(end.getTime(), intervalEnd.getTime())
      if (overlapEnd > overlapStart) elapsed += overlapEnd - overlapStart
    }
  }

  return elapsed
}

export function slaProgressPct(
  submittedAt: Date,
  now: Date,
  slaHours: number,
  config: BusinessHoursConfig | null | undefined,
): number {
  if (!Number.isFinite(slaHours) || slaHours <= 0) return 0
  const elapsed = businessMillisBetween(submittedAt, now, config)
  return (elapsed / (slaHours * 60 * 60 * 1000)) * 100
}
