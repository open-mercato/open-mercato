type AvailabilityKind = 'availability' | 'unavailability'

export type AvailabilityRuleLike = {
  id?: string
  rrule: string
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

function shouldExcludeOccurrence(startAt: Date, exdates?: string[]): boolean {
  const { dateOnly, dateTime } = buildExdateSets(exdates)
  if (dateTime.has(startAt.getTime())) return true
  const dayKey = startAt.toISOString().slice(0, 10)
  return dateOnly.has(dayKey)
}

function toDayKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function expandRule(rule: AvailabilityRuleLike, parsed: ParsedRule, range: AvailabilityRange): AvailabilityWindow[] {
  const { startAt, durationMinutes, freq, count, repeat } = parsed
  if (repeat === 'once') {
    if (shouldExcludeOccurrence(startAt, rule.exdates)) return []
    const start = startOfDay(startAt)
    const end = new Date(start.getTime() + DAY_MS)
    if (end <= range.start || start >= range.end) return []
    return [{ start, end, ruleId: rule.id }]
  }
  const durationMs = durationMinutes * 60000
  const windows: AvailabilityWindow[] = []
  const addWindow = (start: Date) => {
    if (shouldExcludeOccurrence(start, rule.exdates)) return
    const end = new Date(start.getTime() + durationMs)
    if (end <= range.start || start >= range.end) return
    windows.push({ start, end, ruleId: rule.id })
  }

  if (freq === 'DAILY') {
    let cursor = new Date(startAt)
    let remaining = count ?? Number.POSITIVE_INFINITY
    while (cursor < range.end && remaining > 0) {
      addWindow(new Date(cursor))
      cursor = new Date(cursor.getTime() + DAY_MS)
      remaining -= 1
    }
    return windows
  }

  let cursor = new Date(startAt)
  let remaining = count ?? Number.POSITIVE_INFINITY
  if (cursor < range.start) {
    const diffDays = Math.floor((range.start.getTime() - cursor.getTime()) / DAY_MS)
    const weeksToAdd = Math.floor(diffDays / 7)
    if (weeksToAdd > 0) {
      cursor = new Date(cursor.getTime() + weeksToAdd * 7 * DAY_MS)
    }
  }
  while (cursor < range.end && remaining > 0) {
    addWindow(new Date(cursor))
    cursor = new Date(cursor.getTime() + 7 * DAY_MS)
    remaining -= 1
  }
  return windows
}

function expandRules(rules: AvailabilityRuleLike[], range: AvailabilityRange): AvailabilityWindow[] {
  const expanded = rules.flatMap((rule) => {
    const parsed = parseRrule(rule.rrule)
    if (!parsed) return []
    return expandRule(rule, parsed, range)
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
}): AvailabilityWindow[] {
  const parsedRules = params.rules
    .map((rule) => {
      const parsed = parseRrule(rule.rrule)
      if (!parsed) return null
      return { rule, parsed }
    })
    .filter((entry): entry is { rule: AvailabilityRuleLike; parsed: ParsedRule } => entry !== null)

  const overrideDays = new Map<string, AvailabilityKind>()
  parsedRules
    .filter(({ parsed }) => parsed.repeat === 'once')
    .forEach(({ rule, parsed }) => {
      const dayKey = toDayKey(parsed.startAt)
      const kind = rule.kind === 'unavailability' ? 'unavailability' : 'availability'
      if (kind === 'unavailability') {
        overrideDays.set(dayKey, 'unavailability')
      } else if (!overrideDays.has(dayKey)) {
        overrideDays.set(dayKey, 'availability')
      }
    })

  const availabilityRules = parsedRules
    .filter(({ parsed, rule }) => parsed.repeat !== 'once' && rule.kind !== 'unavailability')
    .map(({ rule }) => rule)
  const unavailabilityRules = parsedRules
    .filter(({ parsed, rule }) => parsed.repeat !== 'once' && rule.kind === 'unavailability')
    .map(({ rule }) => rule)

  const availabilityWindows = expandRules(availabilityRules, params.range)
    .filter((window) => !overrideDays.has(toDayKey(window.start)))
  const unavailabilityWindows = expandRules(unavailabilityRules, params.range)

  const merged = unavailabilityWindows.length === 0
    ? availabilityWindows
    : availabilityWindows.flatMap((window) => subtractWindow(window, unavailabilityWindows))

  const overrideWindows: AvailabilityWindow[] = []
  overrideDays.forEach((kind, dayKey) => {
    if (kind !== 'availability') return
    const start = new Date(`${dayKey}T00:00:00`)
    if (Number.isNaN(start.getTime())) return
    const end = new Date(start.getTime() + DAY_MS)
    if (end <= params.range.start || start >= params.range.end) return
    overrideWindows.push({ start, end })
  })

  return [...merged, ...overrideWindows].sort((a, b) => a.start.getTime() - b.start.getTime())
}
