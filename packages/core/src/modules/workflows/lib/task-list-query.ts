/**
 * Query-string builder for the user-task inbox list request (PURE).
 *
 * The inbox defaults its view filter to "My Tasks", so every filter the page
 * offers has to reach `GET /api/workflows/tasks`. Forwarding only a subset is
 * silent: the default view claims to show the caller's tasks while listing
 * every task in the organization. Keeping the builder outside the component
 * makes the forwarded set unit-testable.
 */

export type TaskListFilterValues = Record<string, unknown>

export type TaskListPagination = {
  limit: number
  offset: number
}

const TEXT_FILTERS = ['status', 'workflowInstanceId'] as const
const FLAG_FILTERS = ['myTasks', 'overdue'] as const

/**
 * @deprecated The inbox moved to `/backend/work-inbox`; use
 * `buildWorkInboxListQueryParams` from `lib/work-inbox/query.ts`, which forwards
 * the kind/module/entity-type/role filters the Work Inbox adds. Kept exported
 * because import paths are a frozen contract surface
 * (BACKWARD_COMPATIBILITY.md §3) and `GET /api/workflows/tasks` still exists.
 */
export function buildTaskListQueryParams(
  filters: TaskListFilterValues,
  pagination: TaskListPagination,
): URLSearchParams {
  const params = new URLSearchParams()
  params.set('limit', String(pagination.limit))
  params.set('offset', String(pagination.offset))

  for (const key of TEXT_FILTERS) {
    const value = filters[key]
    if (typeof value === 'string' && value.length > 0) params.set(key, value)
  }

  for (const key of FLAG_FILTERS) {
    if (filters[key] === 'true') params.set(key, 'true')
  }

  return params
}
