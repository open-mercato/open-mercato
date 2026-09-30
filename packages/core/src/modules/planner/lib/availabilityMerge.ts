type AvailabilityKind = 'availability' | 'unavailability'

export type AvailabilityRuleLike = {
  id?: string
  rrule: string
  timezone?: string
  exdates?: string[]
  kind?: AvailabilityKind
  note?: string | null
}

export type AvailabilityRange = {
  start: Date
  end: Date
}

export type AvailabilityWindow = {
  start: Date
  end: Date
  ruleId?: string
}

type ParsedRule = {
  startAt: Date
  durationMinutes: number
  freq: 'DAILY' | 'WEEKLY'
  repeat: 'once' | 'daily' | 'weekly'
  count?: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const timezoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zonedParts(instant: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  let formatter = timezoneFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    if (timezoneFormatters.size >= 64) timezoneFormatters.delete(timezoneFormatters.keys().next().value!)
    timezoneFormatters.set(timezone, formatter)
  }
  const parts = formatter.formatToParts(instant)
  const number = (kind: string) => Number(parts.find((part) => part.type === kind)?.value)
  return { year: number('year'), month: number('month'), day: number('day'), hour: number('hour'), minute: number('minute'), second: number('second') }
}

function zonedWallToInstant(wall: Date, timezone: string): Date | null {
  const target = wall.getTime()
  let candidate = target
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(candidate), timezone)
    const displayed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    const next = candidate + target - displayed
    if (next === candidate) return new Date(candidate)
    candidate = next
  }
  return null
}

function zonedStartOfDay(dayKey: string, timezone: string): Date | null {
  return zonedWallToInstant(new Date(`${dayKey}T00:00:00Z`), timezone)
}

function dayKeyForRule(instant: Date, timezone?: string): string {
  if (!timezone || timezone === 'UTC' || timezone === 'Etc/UTC' || timezone === 'Etc/GMT') return toDayKey(instant)
  const parts = zonedParts(instant, timezone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function parseRrule(rule: string): ParsedRule | null {
  const dtStartMatch = rule.match(/DTSTART[:=](\d{8}T\d{6}Z?)/)
  const durationMatch = rule.match(/DURATION:PT(?:(\d+)H)?(?:(\d+)M)?/)
  const freqMatch = rule.match(/FREQ=([A-Z]+)/)
  if (!dtStartMatch?.[1] || !durationMatch || !freqMatch?.[1]) return null
  const raw = dtStartMatch[1].replace(/Z$/, '')
  const parts = raw.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
  if (!parts) return null
  const [, year, month, day, hour, minute, second] = parts
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  const startAt = new Date(iso)
  if (Number.isNaN(startAt.getTime())) return null

  const hours = durationMatch[1] ? Number(durationMatch[1]) : 0
  const minutes = durationMatch[2] ? Number(durationMatch[2]) : 0
  const durationMinutes = Math.max(1, hours * 60 + minutes)
  const freq = freqMatch[1]
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return null

  const countMatch = rule.match(/COUNT=(\d+)/)
  const count = countMatch?.[1] ? Number(countMatch[1]) : undefined
  const repeat = freq === 'WEEKLY'
    ? 'weekly'
    : freq === 'DAILY' && count === 1
      ? 'once'
      : 'daily'
  return { startAt, durationMinutes, freq, count, repeat }
}

function buildExdateSets(exdates?: string[]) {
  const dateOnly = new Set<string>()
  const dateTime = new Set<number>()
  ;(exdates ?? []).forEach((value) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed) return
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      dateOnly.add(trimmed)
      return
    }
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) {
      dateTime.add(parsed.getTime())
    }
  })
  return { dateOnly, dateTime }
}

function shouldExcludeOccurrence(startAt: Date, exdates?: string[], timezone?: string): boolean {
  const { dateOnly, dateTime } = buildExdateSets(exdates)
  if (dateTime.has(startAt.getTime())) return true
  const dayKey = dayKeyForRule(startAt, timezone)
  return dateOnly.has(dayKey)
}

function toDayKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function startOfDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function expandZonedRule(rule: AvailabilityRuleLike, parsed: ParsedRule, range: AvailabilityRange, weeklyScheduleTemplate: boolean): AvailabilityWindow[] {
  const timezone = rule.timezone!
  const anchor = zonedParts(parsed.startAt, timezone)
  const anchorWall = Date.UTC(anchor.year, anchor.month - 1, anchor.day, anchor.hour, anchor.minute, anchor.second)
  const step = parsed.freq === 'WEEKLY' ? 7 * DAY_MS : DAY_MS
  const duration = parsed.durationMinutes * 60000
  const windows: AvailabilityWindow[] = []
  const rangeAnchor = zonedParts(range.start, timezone)
  const rangeStartWall = Date.UTC(rangeAnchor.year, rangeAnchor.month - 1, rangeAnchor.day, rangeAnchor.hour, rangeAnchor.minute, rangeAnchor.second)
  const rangeOffset = Math.floor((rangeStartWall - duration - DAY_MS - anchorWall) / step)
  const skipped = weeklyScheduleTemplate && parsed.freq === 'WEEKLY' && parsed.count === undefined ? rangeOffset : Math.max(0, rangeOffset)
  let wall = new Date(anchorWall + skipped * step)
  let remaining = (parsed.count ?? Number.POSITIVE_INFINITY) - skipped
  while (wall.getTime() <= range.end.getTime() + DAY_MS && remaining > 0) {
    const start = zonedWallToInstant(wall, timezone)
    if (start && !shouldExcludeOccurrence(start, rule.exdates, timezone)) {
      const end = new Date(start.getTime() + duration)
      if (end > range.start && start < range.end) windows.push({ start, end, ruleId: rule.id })
    }
    wall = new Date(wall.getTime() + step)
    remaining -= 1
  }
  return windows
}

