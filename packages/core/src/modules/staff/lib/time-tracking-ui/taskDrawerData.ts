/**
 * Row parsing and arithmetic for the task drawer of screen 7 (T3.7).
 *
 * Split from `TaskDrawer.tsx` for the same reason `kanbanBoardData.ts` is split
 * from the board: the decisions that shape what the drawer *says* — which column
 * a ticked subtask moves to, how the billable split is summed, whether that sum
 * is complete — are unit-testable without a DOM, and the component stays about
 * fetching, mutating and rendering.
 *
 * Board helpers are reused rather than re-derived (`toBoardTask`,
 * `formatBoardMinutes`, `computeSubtaskProgress`), so a task row means the same
 * thing on the card and inside the drawer.
 */

import { formatDuration } from '../time-tracking/duration'
import { readNumber, readString, type BoardApiRow, type BoardStatus } from './kanbanBoardData'

export type DrawerComment = {
  id: string
  body: string
  authorUserId: string | null
  authorName: string | null
  authorEmail: string | null
  createdAt: string | null
}

export type DrawerEntry = {
  id: string
  taskId: string | null
  date: string | null
  description: string | null
  durationMinutes: number
  isBillable: boolean
  /** Present only for a caller holding `staff.timesheets.rates.view`. */
  cost: number | null
  currencyCode: string | null
}

export type EntryTotals = {
  billableMinutes: number
  nonBillableMinutes: number
  /** `null` when the caller may not see money, or when no entry carried a cost. */
  cost: number | null
  currencyCode: string | null
  /** The entries scan hit its page bound, so the split is a lower bound. */
  partial: boolean
}

export function toDrawerComment(row: BoardApiRow): DrawerComment | null {
  const id = readString(row, 'id')
  const body = readString(row, 'body')
  if (!id || !body) return null
  return {
    id,
    body,
    authorUserId: readString(row, 'authorUserId', 'author_user_id'),
    authorName: readString(row, 'authorName', 'author_name'),
    authorEmail: readString(row, 'authorEmail', 'author_email'),
    createdAt: readString(row, 'createdAt', 'created_at'),
  }
}

export function toDrawerEntry(row: BoardApiRow): DrawerEntry | null {
  const id = readString(row, 'id')
  if (!id) return null
  const billable = row.is_billable ?? row.isBillable
  const cost = readNumber(row, 'cost')
  return {
    id,
    taskId: readString(row, 'task_id', 'taskId'),
    date: readString(row, 'date'),
    description: readString(row, 'description', 'notes'),
    durationMinutes: readNumber(row, 'duration_minutes', 'durationMinutes') ?? 0,
    isBillable: billable !== false,
    cost: cost === null ? null : cost,
    currencyCode: readString(row, 'currencyCode', 'rate_currency_code'),
  }
}

/**
 * The billable / non-billable / cost split of screen 7 (note 5).
 *
 * Money only exists in the rows when the caller holds
 * `staff.timesheets.rates.view` — the entries route omits the keys entirely for
 * everyone else — so an absent `cost` stays `null` here instead of becoming a
 * zero that would read as "this work is free".
 */
export function summarizeEntries(entries: readonly DrawerEntry[], partial: boolean): EntryTotals {
  let billableMinutes = 0
  let nonBillableMinutes = 0
  let cost: number | null = null
  let currencyCode: string | null = null
  for (const entry of entries) {
    if (entry.isBillable) billableMinutes += entry.durationMinutes
    else nonBillableMinutes += entry.durationMinutes
    if (entry.cost === null) continue
    cost = (cost ?? 0) + entry.cost
    currencyCode = currencyCode ?? entry.currencyCode
  }
  return { billableMinutes, nonBillableMinutes, cost, currencyCode, partial }
}

/**
 * Ticking a subtask is a status move, not a boolean (D-2): the child goes to the
 * project's first done column, and un-ticking returns it to the default one.
 * A project with no done column cannot express "done" at all, which is why the
 * checkbox is disabled rather than silently writing nothing.
 */
export function resolveDoneStatusId(statuses: readonly BoardStatus[]): string | null {
  return statuses.find((status) => status.isDone)?.id ?? null
}

export function resolveDefaultStatusId(statuses: readonly BoardStatus[]): string | null {
  const flagged = statuses.find((status) => status.isDefault)
  if (flagged) return flagged.id
  return statuses.find((status) => !status.isDone)?.id ?? null
}

/** `01:14:02` — the running-timer label of the mockup's stop button. */
export function formatElapsed(startedAt: string | null | undefined, now: number): string {
  if (!startedAt) return '00:00:00'
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return '00:00:00'
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':')
}

/** `1h 40m` — the own/children split reads as a duration, not as a clock. */
export function formatSplitMinutes(minutes: number): string {
  return formatDuration(Number.isFinite(minutes) && minutes > 0 ? minutes : 0, 'hm')
}

/** The minutes a task's children contributed to its inclusive rollup (D-2). */
export function childMinutes(loggedMinutes: number, ownMinutes: number): number {
  const delta = loggedMinutes - ownMinutes
  return delta > 0 ? delta : 0
}

export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export type EntryClockInput = {
  date: string
  startClock: string | null
  endClock: string | null
  minutes: number
}

export type EntryClocks = { startedAt?: string; endedAt?: string }

function clockToMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim())
  if (!match) return null
  const hours = Number(match[1])
  const mins = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(mins) || hours > 23 || mins > 59) return null
  return hours * 60 + mins
}

function minutesToClock(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`
}

/**
 * Resolves the quick log's optional clocks into a pair, or nothing at all.
 *
 * A lone `started_at` is not a partial record — it is a *running timer*, because
 * `started_at IS NOT NULL AND ended_at IS NULL` is exactly how the entries list
 * identifies one. An entry saved that way reads as a timer running since that
 * moment and cannot be stopped, since no timer segment was ever opened for it.
 *
 * So the missing half is derived from the duration, which is authoritative in the
 * quick log. Both blank means a duration-only entry, which is a legitimate shape.
 */
export function buildEntryClocks({ date, startClock, endClock, minutes }: EntryClockInput): EntryClocks {
  const start = startClock ? clockToMinutes(startClock) : null
  const end = endClock ? clockToMinutes(endClock) : null
  if (start === null && end === null) return {}

  const resolvedStart = start !== null ? start : (end as number) - minutes
  const resolvedEnd = end !== null ? end : (start as number) + minutes

  return {
    startedAt: `${date}T${minutesToClock(resolvedStart)}`,
    endedAt: `${date}T${minutesToClock(resolvedEnd)}`,
  }
}
