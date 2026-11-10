/**
 * The timesheet's sense of "when" (T5.1, US-E1).
 *
 * Everything here is pure date arithmetic on `YYYY-MM-DD` strings, kept out of
 * the React tree so the one rule the user story actually states can be tested as
 * arithmetic: **switching the period kind preserves the current date context.**
 *
 * That rule is why the state this module is driven by is a single ANCHOR DAY
 * rather than a range. A range would have to be re-derived on every switch and
 * the obvious derivation ("take the range start") is exactly the bug US-E1
 * forbids — a month range starting 1 July, switched to `year`, would land on
 * 1 January and the user would be looking at a different part of their life. An
 * anchor never moves on a kind switch, so week↔month↔quarter↔year always stays
 * "around now".
 *
 * Navigation moves the anchor by one unit of the current kind and deliberately
 * does NOT snap it to the period start, for the same reason: after
 * month → previous → week the anchor is still the same day-of-month, so the week
 * shown is the one containing it.
 */

export type TimesheetPeriodKind = 'year' | 'quarter' | 'month' | 'week'

export const TIMESHEET_PERIOD_KINDS: readonly TimesheetPeriodKind[] = ['year', 'quarter', 'month', 'week']

export type TimesheetDateRange = {
  from: string
  to: string
}

const ISO_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function isTimesheetPeriodKind(value: unknown): value is TimesheetPeriodKind {
  return typeof value === 'string' && (TIMESHEET_PERIOD_KINDS as readonly string[]).includes(value)
}

/** Local calendar day of a `Date`, because an entry is addressed by its day and not by an instant. */
export function toIsoDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** `YYYY-MM-DD` → local midnight. Invalid text answers `null` rather than an Invalid Date. */
export function parseIsoDay(value: string): Date | null {
  const match = ISO_DAY_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(year, month - 1, day)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null
  return parsed
}

function safeParse(value: string, fallback: Date): Date {
  return parseIsoDay(value) ?? fallback
}

export function todayIso(now: Date = new Date()): string {
  return toIsoDay(now)
}

export function addDaysIso(iso: string, days: number): string {
  const base = parseIsoDay(iso)
  if (!base) return iso
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
  return toIsoDay(next)
}

/**
 * Adds whole months, clamping the day into the target month — 31 Jan + 1 month is
 * 28/29 Feb, never 2/3 March. Without the clamp, paging forward through the year
 * from a 31st would skip February entirely.
 */
export function addMonthsIso(iso: string, months: number): string {
  const base = parseIsoDay(iso)
  if (!base) return iso
  const targetMonthFirst = new Date(base.getFullYear(), base.getMonth() + months, 1)
  const daysInTarget = new Date(targetMonthFirst.getFullYear(), targetMonthFirst.getMonth() + 1, 0).getDate()
  const day = Math.min(base.getDate(), daysInTarget)
  return toIsoDay(new Date(targetMonthFirst.getFullYear(), targetMonthFirst.getMonth(), day))
}

/** Monday of the week containing `iso` — the module's week starts on Monday everywhere. */
export function startOfWeekIso(iso: string): string {
  const base = parseIsoDay(iso)
  if (!base) return iso
  const weekday = (base.getDay() + 6) % 7
  return addDaysIso(iso, -weekday)
}

export function startOfMonthIso(iso: string): string {
  const base = parseIsoDay(iso)
  if (!base) return iso
  return toIsoDay(new Date(base.getFullYear(), base.getMonth(), 1))
}

export function endOfMonthIso(iso: string): string {
  const base = parseIsoDay(iso)
  if (!base) return iso
  return toIsoDay(new Date(base.getFullYear(), base.getMonth() + 1, 0))
}

export function quarterOfIso(iso: string): number {
  const base = parseIsoDay(iso)
  if (!base) return 1
  return Math.floor(base.getMonth() / 3) + 1
}

/** ISO-8601 week number, matching the mockup's `Tydzień 29`. */
export function isoWeekNumber(iso: string): number {
  const base = parseIsoDay(iso)
  if (!base) return 1
  const utc = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()))
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

export function resolvePeriodRange(kind: TimesheetPeriodKind, anchorIso: string): TimesheetDateRange {
  const base = safeParse(anchorIso, new Date())
  const anchor = toIsoDay(base)
  if (kind === 'week') {
    const from = startOfWeekIso(anchor)
    return { from, to: addDaysIso(from, 6) }
  }
  if (kind === 'month') {
    return { from: startOfMonthIso(anchor), to: endOfMonthIso(anchor) }
  }
  if (kind === 'quarter') {
    const firstMonth = Math.floor(base.getMonth() / 3) * 3
    const from = toIsoDay(new Date(base.getFullYear(), firstMonth, 1))
    const to = toIsoDay(new Date(base.getFullYear(), firstMonth + 3, 0))
    return { from, to }
  }
  return {
    from: toIsoDay(new Date(base.getFullYear(), 0, 1)),
    to: toIsoDay(new Date(base.getFullYear(), 11, 31)),
  }
}

/**
 * One period earlier (`-1`) or later (`+1`), expressed as a new anchor day.
 *
 * The anchor keeps its day-of-month / day-of-week, so paging never drifts and a
 * later kind switch still lands "around" the day the user was looking at.
 */
