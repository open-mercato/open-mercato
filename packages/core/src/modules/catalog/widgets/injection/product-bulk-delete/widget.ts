import type { InjectionBulkActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { SortingState } from '@tanstack/react-table'

type ProductRow = {
  id: string
}

type BulkActionContext = {
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

function readRowId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null
  const value = (row as Record<string, unknown>).id
  return typeof value === 'string' && value.length > 0 ? value : null
}

function buildListParams(context: BulkActionContext): Record<string, string> {
  const params: Record<string, string> = { pageSize: '100' }
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

async function fetchFilteredProductIds(context: BulkActionContext): Promise<string[]> {
  const baseParams = buildListParams(context)
  const productIds = new Set<string>()
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const payload = await fetchCrudList<ProductRow>('catalog/products', {
      ...baseParams,
      page,
    })
    for (const item of payload.items) {
      if (typeof item?.id === 'string' && item.id.length > 0) {
        productIds.add(item.id)
      }
    }
    totalPages = typeof payload.totalPages === 'number' && payload.totalPages > 0 ? payload.totalPages : 1
    page += 1
  }

  return Array.from(productIds)
}

async function startDeleteProductsJob(
  ids: string[],
  scope: 'selected' | 'filtered',
  context: BulkActionContext,
): Promise<string> {
  const translate = context.translate ?? ((_: string, fallback: string) => fallback)
  const result = await apiCall<{ ok: boolean; progressJobId: string | null }>(
    '/api/catalog/bulk-delete',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirm: true,
        ids,
        scope,
      }),
    },
  )

  if (!result.ok || !result.result?.progressJobId) {
    throw new Error(translate('catalog.bulkDelete.error', 'Failed to delete products.'))
  }

  return result.result.progressJobId
}

const widget: InjectionBulkActionWidget = {
  metadata: {
    id: 'catalog.injection.product-bulk-delete',
    priority: 40,
  },
  bulkActions: [
    {
      id: 'catalog.products.bulk-delete-selected',
      label: 'catalog.bulkDelete.selected.label',
      icon: 'trash-2',
      onExecute: async (selectedRows, rawContext) => {
        const context = (rawContext ?? {}) as BulkActionContext
        const translate = context.translate ?? ((_: string, fallback: string) => fallback)
        const ids = selectedRows
          .map((row) => readRowId(row))
          .filter((id): id is string => typeof id === 'string' && id.length > 0)

        if (ids.length === 0) {
          return {
            ok: false,
            message: translate('catalog.bulkDelete.noneSelected', 'Select at least one product to delete.'),
          }
        }

        const confirmed = await context.confirm?.({
          title: translate('catalog.bulkDelete.selected.confirmTitle', 'Delete selected products?'),
          text: translate(
            'catalog.bulkDelete.selected.confirmText',
            'Delete {count} selected products? This cannot be undone.',
            { count: ids.length },
          ),
          confirmText: translate('catalog.bulkDelete.confirm', 'Delete'),
          cancelText: translate('common.cancel', 'Cancel'),
          variant: 'destructive',
        })

        if (confirmed === false) {
          return { ok: false, message: undefined }
        }

        return {
          ok: true,
          progressJobId: await startDeleteProductsJob(ids, 'selected', context),
        }
      },
    },
    {
      id: 'catalog.products.bulk-delete-filtered',
      label: 'catalog.bulkDelete.filtered.label',
      icon: 'filter-x',
      requiresSelection: false,
      onExecute: async (_selectedRows, rawContext) => {
        const context = (rawContext ?? {}) as BulkActionContext
        const translate = context.translate ?? ((_: string, fallback: string) => fallback)
        const ids = await fetchFilteredProductIds(context)

        if (ids.length === 0) {
          return {
            ok: false,
            message: translate('catalog.bulkDelete.noneFiltered', 'No products match the current filters.'),
          }
        }

        const confirmed = await context.confirm?.({
          title: translate('catalog.bulkDelete.filtered.confirmTitle', 'Delete filtered products?'),
          text: translate(
            'catalog.bulkDelete.filtered.confirmText',
            'Delete {count} products matching the current filters? This cannot be undone.',
            { count: ids.length },
          ),
          confirmText: translate('catalog.bulkDelete.confirm', 'Delete'),
          cancelText: translate('common.cancel', 'Cancel'),
          variant: 'destructive',
        })

        if (confirmed === false) {
          return { ok: false, message: undefined }
        }

        return {
          ok: true,
          progressJobId: await startDeleteProductsJob(ids, 'filtered', context),
        }
      },
    },
  ],
}

export default widget
