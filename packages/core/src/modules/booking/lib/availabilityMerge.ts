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
  return { startAt, durationMinutes, freq, count }
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

function expandRule(rule: AvailabilityRuleLike, range: AvailabilityRange): AvailabilityWindow[] {
  const parsed = parseRrule(rule.rrule)
  if (!parsed) return []
  const { startAt, durationMinutes, freq, count } = parsed
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
  return rules.flatMap((rule) => expandRule(rule, range)).sort((a, b) => a.start.getTime() - b.start.getTime())
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
  const availabilityRules = params.rules.filter((rule) => rule.kind !== 'unavailability')
  const unavailabilityRules = params.rules.filter((rule) => rule.kind === 'unavailability')
  const availabilityWindows = expandRules(availabilityRules, params.range)
  const unavailabilityWindows = expandRules(unavailabilityRules, params.range)
  if (unavailabilityWindows.length === 0) return availabilityWindows

  const merged = availabilityWindows.flatMap((window) => subtractWindow(window, unavailabilityWindows))
  return merged.sort((a, b) => a.start.getTime() - b.start.getTime())
}
