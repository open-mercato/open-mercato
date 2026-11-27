import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { SortingState } from '@tanstack/react-table'

type ProductRow = {
  id: string
}

const FILTERED_IDS_PAGE_SIZE = 100
const FILTERED_IDS_MAX_PAGES = 1000

export type BulkActionContext = {
  confirm?: (options?: {
    title?: string
    text?: string
    confirmText?: string | false
    cancelText?: string | false
    variant?: 'default' | 'destructive'
  }) => Promise<boolean>
  injectionContext?: {
    search?: string
    filters?: FilterValues
    customFieldset?: string | null
    sorting?: SortingState
  }
  translate?: (key: string, fallback: string, params?: Record<string, string | number>) => string
}

export function readRowId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null
  const value = (row as Record<string, unknown>).id
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function buildListParams(context: BulkActionContext): Record<string, string> {
  const params: Record<string, string> = { pageSize: String(FILTERED_IDS_PAGE_SIZE) }
  const injectionContext = context.injectionContext
  const search = typeof injectionContext?.search === 'string' ? injectionContext.search.trim() : ''
  if (search) params.search = search

  const sorting = Array.isArray(injectionContext?.sorting) ? injectionContext.sorting : []
  const sort = sorting[0]
  if (sort?.id) {
    params.sortField = sort.id
    params.sortDir = sort.desc ? 'desc' : 'asc'
  }

  const filters = injectionContext?.filters
  if (filters && typeof filters === 'object') {
    const status = typeof filters.status === 'string' ? filters.status.trim() : ''
    if (status) params.status = status

    if (filters.isActive === true) params.isActive = 'true'
    if (filters.isActive === false) params.isActive = 'false'
    if (filters.configurable === true) params.configurable = 'true'
    if (filters.configurable === false) params.configurable = 'false'

    const productType = typeof filters.productType === 'string' ? filters.productType.trim() : ''
    if (productType) params.productType = productType

    const listFilters: Array<[string, unknown]> = [
      ['channelIds', filters.channelIds],
      ['categoryIds', filters.categoryIds],
      ['tagIds', filters.tagIds],
    ]
    for (const [key, value] of listFilters) {
      if (!Array.isArray(value) || value.length === 0) continue
      const normalized = value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry): entry is string => entry.length > 0)
      if (normalized.length > 0) params[key] = normalized.join(',')
    }

    for (const [key, value] of Object.entries(filters)) {
      if (!key.startsWith('cf_') || value == null) continue
      if (Array.isArray(value)) {
        const normalized = value
          .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
          .filter((entry) => entry.length > 0)
        if (normalized.length > 0) params[key] = normalized.join(',')
        continue
      }
      if (typeof value === 'object' && value !== null && ('from' in value || 'to' in value)) {
        const range = value as { from?: string; to?: string }
        if (typeof range.from === 'string' && range.from.trim().length > 0) {
          params[`${key}:from`] = range.from.trim()
        }
        if (typeof range.to === 'string' && range.to.trim().length > 0) {
          params[`${key}:to`] = range.to.trim()
        }
        continue
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        params[key] = value.trim()
      }
    }
  }

  const customFieldset =
    typeof injectionContext?.customFieldset === 'string' ? injectionContext.customFieldset.trim() : ''
  if (customFieldset) params.customFieldset = customFieldset

  return params
}

export async function fetchFilteredProductIds(
  context: BulkActionContext,
  options: { stopAfter?: number } = {},
): Promise<string[]> {
  const baseParams = buildListParams(context)
  const productIds = new Set<string>()
  let page = 1

  // Short-page termination: server-reported `totalPages` is a display value, not a loop
  // bound — it can under-report (capped counts) or drift mid-enumeration. Fail closed at
  // the page ceiling: a partial id set would turn "delete all filtered" into "delete the
  // first N" with no signal to the user.
  for (;;) {
    const payload = await fetchCrudList<ProductRow>('catalog/products', {
      ...baseParams,
      page,
    })
    const items = Array.isArray(payload.items) ? payload.items : []
    for (const item of items) {
      if (typeof item?.id === 'string' && item.id.length > 0) {
        productIds.add(item.id)
      }
    }
    if (items.length < FILTERED_IDS_PAGE_SIZE) break
    if (options.stopAfter !== undefined && productIds.size > options.stopAfter) break
    if (page >= FILTERED_IDS_MAX_PAGES) {
      throw new Error(`[internal] filtered product enumeration exceeded ${FILTERED_IDS_MAX_PAGES} pages; refusing to bulk-delete a partial set`)
    }
    page += 1
  }

  return Array.from(productIds)
}

