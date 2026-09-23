/**
 * The reading half of screen 10 — everything the entries list needs that is not
 * React. Kept out of the page so the rules the mockup's notes describe can be
 * tested as arithmetic rather than through a rendered table.
 *
 * Three of those rules live here:
 *
 *  1. **Money is never summed across currencies.** `summarizeTimeEntries`
 *     returns one subtotal PER currency instead of a single number. A tenant
 *     billing one client in PLN and another in EUR would otherwise read a
 *     footer total that is arithmetically valid and financially meaningless.
 *     The renderer decides between "one currency → show it" and "several →
 *     show them apart", but it can never be handed a pre-added figure.
 *  2. **A non-billable entry has no cost, not a zero cost.** The list route
 *     already answers `null` for it (screen 10 note 5); nothing here turns that
 *     into `0`, and the totals skip it rather than adding nothing to a currency
 *     that would then appear in the footer.
 *  3. **The lock and the copy-day refusal are read off the response body, not
 *     off the status code.** `409` covers an optimistic-lock conflict, a locked
 *     entry and a non-empty copy-day target, and each one needs a different
 *     sentence in front of the user.
 */

import {
  clockFromApiValue,
  dateFromApiValue,
  readRowBoolean,
  readRowNumber,
  readRowString,
  type ApiRow,
} from './timeEntryDialogState'

/** The shared refusal code every write path answers when an entry is frozen in a report. */
export const TIME_ENTRY_LOCKED_CODE = 'time_entry_locked'

/** The refusal a second "copy yesterday" click gets instead of a doubled day. */
export const COPY_DAY_TARGET_NOT_EMPTY_CODE = 'copy_day_target_not_empty'

export type TimeEntryListRow = {
  id: string
  date: string
  taskId: string | null
  taskTitle: string | null
  timeProjectId: string | null
  projectLabel: string | null
  description: string | null
  startText: string
  endText: string
  durationMinutes: number
  roundedMinutes: number | null
  isBillable: boolean
  cost: number | null
  currencyCode: string | null
  rateOverrideAmount: number | null
  isLocked: boolean
  lockedReportId: string | null
  updatedAt: string | null
  tagIds: string[]
}

export type TimeEntryDirectory = {
  taskTitles: ReadonlyMap<string, string>
  projectLabels: ReadonlyMap<string, string>
}

export const EMPTY_TIME_ENTRY_DIRECTORY: TimeEntryDirectory = {
  taskTitles: new Map<string, string>(),
  projectLabels: new Map<string, string>(),
}

function readTagIds(row: ApiRow): string[] {
  const tags = Array.isArray(row.tags) ? row.tags : []
  return tags
    .map((tag) => (tag && typeof tag === 'object' ? readRowString(tag as ApiRow, 'id') : null))
    .filter((value): value is string => value !== null)
}

export function toTimeEntryListRow(
  row: ApiRow,
  directory: TimeEntryDirectory = EMPTY_TIME_ENTRY_DIRECTORY,
): TimeEntryListRow | null {
  const id = readRowString(row, 'id')
  if (!id) return null
  const taskId = readRowString(row, 'task_id', 'taskId')
  const timeProjectId = readRowString(row, 'time_project_id', 'timeProjectId')
  return {
    id,
    date: dateFromApiValue(readRowString(row, 'date')),
    taskId,
    taskTitle: taskId ? directory.taskTitles.get(taskId) ?? null : null,
    timeProjectId,
    projectLabel: timeProjectId ? directory.projectLabels.get(timeProjectId) ?? null : null,
    description: readRowString(row, 'description', 'notes'),
    startText: clockFromApiValue(readRowString(row, 'started_at', 'startedAt')),
    endText: clockFromApiValue(readRowString(row, 'ended_at', 'endedAt')),
    durationMinutes: readRowNumber(row, 'duration_minutes', 'durationMinutes') ?? 0,
    roundedMinutes: readRowNumber(row, 'rounded_minutes', 'roundedMinutes'),
    isBillable: readRowBoolean(row, true, 'is_billable', 'isBillable'),
    cost: readRowNumber(row, 'cost'),
    currencyCode: readRowString(row, 'currencyCode', 'rate_currency_code', 'rateCurrencyCode'),
    rateOverrideAmount: readRowNumber(row, 'rate_override_amount', 'rateOverrideAmount'),
    isLocked: readRowBoolean(row, false, 'isLocked', 'is_locked'),
    lockedReportId: readRowString(row, 'lockedReportId', 'locked_report_id'),
    updatedAt: readRowString(row, 'updated_at', 'updatedAt'),
    tagIds: readTagIds(row),
  }
}

export type MoneySubtotal = {
  currencyCode: string | null
  amount: number
}

export type TimeEntriesSummary = {
  visibleCount: number
  totalMinutes: number
  /** One entry per currency present among the priced rows; never pre-added. */
  money: MoneySubtotal[]
}

/**
 * The mockup's `Razem (5 z 23 wpisów) · 15:15 · 4 315,00 PLN`.
 *
 * The time total is the sum of the durations the table SHOWS, so the footer
 * always reconciles against the column above it; cost is the server's `cost`,
 * which is derived from rounded minutes and is therefore not a function of the
 * displayed duration.
 */
