const MINUTES_PER_DAY = 24 * 60
const MS_PER_MINUTE = 60 * 1000
const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/

export type WallClockParts = { year: number; month: number; day: number; hours: number; minutes: number; seconds: number }

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

export function parseWallClock(value: string): WallClockParts | null {
  const match = WALL_CLOCK_PATTERN.exec(value.trim())
  if (!match) return null
  const [, year, month, day, hours, minutes, seconds] = match
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hours: Number(hours),
    minutes: Number(minutes),
    seconds: seconds ? Number(seconds) : 0,
  }
}

function requireParts(value: string): WallClockParts {
  const parts = parseWallClock(value)
  if (!parts) throw new Error(`[internal] Invalid wall-clock time: ${value}`)
  return parts
}

export function toMinutes(value: string): number {
  const parts = requireParts(value)
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes) / MS_PER_MINUTE)
}

export function fromMinutes(minutes: number): string {
  const date = new Date(minutes * MS_PER_MINUTE)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

export function normalizeWallClock(value: string): string {
  return fromMinutes(toMinutes(value))
}

export function toStoredWallClock(value: string): string {
  return `${normalizeWallClock(value)}:00`
}

export function isWholeMinute(value: string): boolean {
  return requireParts(value).seconds === 0
}

export function isOnTheHour(value: string): boolean {
  const parts = requireParts(value)
  return parts.minutes === 0 && parts.seconds === 0
}

export function datePartOf(value: string): string {
  const parts = requireParts(value)
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
}

export function atMinuteOfDay(date: string, minuteOfDay: number): string {
  return fromMinutes(toMinutes(`${date}T00:00`) + minuteOfDay)
}

export function startOfDay(date: string): string {
  return atMinuteOfDay(date, 0)
}

export function endOfDay(date: string): string {
  return atMinuteOfDay(date, MINUTES_PER_DAY)
}

export function addMinutes(value: string, minutes: number): string {
  return fromMinutes(toMinutes(value) + minutes)
}

export function compareWallClock(left: string, right: string): number {
  return toMinutes(left) - toMinutes(right)
}

export function localNow(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function timeOfDayToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null
  return hours * 60 + minutes
}

export { MINUTES_PER_DAY }
