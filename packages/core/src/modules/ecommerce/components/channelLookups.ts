import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('ecommerce').child({ component: 'channel-lookups' })

export type LookupOption = { value: string; label: string; description?: string | null }

export type LookupSource = {
  id: string
  search: (query?: string) => Promise<LookupOption[]>
  resolve: (ids: readonly string[]) => Promise<LookupOption[]>
}

type RemoteItem = Record<string, unknown>

const SEARCH_PAGE_SIZE = '50'
const RESOLVE_PAGE_SIZE = '100'
const TAG_RESOLVE_PAGE_SIZE = '200'

function pickString(item: RemoteItem, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return ''
}

async function loadItems(path: string, params: Record<string, string>): Promise<RemoteItem[]> {
  try {
    const search = new URLSearchParams(params)
    const payload = await readApiResultOrThrow<{ items?: RemoteItem[] }>(`${path}?${search.toString()}`, undefined, {
      fallback: { items: [] },
    })
    return Array.isArray(payload?.items) ? payload.items : []
  } catch (err) {
    logger.warn('ecommerce.channels.lookup.failed', { err, path })
    return []
  }
}

function mapItems(items: RemoteItem[], mapItem: (item: RemoteItem) => LookupOption | null): LookupOption[] {
  return items.map(mapItem).filter((option): option is LookupOption => option !== null)
}

function searchParams(query: string | undefined, pageSize: string): Record<string, string> {
  const trimmed = (query ?? '').trim()
  return trimmed.length > 0 ? { search: trimmed, pageSize } : { pageSize }
}

function createIdsSource(
  id: string,
  path: string,
  mapItem: (item: RemoteItem) => LookupOption | null,
  extraParams: Record<string, string> = {},
): LookupSource {
  return {
    id,
    search: async (query) => mapItems(await loadItems(path, { ...extraParams, ...searchParams(query, SEARCH_PAGE_SIZE) }), mapItem),
    resolve: async (ids) => {
      if (ids.length === 0) return []
      return mapItems(
        await loadItems(path, { ...extraParams, ids: ids.join(','), pageSize: RESOLVE_PAGE_SIZE }),
        mapItem,
      )
    },
  }
}

function withCode(label: string, code: string): string {
  return code && code !== label ? `${label} (${code})` : label
}

export const categoryLookupSource = createIdsSource(
  'categories',
  '/api/catalog/categories',
  (item) => {
    const value = pickString(item, 'id')
    if (!value) return null
    return { value, label: pickString(item, 'pathLabel', 'name') || value }
  },
  { view: 'manage' },
)

export const productLookupSource = createIdsSource('products', '/api/catalog/products', (item) => {
  const value = pickString(item, 'id')
  if (!value) return null
  const sku = pickString(item, 'sku')
  return { value, label: pickString(item, 'title', 'name') || value, description: sku || null }
})

export const salesChannelLookupSource = createIdsSource('sales-channels', '/api/sales/channels', (item) => {
  const value = pickString(item, 'id')
  if (!value) return null
  return { value, label: withCode(pickString(item, 'name') || value, pickString(item, 'code')) }
})

export const priceKindLookupSource = createIdsSource('price-kinds', '/api/catalog/price-kinds', (item) => {
  const value = pickString(item, 'id')
  if (!value) return null
  return { value, label: withCode(pickString(item, 'title', 'name') || value, pickString(item, 'code')) }
})

function mapTag(item: RemoteItem): LookupOption | null {
  const value = pickString(item, 'id')
  if (!value) return null
  return { value, label: pickString(item, 'label') || value }
}

export const tagLookupSource: LookupSource = {
  id: 'tags',
  search: async (query) => mapItems(await loadItems('/api/catalog/tags', searchParams(query, SEARCH_PAGE_SIZE)), mapTag),
  resolve: async (ids) => {
    if (ids.length === 0) return []
    const wanted = new Set(ids)
    const options = mapItems(await loadItems('/api/catalog/tags', { pageSize: TAG_RESOLVE_PAGE_SIZE }), mapTag)
    return options.filter((option) => wanted.has(option.value))
  },
}
