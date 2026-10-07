import { createLogger } from '@open-mercato/shared/lib/logger'
import { readApiResultOrThrow } from '../utils/apiCall'

const logger = createLogger('ui').child({ component: 'lookup-sources' })

export type LookupOption = { value: string; label: string; description?: string | null }

export type LookupSource = {
  id: string
  search: (query?: string) => Promise<LookupOption[]>
  resolve: (ids: readonly string[]) => Promise<LookupOption[]>
}

export type LookupRemoteItem = Record<string, unknown>

const SEARCH_PAGE_SIZE = '50'
const RESOLVE_CHUNK_SIZE = 100

export function pickLookupString(item: LookupRemoteItem, ...keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return ''
}

async function loadItems(path: string, params: Record<string, string>): Promise<LookupRemoteItem[]> {
  try {
    const search = new URLSearchParams(params)
    const payload = await readApiResultOrThrow<{ items?: LookupRemoteItem[] }>(`${path}?${search.toString()}`, undefined, {
      fallback: { items: [] },
    })
    return Array.isArray(payload?.items) ? payload.items : []
  } catch (err) {
    logger.warn('ui.lookups.load.failed', { err, path })
    return []
  }
}

function mapItems(items: LookupRemoteItem[], mapItem: (item: LookupRemoteItem) => LookupOption | null): LookupOption[] {
  return items.map(mapItem).filter((option): option is LookupOption => option !== null)
}

function chunkIds(ids: readonly string[]): string[][] {
  const unique = Array.from(new Set(ids))
  const chunks: string[][] = []
  for (let start = 0; start < unique.length; start += RESOLVE_CHUNK_SIZE) {
    chunks.push(unique.slice(start, start + RESOLVE_CHUNK_SIZE))
  }
  return chunks
}

/** Resolves `ids` through the `?ids=` filter in chunks of at most 100, one request per chunk. */
async function resolveByIds(
  path: string,
  ids: readonly string[],
  mapItem: (item: LookupRemoteItem) => LookupOption | null,
  extraParams: Record<string, string> = {},
): Promise<LookupOption[]> {
  const chunks = chunkIds(ids)
  const pages = await Promise.all(
    chunks.map((chunk) =>
      loadItems(path, { ...extraParams, ids: chunk.join(','), pageSize: String(chunk.length) }),
    ),
  )
  return mapItems(pages.flat(), mapItem)
}

function searchParams(query: string | undefined, pageSize: string): Record<string, string> {
  const trimmed = (query ?? '').trim()
  return trimmed.length > 0 ? { search: trimmed, pageSize } : { pageSize }
}

export function createIdsLookupSource(
  id: string,
  path: string,
  mapItem: (item: LookupRemoteItem) => LookupOption | null,
  extraParams: Record<string, string> = {},
): LookupSource {
  return {
    id,
    search: async (query) => mapItems(await loadItems(path, { ...extraParams, ...searchParams(query, SEARCH_PAGE_SIZE) }), mapItem),
    resolve: (ids) => resolveByIds(path, ids, mapItem, extraParams),
  }
}

export function lookupLabelWithCode(label: string, code: string): string {
  return code && code !== label ? `${label} (${code})` : label
}

export const categoryLookupSource = createIdsLookupSource(
  'categories',
  '/api/catalog/categories',
  (item) => {
    const value = pickLookupString(item, 'id')
    if (!value) return null
    return { value, label: pickLookupString(item, 'pathLabel', 'name') || value }
  },
  { view: 'manage' },
)

export const productLookupSource = createIdsLookupSource('products', '/api/catalog/products', (item) => {
  const value = pickLookupString(item, 'id')
  if (!value) return null
  const sku = pickLookupString(item, 'sku')
  return { value, label: pickLookupString(item, 'title', 'name') || value, description: sku || null }
})

function mapTag(item: LookupRemoteItem): LookupOption | null {
  const value = pickLookupString(item, 'id')
  if (!value) return null
  return { value, label: pickLookupString(item, 'label') || value }
}

export const tagLookupSource: LookupSource = {
  id: 'tags',
  search: async (query) => mapItems(await loadItems('/api/catalog/tags', searchParams(query, SEARCH_PAGE_SIZE)), mapTag),
  resolve: (ids) => resolveByIds('/api/catalog/tags', ids, mapTag),
}
