import type { ScheduleItem, ScheduleRange } from './types'

type RuleMetadata = {
  rrule?: string
  exdates?: unknown
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function toDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseRepeat(rrule: string): 'once' | 'daily' | 'weekly' {
  const freqMatch = rrule.match(/FREQ=([A-Z]+)/)
  const countMatch = rrule.match(/COUNT=(\d+)/)
  const freq = freqMatch?.[1]
  const count = countMatch?.[1] ? Number(countMatch[1]) : null
  if (freq === 'WEEKLY') return 'weekly'
  if (freq === 'DAILY') {
    if (count === 1) return 'once'
    return 'daily'
  }
  return 'once'
}

function parseRuleMetadata(item: ScheduleItem): RuleMetadata | null {
  if (!item.metadata || typeof item.metadata !== 'object') return null
  const metadata = item.metadata as { rule?: unknown }
  if (!metadata.rule || typeof metadata.rule !== 'object') return null
  const rule = metadata.rule as RuleMetadata
  if (typeof rule.rrule !== 'string') return null
  return rule
}

function normalizeExdates(exdates: unknown): Set<string> {
  if (!Array.isArray(exdates)) return new Set()
  const keys = exdates
    .map((value) => {
      if (typeof value !== 'string') return null
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) return null
      return toDateKey(parsed)
    })
    .filter((value): value is string => value !== null)
  return new Set(keys)
}

export function expandRecurringItems(items: ScheduleItem[], range: ScheduleRange): ScheduleItem[] {
  const expanded: ScheduleItem[] = []
  const rangeStart = startOfDay(range.start)
  const rangeEnd = startOfDay(range.end)

  items.forEach((item) => {
    const rule = parseRuleMetadata(item)
    if (!rule) {
      expanded.push(item)
      return
    }

    const repeat = parseRepeat(rule.rrule ?? '')
    if (repeat === 'once') {
      expanded.push(item)
      return
    }

    const durationMs = Math.max(0, item.endsAt.getTime() - item.startsAt.getTime())
    const startHours = item.startsAt.getHours()
    const startMinutes = item.startsAt.getMinutes()
    const startSeconds = item.startsAt.getSeconds()
    const startMs = item.startsAt.getMilliseconds()
    const itemStartDay = startOfDay(item.startsAt)
    const exdates = normalizeExdates(rule.exdates)

    for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = new Date(cursor.getTime() + DAY_MS)) {
      if (cursor < itemStartDay) continue
      if (repeat === 'weekly' && cursor.getDay() !== item.startsAt.getDay()) continue
      const dateKey = toDateKey(cursor)
      if (exdates.has(dateKey)) continue
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), startHours, startMinutes, startSeconds, startMs)
      const end = new Date(start.getTime() + durationMs)
      expanded.push({
        ...item,
        id: `${item.id}:${dateKey}`,
        startsAt: start,
        endsAt: end,
      })
    }
  })

  return expanded
}
