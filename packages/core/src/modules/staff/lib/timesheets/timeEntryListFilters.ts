import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export type TimeEntryListFilterQuery = {
  ids?: string
  staffMemberId?: string
  from?: string
  to?: string
  projectId?: string
  running?: string
}

const ID_COLUMN = 'id'
const STAFF_MEMBER_COLUMN = 'staff_member_id'
const DATE_COLUMN = 'date'
const STARTED_AT_COLUMN = 'started_at'
const ENDED_AT_COLUMN = 'ended_at'
const PROJECT_COLUMN = 'time_project_id'

export function isParseableDateFilter(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return true
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) return false
  return !Number.isNaN(new Date(trimmed).getTime())
}

/**
 * Builds the query-engine filter map for the time-entries list route.
 *
 * The `running` flag matches the currently-open timer regardless of its date
 * (`started_at IS NOT NULL AND ended_at IS NULL`). A timer started before
 * midnight is still running the next day, so a `from=today&to=today` lookup
 * would miss it and leave the entry invisible/uncontrollable (issue #3717).
 * This mirrors the single-active-timer check in the `start_timer` command so
 * the UI can always surface and stop an orphaned overnight timer.
 */
export function buildTimeEntryListFilters(query: TimeEntryListFilterQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
    const ids = query.ids
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    if (ids.length > 0) {
      filters[ID_COLUMN] = { $in: ids }
    }
  }
  if (typeof query.staffMemberId === 'string' && query.staffMemberId.length > 0) {
    filters[STAFF_MEMBER_COLUMN] = query.staffMemberId
  }
  if (typeof query.from === 'string' && query.from.length > 0 && isParseableDateFilter(query.from)) {
    filters[DATE_COLUMN] = { ...((filters[DATE_COLUMN] as Record<string, unknown>) ?? {}), $gte: query.from }
  }
  if (typeof query.to === 'string' && query.to.length > 0 && isParseableDateFilter(query.to)) {
    filters[DATE_COLUMN] = { ...((filters[DATE_COLUMN] as Record<string, unknown>) ?? {}), $lte: query.to }
  }
  if (typeof query.projectId === 'string' && query.projectId.length > 0) {
    filters[PROJECT_COLUMN] = query.projectId
  }
  if (parseBooleanToken(query.running ?? null) === true) {
    filters[STARTED_AT_COLUMN] = { $ne: null }
    filters[ENDED_AT_COLUMN] = null
  }
  return filters
}
