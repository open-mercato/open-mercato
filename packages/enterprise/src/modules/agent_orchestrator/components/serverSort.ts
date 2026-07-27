import type { SortingState } from '@tanstack/react-table'

/**
 * Server-driven header sorting for the cockpit's server-paginated tables
 * (Traces, Processes). DataTable runs with `manualSorting`, so a header click
 * only updates this state — the actual ordering always comes from the API's
 * whitelisted `sortField`/`sortDir` params. Columns absent from a page's
 * header-sort map are not sortable (`enableSorting: false`), so the header can
 * never advertise an ordering the server does not apply.
 */
export type ServerSort = { field: string; dir: 'asc' | 'desc' }

/** Traces column id → runs-route `sortFieldMap` key. `eval` is deliberately
 * absent: the badge renders `eval_passed` while the server key sorts
 * `eval_score` — close, but not the ordering the column displays. */
export const TRACES_HEADER_SORT_FIELDS: Record<string, string> = {
  agent: 'agentId',
  when: 'createdAt',
  confidence: 'confidence',
  latency: 'latencyMs',
  cost: 'costMinor',
  status: 'status',
}

export const TRACES_DEFAULT_SORT: ServerSort = { field: 'createdAt', dir: 'desc' }

/** Processes column id → processes-route `sortFieldMap` key. Subject/type/
 * stage/agents have no server key and stay unsortable. */
export const PROCESS_HEADER_SORT_FIELDS: Record<string, string> = {
  status: 'status',
  openedAt: 'openedAt',
  costMinor: 'cost',
}

/** Header-click state → server sort; null when the column has no server key. */
export function sortingToServerSort(
  sorting: SortingState,
  fieldMap: Record<string, string>,
): ServerSort | null {
  const first = sorting[0]
  if (!first) return null
  const field = fieldMap[first.id]
  if (!field) return null
  return { field, dir: first.desc ? 'desc' : 'asc' }
}

/** Server sort → controlled DataTable sorting state (empty when the active
 * sort has no matching column, e.g. a toolbar-only sort key). */
export function serverSortToSorting(
  sort: ServerSort | null,
  fieldMap: Record<string, string>,
): SortingState {
  if (!sort) return []
  const columnId = Object.keys(fieldMap).find((id) => fieldMap[id] === sort.field)
  return columnId ? [{ id: columnId, desc: sort.dir === 'desc' }] : []
}