export function shiftPeriodAnchor(kind: TimesheetPeriodKind, anchorIso: string, direction: 1 | -1): string {
  if (kind === 'week') return addDaysIso(anchorIso, 7 * direction)
  if (kind === 'month') return addMonthsIso(anchorIso, direction)
  if (kind === 'quarter') return addMonthsIso(anchorIso, 3 * direction)
  return addMonthsIso(anchorIso, 12 * direction)
}

export function eachDayIso(range: TimesheetDateRange): string[] {
  const start = parseIsoDay(range.from)
  const end = parseIsoDay(range.to)
  if (!start || !end || end.getTime() < start.getTime()) return []
  const days: string[] = []
  let cursor = range.from
  // Bounded by a year and a bit, so a corrupt range can never spin forever.
  for (let guard = 0; guard < 400; guard += 1) {
    days.push(cursor)
    if (cursor === range.to) break
    cursor = addDaysIso(cursor, 1)
  }
  return days
}

export function isWeekendIso(iso: string): boolean {
  const parsed = parseIsoDay(iso)
  if (!parsed) return false
  const day = parsed.getDay()
  return day === 0 || day === 6
}

/**
 * Mon–Fri days inside the range. Screen 11's footer scales its target by this
 * ("Cel (14 dni × 8h)"), and screen 12 note 4 is explicit that a weekend does not
 * raise the target even though time logged on one still raises the total.
 */
export function countWorkingDays(range: TimesheetDateRange): number {
  return eachDayIso(range).filter((iso) => !isWeekendIso(iso)).length
}

export function periodTargetMinutes(range: TimesheetDateRange, dailyHours: number | null | undefined): number | null {
  if (dailyHours === null || dailyHours === undefined || !Number.isFinite(dailyHours) || dailyHours <= 0) return null
  return Math.round(countWorkingDays(range) * dailyHours * 60)
}

export type TimesheetCalendarCell = {
  date: string
  dayOfMonth: number
  inPeriod: boolean
  isWeekend: boolean
  isToday: boolean
}

/**
 * The month grid of screen 11: whole Monday-to-Sunday weeks covering the month,
 * with the leading/trailing days of the neighbouring months kept as `inPeriod:
 * false` cells so the grid stays rectangular (the mockup draws `29 cze` and
 * `30 cze` in the first row).
 */
export function buildCalendarWeeks(anchorIso: string, todayIsoValue: string = todayIso()): TimesheetCalendarCell[][] {
  const range = resolvePeriodRange('month', anchorIso)
  const gridStart = startOfWeekIso(range.from)
  const lastWeekStart = startOfWeekIso(range.to)
  const gridEnd = addDaysIso(lastWeekStart, 6)
  const days = eachDayIso({ from: gridStart, to: gridEnd })
  const weeks: TimesheetCalendarCell[][] = []
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(
      days.slice(index, index + 7).map((date) => {
        const parsed = parseIsoDay(date)
        return {
          date,
          dayOfMonth: parsed ? parsed.getDate() : 0,
          inPeriod: date >= range.from && date <= range.to,
          isWeekend: isWeekendIso(date),
          isToday: date === todayIsoValue,
        }
      }),
    )
  }
  return weeks
}

function formatWithIntl(date: Date, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date)
  } catch {
    return toIsoDay(date)
  }
}

/**
 * `Lipiec 2026`, `Q3 2026`, `2026`, `13–19 lip 2026 · W29` — the label beside the
 * prev/next arrows. Month and day names come from the runtime locale, the same
 * way every other date in the backoffice is rendered.
 */
export function formatPeriodLabel(
  kind: TimesheetPeriodKind,
  anchorIso: string,
  locale?: string,
): string {
  const range = resolvePeriodRange(kind, anchorIso)
  const from = parseIsoDay(range.from)
  const to = parseIsoDay(range.to)
  if (!from || !to) return anchorIso
  if (kind === 'year') return String(from.getFullYear())
  if (kind === 'quarter') return `Q${quarterOfIso(range.from)} ${from.getFullYear()}`
  if (kind === 'month') {
    const label = formatWithIntl(from, locale, { month: 'long', year: 'numeric' })
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  const fromLabel = formatWithIntl(from, locale, { day: 'numeric', month: 'short' })
  const toLabel = formatWithIntl(to, locale, { day: 'numeric', month: 'short', year: 'numeric' })
  return `${fromLabel} – ${toLabel} · W${isoWeekNumber(range.from)}`
}

/** `pon 13 lip` — the row label of screen 12's day bars. */
export function formatDayLabel(iso: string, locale?: string): string {
  const parsed = parseIsoDay(iso)
  if (!parsed) return iso
  return formatWithIntl(parsed, locale, { weekday: 'short', day: 'numeric', month: 'short' })
}

/** `Piątek 17 lipca` — the heading of an expanded day. */
export function formatLongDayLabel(iso: string, locale?: string): string {
  const parsed = parseIsoDay(iso)
  if (!parsed) return iso
  const label = formatWithIntl(parsed, locale, { weekday: 'long', day: 'numeric', month: 'long' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}
