import type { BusinessWeekday } from './businessHours'

export type BusinessHoursIntervalRow = {
  key: string
  start: string
  end: string
}

export type BusinessHoursDayRow = {
  weekday: BusinessWeekday
  enabled: boolean
  intervals: BusinessHoursIntervalRow[]
}

export type BusinessHoursHolidayRow = {
  key: string
  date: string
}

export type BusinessHoursFormValue = {
  timezone: string
  days: BusinessHoursDayRow[]
  holidays: BusinessHoursHolidayRow[]
  extras: Record<string, unknown>
  raw: string
  rawDirty: boolean
}

export type BusinessHoursValidationMessages = {
  error: {
    window: string
    holiday: string
  }
}

export type BusinessHoursValidation =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; reason: 'json' }
  | { ok: false; reason: 'rows'; rowErrors: Record<string, string> }

const BUSINESS_HOURS_WEEKDAYS: readonly BusinessWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const BUSINESS_HOURS_DAY_MINUTES = 24 * 60
const BUSINESS_HOURS_DEFAULT_START = '09:00'
const BUSINESS_HOURS_DEFAULT_END = '17:00'
const BUSINESS_HOURS_HOLIDAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function stringifyJsonValue(value: Record<string, unknown> | unknown[] | null): string {
  if (value === null) return ''
  const serialized = JSON.stringify(value, null, 2)
  return typeof serialized === 'string' ? serialized : ''
}

let businessHoursRowSeq = 0

export function nextBusinessHoursRowKey(): string {
  businessHoursRowSeq += 1
  return `business-hours-${businessHoursRowSeq}`
}

export function businessHoursTimeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = match[3] ? Number(match[3]) : 0
  if (minute > 59 || second !== 0) return null
  if (hour === 24 && minute === 0) return BUSINESS_HOURS_DAY_MINUTES
  if (hour > 23) return null
  return hour * 60 + minute
}

export function formatBusinessHoursTime(minutes: number): string {
  if (minutes === BUSINESS_HOURS_DAY_MINUTES) return '24:00'
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function businessHoursEndTimeToMinutes(value: string): number | null {
  const minutes = businessHoursTimeToMinutes(value)
  if (minutes === 0) return BUSINESS_HOURS_DAY_MINUTES
  return minutes
}

export function formatBusinessHoursEndTimeForInput(minutes: number): string {
  if (minutes === BUSINESS_HOURS_DAY_MINUTES) return '00:00'
  return formatBusinessHoursTime(minutes)
}

export function normalizeBusinessHoursEndTime(value: string): string {
  return businessHoursEndTimeToMinutes(value) === BUSINESS_HOURS_DAY_MINUTES ? '24:00' : value
}

export function createBusinessHoursIntervalRow(
  start = BUSINESS_HOURS_DEFAULT_START,
  end = BUSINESS_HOURS_DEFAULT_END,
): BusinessHoursIntervalRow {
  return { key: nextBusinessHoursRowKey(), start, end }
}

export function parseBusinessHoursIntervalRows(value: unknown): BusinessHoursIntervalRow[] {
  if (!Array.isArray(value)) return []
  const intervals: Array<{ startMinutes: number; endMinutes: number }> = []
  for (const rawInterval of value) {
    if (!isRecord(rawInterval)) continue
    const startMinutes = typeof rawInterval.start === 'string' ? businessHoursTimeToMinutes(rawInterval.start) : null
    const endMinutes = typeof rawInterval.end === 'string' ? businessHoursEndTimeToMinutes(rawInterval.end) : null
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) continue
    intervals.push({ startMinutes, endMinutes })
  }
  return intervals
    .sort((left, right) => left.startMinutes - right.startMinutes)
    .map((interval) => createBusinessHoursIntervalRow(
      formatBusinessHoursTime(interval.startMinutes),
      formatBusinessHoursEndTimeForInput(interval.endMinutes),
    ))
}

export function buildBusinessHoursFormValue(record: Record<string, unknown> | null): BusinessHoursFormValue {
  const source = isRecord(record) ? record : null
  const rawWeek = source && isRecord(source.week) ? source.week : null
  const days = BUSINESS_HOURS_WEEKDAYS.map((weekday) => {
    const intervals = rawWeek ? parseBusinessHoursIntervalRows(rawWeek[weekday]) : []
    return {
      weekday,
      enabled: intervals.length > 0,
      intervals: intervals.length ? intervals : [createBusinessHoursIntervalRow()],
    }
  })
  const holidays = Array.isArray(source?.holidays)
    ? source.holidays
        .filter((item): item is string => typeof item === 'string' && BUSINESS_HOURS_HOLIDAY_PATTERN.test(item))
        .map((date) => ({ key: nextBusinessHoursRowKey(), date }))
    : []
  const extras: Record<string, unknown> = {}
  if (source) {
    for (const [key, entry] of Object.entries(source)) {
      if (key === 'timezone' || key === 'week' || key === 'holidays') continue
      extras[key] = entry
    }
  }
  return {
    timezone: typeof source?.timezone === 'string' ? source.timezone.trim() : '',
    days,
    holidays,
    extras,
    raw: stringifyJsonValue(source),
    rawDirty: false,
  }
}

export function serializeBusinessHoursRecord(value: BusinessHoursFormValue): Record<string, unknown> | null {
  const result: Record<string, unknown> = { ...value.extras }
  const timezone = value.timezone.trim()
  if (timezone) result.timezone = timezone
  const week: Partial<Record<BusinessWeekday, Array<{ start: string; end: string }>>> = {}
  for (const day of value.days) {
    if (!day.enabled) continue
    const intervals = day.intervals
      .map((interval) => ({ start: interval.start.trim(), end: normalizeBusinessHoursEndTime(interval.end.trim()) }))
      .filter((interval) => interval.start.length > 0 || interval.end.length > 0)
    if (intervals.length) week[day.weekday] = intervals
  }
  if (Object.keys(week).length) result.week = week
  const holidays = Array.from(new Set(
    value.holidays
      .map((row) => row.date.trim())
      .filter((date) => BUSINESS_HOURS_HOLIDAY_PATTERN.test(date)),
  ))
  if (holidays.length) result.holidays = holidays
  return Object.keys(result).length ? result : null
}

export function validateBusinessHoursValue(
  value: BusinessHoursFormValue,
  translations: BusinessHoursValidationMessages,
): BusinessHoursValidation {
  if (value.rawDirty) return { ok: false, reason: 'json' }
  const rowErrors: Record<string, string> = {}
  for (const day of value.days) {
    if (!day.enabled) continue
    for (const interval of day.intervals) {
      const startMinutes = businessHoursTimeToMinutes(interval.start)
      const endMinutes = businessHoursEndTimeToMinutes(interval.end)
      if (
        startMinutes === null ||
        endMinutes === null ||
        startMinutes >= BUSINESS_HOURS_DAY_MINUTES ||
        endMinutes <= startMinutes
      ) {
        rowErrors[interval.key] = translations.error.window
      }
    }
  }
  for (const holiday of value.holidays) {
    if (!BUSINESS_HOURS_HOLIDAY_PATTERN.test(holiday.date.trim())) {
      rowErrors[holiday.key] = translations.error.holiday
    }
  }
  if (Object.keys(rowErrors).length) return { ok: false, reason: 'rows', rowErrors }
  return { ok: true, value: serializeBusinessHoursRecord(value) }
}
