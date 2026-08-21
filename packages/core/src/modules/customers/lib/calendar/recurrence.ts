import { addDays } from 'date-fns/addDays'
import type { CalendarItem, CalendarRange } from '../../components/calendar/types'

const MAX_OCCURRENCES_PER_WINDOW = 100

const WEEKDAY_TOKENS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

const UNTIL_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/

export type ParsedRecurrenceRule = {
  freq: 'DAILY' | 'WEEKLY'
  byDay: number[] | null
  count: number | null
  until: Date | null
}

function parseUntil(value: string): Date | null {
  const match = UNTIL_PATTERN.exec(value)
  if (!match) return null
  const [, year, month, day, hours, minutes, seconds] = match
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)),
  )
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function parseRecurrenceRule(rule: string): ParsedRecurrenceRule | null {
  const parts = rule
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length === 0) return null

  let freq: ParsedRecurrenceRule['freq'] | null = null
  let byDay: number[] | null = null
  let count: number | null = null
  let until: Date | null = null

  for (const part of parts) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) return null
    const key = part.slice(0, separatorIndex).toUpperCase()
    const value = part.slice(separatorIndex + 1)
    if (key === 'FREQ') {
      if (value !== 'DAILY' && value !== 'WEEKLY') return null
      freq = value
    } else if (key === 'BYDAY') {
      const tokens = value
        .split(',')
        .map((token) => token.trim().toUpperCase())
        .filter((token) => token.length > 0)
      if (tokens.length === 0) return null
      const weekdays: number[] = []
      for (const token of tokens) {
        const weekday = WEEKDAY_TOKENS.indexOf(token as (typeof WEEKDAY_TOKENS)[number])
        if (weekday === -1) return null
        weekdays.push(weekday)
      }
      byDay = weekdays
    } else if (key === 'COUNT') {
      const parsedCount = Number(value)
      if (!Number.isInteger(parsedCount) || parsedCount < 1) return null
      count = parsedCount
    } else if (key === 'UNTIL') {
      const parsedUntil = parseUntil(value)
      if (!parsedUntil) return null
      until = parsedUntil
    } else {
      return null
    }
  }

  if (!freq) return null
  return { freq, byDay, count, until }
}

function parseRecurrenceEndTime(rawRecurrenceEnd: string | null | undefined): number | null {
  if (typeof rawRecurrenceEnd !== 'string' || rawRecurrenceEnd.length === 0) return null
  const parsed = new Date(rawRecurrenceEnd)
  if (Number.isNaN(parsed.getTime())) return null
  const endOfDayLocal = new Date(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    23,
    59,
    59,
    999,
  )
  return endOfDayLocal.getTime()
}

function occursOn(date: Date, rule: ParsedRecurrenceRule, seriesStartWeekday: number): boolean {
  if (rule.freq === 'DAILY') return true
  const allowedWeekdays = rule.byDay ?? [seriesStartWeekday]
  return allowedWeekdays.includes(date.getDay())
}

export function expandOccurrences(item: CalendarItem, range: CalendarRange): CalendarItem[] {
  const rawRule = item.raw.recurrenceRule
  if (typeof rawRule !== 'string' || rawRule.trim().length === 0) return [item]
  const rule = parseRecurrenceRule(rawRule)
  if (!rule) return [item]

  const durationMs = item.end.getTime() - item.start.getTime()
  const recurrenceEndTime = parseRecurrenceEndTime(item.raw.recurrenceEnd)
  const untilTime = rule.until ? rule.until.getTime() : null
  const seriesStartWeekday = item.start.getDay()

  const occurrences: CalendarItem[] = []
  let occurrenceIndex = 0
  let cursor = new Date(item.start)

  while (cursor.getTime() <= range.to.getTime()) {
    if (untilTime !== null && cursor.getTime() > untilTime) break
    if (recurrenceEndTime !== null && cursor.getTime() > recurrenceEndTime) break
    if (occursOn(cursor, rule, seriesStartWeekday)) {
      if (rule.count !== null && occurrenceIndex >= rule.count) break
      const occurrenceStart = new Date(cursor)
      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)
      if (occurrenceStart.getTime() <= range.to.getTime() && occurrenceEnd.getTime() > range.from.getTime()) {
        occurrences.push({
          ...item,
          id: `${item.id}:${occurrenceIndex}`,
          start: occurrenceStart,
          end: occurrenceEnd,
          isRecurringOccurrence: true,
        })
        if (occurrences.length >= MAX_OCCURRENCES_PER_WINDOW) break
      }
      occurrenceIndex += 1
    }
    cursor = addDays(cursor, 1)
  }

  return occurrences
}
