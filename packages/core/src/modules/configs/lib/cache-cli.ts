import type { CacheStrategy } from '@open-mercato/cache'
import { collectCrudCacheStats, purgeCrudCacheSegment } from '@open-mercato/shared/lib/crud/cache-stats'

export type CachePurgeRequest =
  | { kind: 'all' }
  | { kind: 'segment'; segment: string }
  | { kind: 'tags'; tags: string[] }
  | { kind: 'keys'; keys: string[] }
  | { kind: 'ids'; ids: string[] }
  | { kind: 'pattern'; pattern: string }

export type CachePurgeResult = {
  deleted: number
  keys: string[]
  note: string | null
}

function normalizeUnique(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

async function deleteKeys(cache: CacheStrategy, keys: string[]): Promise<number> {
  let deleted = 0
  for (const key of keys) {
    const removed = await cache.delete(key)
    if (removed) deleted += 1
  }
  return deleted
}

async function resolveIdentifierKeys(cache: CacheStrategy, ids: string[]): Promise<string[]> {
  const matches = new Set<string>()
  for (const id of normalizeUnique(ids)) {
    const keys = await cache.keys(`*${id}*`)
    for (const key of keys) matches.add(key)
  }
  return Array.from(matches).sort((a, b) => a.localeCompare(b))
}

export async function collectCacheStats(cache: CacheStrategy) {
  const stats = await collectCrudCacheStats(cache)
  return {
    generatedAt: stats.generatedAt,
    totalKeys: stats.totalKeys,
    segments: stats.segments.map((segment) => ({
      segment: segment.segment,
      keyCount: segment.keyCount,
      method: segment.method,
      path: segment.path,
      resource: segment.resource,
    })),
  }
}

export async function previewCachePurge(
  cache: CacheStrategy,
  request: CachePurgeRequest,
): Promise<CachePurgeResult> {
  if (request.kind === 'all') {
    const keys = (await cache.keys()).sort((a, b) => a.localeCompare(b))
    return { deleted: keys.length, keys, note: null }
  }

  if (request.kind === 'segment') {
    const stats = await collectCrudCacheStats(cache)
    const target = stats.segments.find((segment) => segment.segment === request.segment)
    return {
      deleted: target?.keys.length ?? 0,
      keys: (target?.keys ?? []).slice().sort((a, b) => a.localeCompare(b)),
      note: target ? null : `Cache segment "${request.segment}" was not found in this scope.`,
    }
  }

  if (request.kind === 'tags') {
    return {
      deleted: 0,
      keys: [],
      note: 'Tag purges do not expose matching keys through the cache interface. Run without `--dry-run` to execute.',
    }
  }

  if (request.kind === 'keys') {
    const requested = normalizeUnique(request.keys)
    const existingKeys = await cache.keys()
    const existingSet = new Set(existingKeys)
    const keys = requested.filter((key) => existingSet.has(key))
    return {
      deleted: keys.length,
      keys,
      note: keys.length === requested.length ? null : 'Some requested keys were not present in this scope.',
    }
  }

  if (request.kind === 'ids') {
    const keys = await resolveIdentifierKeys(cache, request.ids)
    return {
      deleted: keys.length,
      keys,
      note: keys.length > 0 ? null : 'No cache keys matched the requested identifier tokens.',
    }
  }

  const keys = (await cache.keys(request.pattern)).sort((a, b) => a.localeCompare(b))
  return {
    deleted: keys.length,
    keys,
    note: keys.length > 0 ? null : `No cache keys matched pattern "${request.pattern}".`,
  }
}

export async function executeCachePurge(
  cache: CacheStrategy,
  request: CachePurgeRequest,
): Promise<CachePurgeResult> {
  if (request.kind === 'all') {
    const keys = (await cache.keys()).sort((a, b) => a.localeCompare(b))
    const deleted = await cache.clear()
    return { deleted, keys, note: null }
  }

  if (request.kind === 'segment') {
    const result = await purgeCrudCacheSegment(cache, request.segment)
    return {
      deleted: result.deleted,
      keys: result.keys.slice().sort((a, b) => a.localeCompare(b)),
      note: result.keys.length > 0 ? null : `Cache segment "${request.segment}" was not found in this scope.`,
    }
  }

  if (request.kind === 'tags') {
    const deleted = await cache.deleteByTags(normalizeUnique(request.tags))
    return {
      deleted,
      keys: [],
      note: 'Tag purges report counts only because the cache interface does not expose tag-to-key listings.',
    }
  }

  if (request.kind === 'keys') {
    const preview = await previewCachePurge(cache, request)
    const deleted = await deleteKeys(cache, preview.keys)
    return {
      deleted,
      keys: preview.keys,
      note: preview.note,
    }
  }

  if (request.kind === 'ids') {
    const keys = await resolveIdentifierKeys(cache, request.ids)
    const deleted = await deleteKeys(cache, keys)
    return {
      deleted,
      keys,
      note: keys.length > 0 ? null : 'No cache keys matched the requested identifier tokens.',
    }
  }

  const keys = (await cache.keys(request.pattern)).sort((a, b) => a.localeCompare(b))
  const deleted = await deleteKeys(cache, keys)
  return {
    deleted,
    keys,
    note: keys.length > 0 ? null : `No cache keys matched pattern "${request.pattern}".`,
  }
}
