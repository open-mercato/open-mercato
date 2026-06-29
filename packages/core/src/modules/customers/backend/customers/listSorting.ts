import type { SortingState } from '@tanstack/react-table'

const CUSTOMER_LIST_SORT_FIELDS: Record<string, string> = {
  name: 'name',
  email: 'primaryEmail',
  status: 'status',
  lifecycleStage: 'lifecycleStage',
  source: 'source',
  nextInteractionAt: 'nextInteractionAt',
}

export function resolveCustomerListSortField(columnId: string): string | null {
  const normalized = columnId.trim()
  if (!normalized) return null
  if (normalized.startsWith('cf:')) return normalized
  if (normalized.startsWith('cf_')) return `cf:${normalized.slice(3)}`
  return CUSTOMER_LIST_SORT_FIELDS[normalized] ?? null
}

export function appendCustomerListSortParams(params: URLSearchParams, sorting: SortingState): void {
  const activeSort = sorting[0]
  if (!activeSort) return
  const sortField = resolveCustomerListSortField(activeSort.id)
  if (!sortField) return
  params.set('sortField', sortField)
  params.set('sortDir', activeSort.desc ? 'desc' : 'asc')
}