export function summarizeTimeEntries(rows: readonly TimeEntryListRow[]): TimeEntriesSummary {
  const byCurrency = new Map<string, MoneySubtotal>()
  let totalMinutes = 0
  for (const row of rows) {
    totalMinutes += Number.isFinite(row.durationMinutes) ? row.durationMinutes : 0
    if (row.cost === null || !Number.isFinite(row.cost)) continue
    const key = row.currencyCode ?? ''
    const current = byCurrency.get(key)
    if (current) current.amount += row.cost
    else byCurrency.set(key, { currencyCode: row.currencyCode ?? null, amount: row.cost })
  }
  return {
    visibleCount: rows.length,
    totalMinutes,
    money: Array.from(byCurrency.values()),
  }
}

type ErrorBag = Record<string, unknown>

/**
 * `raiseCrudError` spreads the response body onto the thrown Error, but a
 * caller that re-wraps it can leave the payload one level down. Both shapes are
 * read so a lock refusal never degrades into "something went wrong".
 */
function errorPayloads(error: unknown): ErrorBag[] {
  if (!error || typeof error !== 'object') return []
  const bags: ErrorBag[] = [error as ErrorBag]
  const nested = (error as { body?: unknown }).body
  if (nested && typeof nested === 'object') bags.push(nested as ErrorBag)
  return bags
}

export function readErrorCode(error: unknown): string | null {
  for (const bag of errorPayloads(error)) {
    if (typeof bag.code === 'string' && bag.code.length > 0) return bag.code
  }
  return null
}

export function readErrorStatus(error: unknown): number | null {
  for (const bag of errorPayloads(error)) {
    if (typeof bag.status === 'number' && Number.isFinite(bag.status)) return bag.status
  }
  return null
}

/**
 * True for the `409 time_entry_locked` every write path answers for an entry a
 * closed report has frozen. `entry_locked` is accepted as well so a route that
 * spells the code without its resource prefix still reads as a lock rather than
 * as a generic failure.
 */
export function isEntryLockedError(error: unknown): boolean {
  const code = readErrorCode(error)
  return code === TIME_ENTRY_LOCKED_CODE || code === 'entry_locked'
}

export type CopyDayTargetConflict = {
  toDate: string | null
  existingEntryCount: number
}

/**
 * The `409 copy_day_target_not_empty` that names what is already on the target
 * day. Returning the count is the whole point: the user has to be told what
 * they would be adding to before they are offered `allowDuplicates`.
 */
export function readCopyDayTargetConflict(error: unknown): CopyDayTargetConflict | null {
  if (readErrorCode(error) !== COPY_DAY_TARGET_NOT_EMPTY_CODE) return null
  for (const bag of errorPayloads(error)) {
    if (bag.code !== COPY_DAY_TARGET_NOT_EMPTY_CODE) continue
    const count = bag.existingEntryCount
    const ids = Array.isArray(bag.existingEntryIds) ? bag.existingEntryIds.length : 0
    return {
      toDate: typeof bag.toDate === 'string' ? bag.toDate : null,
      existingEntryCount: typeof count === 'number' && Number.isFinite(count) ? count : ids,
    }
  }
  return { toDate: null, existingEntryCount: 0 }
}

export type IsoDateRange = {
  from: string
  to: string
}

function toIsoDay(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Monday-to-Sunday, matching the mockup's "Okres: ten tydzień" default. The
 * week is computed in local time because a time entry is addressed by its
 * calendar day, not by an instant.
 */
export function currentWeekRange(now: Date = new Date()): IsoDateRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekday = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - weekday)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { from: toIsoDay(start), to: toIsoDay(end) }
}

/**
 * `pon 20 lip` — the weekday the mockup leads each row with. The locale is left
 * to the runtime by default, exactly as `formatDate`/`formatCurrency` do, so a
 * date on this page reads the same way as a date anywhere else in the backoffice.
 */
export function formatEntryDay(isoDate: string, locale?: string): string {
  if (!isoDate) return ''
  const parsed = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return isoDate
  try {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(parsed)
  } catch {
    return isoDate
  }
}

/** `09:00 – 11:30`, or an em-dash when the entry carries no clock times. */
export function formatEntryClockRange(row: Pick<TimeEntryListRow, 'startText' | 'endText'>): string | null {
  if (!row.startText && !row.endText) return null
  if (row.startText && row.endText) return `${row.startText} – ${row.endText}`
  return row.startText || row.endText
}

export function collectDirectoryIds(rows: readonly TimeEntryListRow[]): {
  taskIds: string[]
  projectIds: string[]
} {
  const taskIds = new Set<string>()
  const projectIds = new Set<string>()
  for (const row of rows) {
    if (row.taskId) taskIds.add(row.taskId)
    if (row.timeProjectId) projectIds.add(row.timeProjectId)
  }
  return { taskIds: Array.from(taskIds), projectIds: Array.from(projectIds) }
}
