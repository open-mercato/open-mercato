/**
 * Board filter state (T3.8) — the `dt-chips` row of screen 6.
 *
 * Three filters, and they are deliberately not all the same kind of filter:
 *
 *  - **assignee** narrows on the server. `/api/staff/timesheets/tasks` accepts
 *    `assigneeStaffMemberId`, so the filter goes into the request and the column
 *    totals stay honest.
 *  - **status** does not narrow a request at all — it picks which columns render.
 *    The board already asks one request per column keyed by `taskStatusId`, so
 *    filtering by status is "render this column only", not "add a parameter".
 *    The flat list view has no columns, so there it *is* a request parameter.
 *  - **tag** narrows on the server too, since T7.6 gave `/api/staff/timesheets/tasks`
 *    a `tagIds` parameter (W9). It used to filter loaded rows in the browser, which
 *    made a match on page two invisible and the column badge count depend on how far
 *    the board had been paged. The parameter means **every** listed tag, which is
 *    what the chips have always meant.
 *
 * The split matters for caching: only the server-narrowed part may appear in a
 * react-query key, otherwise flipping a chip would evict and refetch pages whose
 * bytes did not change. `boardServerFilterKey` is that part.
 */

export type BoardFilters = {
  assigneeStaffMemberId: string | null
  taskStatusId: string | null
  tagIds: string[]
}

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  assigneeStaffMemberId: null,
  taskStatusId: null,
  tagIds: [],
}

function readOptionalId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Parses whatever came out of storage, so a hand-edited or stale entry cannot wedge the board. */
export function normalizeBoardFilters(raw: unknown): BoardFilters {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_BOARD_FILTERS }
  const source = raw as Record<string, unknown>
  const tagIds = Array.isArray(source.tagIds)
    ? Array.from(
        new Set(
          source.tagIds
            .map((entry) => readOptionalId(entry))
            .filter((entry): entry is string => entry !== null),
        ),
      )
    : []
  return {
    assigneeStaffMemberId: readOptionalId(source.assigneeStaffMemberId),
    taskStatusId: readOptionalId(source.taskStatusId),
    tagIds,
  }
}

export function countActiveBoardFilters(filters: BoardFilters): number {
  let count = 0
  if (filters.assigneeStaffMemberId) count += 1
  if (filters.taskStatusId) count += 1
  return count + filters.tagIds.length
}

export function hasActiveBoardFilters(filters: BoardFilters): boolean {
  return countActiveBoardFilters(filters) > 0
}

export type BoardFilterScope = {
  /** The flat list view sends the status as a request parameter; the board picks columns instead. */
  includeStatus?: boolean
}

/**
 * The part of the filter state a request actually depends on — and therefore the only
 * part allowed into a react-query key. Tags are ordered so that picking the same two
 * chips in either order shares one cache entry.
 */
export function boardServerFilterKey(filters: BoardFilters, scope: BoardFilterScope = {}): string {
  const parts = [`assignee:${filters.assigneeStaffMemberId ?? ''}`]
  if (scope.includeStatus) parts.push(`status:${filters.taskStatusId ?? ''}`)
  parts.push(`tags:${[...filters.tagIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(',')}`)
  return parts.join('|')
}

/** URL fragment appended to a tasks list request; always starts with `&` or is empty. */
export function boardServerFilterParams(filters: BoardFilters, scope: BoardFilterScope = {}): string {
  let params = ''
  if (filters.assigneeStaffMemberId) {
    params += `&assigneeStaffMemberId=${encodeURIComponent(filters.assigneeStaffMemberId)}`
  }
  if (scope.includeStatus && filters.taskStatusId) {
    params += `&taskStatusId=${encodeURIComponent(filters.taskStatusId)}`
  }
  if (filters.tagIds.length > 0) {
    params += `&tagIds=${encodeURIComponent([...filters.tagIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(','))}`
  }
  return params
}

/** Which columns the board renders under the current status filter. */
export function visibleBoardStatusIds<T extends { id: string }>(
  statuses: readonly T[],
  filters: BoardFilters,
): T[] {
  if (!filters.taskStatusId) return [...statuses]
  return statuses.filter((status) => status.id === filters.taskStatusId)
}

export function withAssigneeFilter(filters: BoardFilters, staffMemberId: string | null): BoardFilters {
  return { ...filters, assigneeStaffMemberId: readOptionalId(staffMemberId) }
}

export function withStatusFilter(filters: BoardFilters, taskStatusId: string | null): BoardFilters {
  return { ...filters, taskStatusId: readOptionalId(taskStatusId) }
}

export function withTagFilter(filters: BoardFilters, tagId: string): BoardFilters {
  if (filters.tagIds.includes(tagId)) return filters
  return { ...filters, tagIds: [...filters.tagIds, tagId] }
}

export function withoutTagFilter(filters: BoardFilters, tagId: string): BoardFilters {
  if (!filters.tagIds.includes(tagId)) return filters
  return { ...filters, tagIds: filters.tagIds.filter((entry) => entry !== tagId) }
}