function expandRule(rule: AvailabilityRuleLike, parsed: ParsedRule, range: AvailabilityRange, weeklyScheduleTemplate: boolean): AvailabilityWindow[] {
  const { startAt, durationMinutes, freq, count, repeat } = parsed
  if (repeat === 'once') {
    if (shouldExcludeOccurrence(startAt, rule.exdates, rule.timezone)) return []
    const dayKey = dayKeyForRule(startAt, rule.timezone)
    const start = rule.timezone ? zonedStartOfDay(dayKey, rule.timezone) : startOfDay(startAt)
    if (!start) return []
    const nextDay = new Date(new Date(`${dayKey}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10)
    const end = rule.timezone ? zonedStartOfDay(nextDay, rule.timezone) : new Date(start.getTime() + DAY_MS)
    if (!end) return []
    if (end <= range.start || start >= range.end) return []
    return [{ start, end, ruleId: rule.id }]
  }
  if (rule.timezone && !['UTC', 'Etc/UTC', 'Etc/GMT'].includes(rule.timezone)) {
    return expandZonedRule(rule, parsed, range, weeklyScheduleTemplate)
  }
  const durationMs = durationMinutes * 60000
  const windows: AvailabilityWindow[] = []
  const addWindow = (start: Date) => {
    if (shouldExcludeOccurrence(start, rule.exdates)) return
    const end = new Date(start.getTime() + durationMs)
    if (end <= range.start || start >= range.end) return
    windows.push({ start, end, ruleId: rule.id })
  }

  const step = freq === 'WEEKLY' ? 7 * DAY_MS : DAY_MS
  const rangeOffset = Math.floor((range.start.getTime() - durationMs - startAt.getTime()) / step)
  const skipped = weeklyScheduleTemplate && freq === 'WEEKLY' && count === undefined ? rangeOffset : Math.max(0, rangeOffset)
  let cursor = new Date(startAt.getTime() + skipped * step)
  let remaining = (count ?? Number.POSITIVE_INFINITY) - skipped
  while (cursor < range.end && remaining > 0) {
    addWindow(new Date(cursor))
    cursor = new Date(cursor.getTime() + step)
    remaining -= 1
  }
  return windows
}

function expandRules(rules: AvailabilityRuleLike[], range: AvailabilityRange, weeklyScheduleTemplate: boolean): AvailabilityWindow[] {
  const expanded = rules.flatMap((rule) => {
    const parsed = parseRrule(rule.rrule)
    if (!parsed) return []
    return expandRule(rule, parsed, range, weeklyScheduleTemplate)
  })
  return expanded.sort((a, b) => a.start.getTime() - b.start.getTime())
}

function subtractWindow(window: AvailabilityWindow, blockers: AvailabilityWindow[]): AvailabilityWindow[] {
  let segments = [window]
  blockers.forEach((blocker) => {
    const next: AvailabilityWindow[] = []
    segments.forEach((segment) => {
      if (blocker.end <= segment.start || blocker.start >= segment.end) {
        next.push(segment)
        return
      }
      if (blocker.start > segment.start) {
        next.push({ ...segment, end: new Date(blocker.start) })
      }
      if (blocker.end < segment.end) {
        next.push({ ...segment, start: new Date(blocker.end) })
      }
    })
    segments = next
  })
  return segments
}

export function getMergedAvailabilityWindows(params: {
  rules: AvailabilityRuleLike[]
  range: AvailabilityRange
  respectTimezone?: boolean
  weeklyScheduleTemplate?: boolean
}): AvailabilityWindow[] {
  const rules = params.respectTimezone ? params.rules : params.rules.map((rule) => ({ ...rule, timezone: undefined }))
  const parsedRules = rules
    .map((rule) => {
      const parsed = parseRrule(rule.rrule)
      if (!parsed) return null
      return { rule, parsed }
    })
    .filter((entry): entry is { rule: AvailabilityRuleLike; parsed: ParsedRule } => entry !== null)

  const overrideDays = new Map<string, { kind: AvailabilityKind; dayKey: string; timezone?: string }>()
  parsedRules
    .filter(({ parsed }) => parsed.repeat === 'once')
    .forEach(({ rule, parsed }) => {
      const dayKey = dayKeyForRule(parsed.startAt, rule.timezone)
      const overrideKey = `${rule.timezone ?? 'UTC'}|${dayKey}`
      const kind = rule.kind === 'unavailability' ? 'unavailability' : 'availability'
      if (kind === 'unavailability') {
        overrideDays.set(overrideKey, { kind, dayKey, timezone: rule.timezone })
      } else if (!overrideDays.has(overrideKey)) {
        overrideDays.set(overrideKey, { kind, dayKey, timezone: rule.timezone })
      }
    })

  const availabilityRules = parsedRules
    .filter(({ parsed, rule }) => parsed.repeat !== 'once' && rule.kind !== 'unavailability')
    .map(({ rule }) => rule)
  const unavailabilityRules = parsedRules
    .filter(({ parsed, rule }) => parsed.repeat !== 'once' && rule.kind === 'unavailability')
    .map(({ rule }) => rule)

  const availabilityWindows = availabilityRules.flatMap((rule) =>
    expandRules([rule], params.range, params.weeklyScheduleTemplate === true).filter((window) =>
      !overrideDays.has(`${rule.timezone ?? 'UTC'}|${dayKeyForRule(window.start, rule.timezone)}`)))
  const unavailabilityWindows = expandRules(unavailabilityRules, params.range, params.weeklyScheduleTemplate === true)

  const merged = unavailabilityWindows.length === 0
    ? availabilityWindows
    : availabilityWindows.flatMap((window) => subtractWindow(window, unavailabilityWindows))

  const overrideWindows: AvailabilityWindow[] = []
  overrideDays.forEach(({ kind, dayKey, timezone }) => {
    if (kind !== 'availability') return
    const start = timezone ? zonedStartOfDay(dayKey, timezone) : new Date(`${dayKey}T00:00:00Z`)
    if (!start) return
    if (Number.isNaN(start.getTime())) return
    const nextDay = new Date(new Date(`${dayKey}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10)
    const end = timezone ? zonedStartOfDay(nextDay, timezone) : new Date(start.getTime() + DAY_MS)
    if (!end) return
    if (end <= params.range.start || start >= params.range.end) return
    overrideWindows.push({ start, end })
  })

  return [...merged, ...overrideWindows].sort((a, b) => a.start.getTime() - b.start.getTime())
}
