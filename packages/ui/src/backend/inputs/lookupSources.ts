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

export type LookupLoadFailureReason = 'forbidden' | 'failed'

export class LookupLoadError extends Error {
  readonly reason: LookupLoadFailureReason

  constructor(reason: LookupLoadFailureReason, path: string) {
    super(`[internal] lookup load failed (${reason}) for ${path}`)
    this.name = 'LookupLoadError'
    this.reason = reason
  }
}

export function resolveLookupFailureReason(error: unknown): LookupLoadFailureReason {
  if (!error || typeof error !== 'object') return 'failed'
  const candidate = error as { name?: unknown; reason?: unknown }
  return candidate.name === 'LookupLoadError' && candidate.reason === 'forbidden' ? 'forbidden' : 'failed'
}

function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

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
    const status = readErrorStatus(err)
    logger.warn('ui.lookups.load.failed', { err, path, status })
    throw new LookupLoadError(status === 401 || status === 403 ? 'forbidden' : 'failed', path)
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
