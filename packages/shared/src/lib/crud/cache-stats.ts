import type { CacheStrategy } from '@open-mercato/cache'
import { analyzeCacheSegments, purgeCacheSegment } from '../cache/segments'

export type CrudCacheSegmentInfo = {
  segment: string
  resource: string | null
  method: string | null
  path: string | null
  keyCount: number
  keys: string[]
}

export type CrudCacheStats = {
  generatedAt: string
  segments: CrudCacheSegmentInfo[]
  totalKeys: number
}

const CRUD_CACHE_PATTERN = 'crud|*'
const WIDGET_CACHE_PATTERN = 'widget-data:*'
const WIDGET_CACHE_SEGMENT = 'widget-data'
export const CRUD_CACHE_STATS_KEY = 'crud-cache-stats'

function sanitizeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9:_/|-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizePathSegment(path: string | null | undefined, resource: string | null | undefined): string | null {
  if (!path) return null
  let trimmed = path.trim()
  if (!trimmed) return null
  trimmed = trimmed.replace(/^https?:\/\/[^/]+/i, '')
  trimmed = trimmed.replace(/^\/+/, '')
  if (trimmed.startsWith('backend/')) trimmed = trimmed.slice('backend/'.length)
  if (trimmed.startsWith('api/')) trimmed = trimmed.slice('api/'.length)
  trimmed = trimmed.replace(/^\/+/, '').replace(/\/+/g, '/')
  trimmed = trimmed.replace(/\/$/, '')
  if (!trimmed) return null
  const segments = trimmed.split('/').filter(Boolean)
  if (!segments.length) return null
  const resourceSegments = resource ? resource.split('.').filter(Boolean) : []
  if (resourceSegments.length && segments[0] === resourceSegments[0]) {
    segments.shift()
  }
  const formatted = segments.join('-')
  return formatted.length ? sanitizeSegment(formatted) : null
}

function parseCrudCacheKey(key: string): {
  resource: string | null
  method: string | null
  path: string | null
  segment: string | null
} {
  const parts = key.split('|')
  if (parts.length < 4) {
    return { resource: null, method: null, path: null, segment: null }
  }
  const resource = parts[1] ?? null
  const method = parts[2] ?? null
  const path = parts[3] ?? null
  const normalizedPath = normalizePathSegment(path, resource)
  const fallback = resource ? sanitizeSegment(resource.replace(/[.]/g, '-')) : null
  const segment = normalizedPath ?? fallback
  return {
    resource,
    method,
    path,
    segment,
  }
}

function parseWidgetCacheKey(key: string): {
  resource: string | null
  method: string | null
  path: string | null
  segment: string | null
} {
  if (!key.startsWith('widget-data:')) {
    return { resource: null, method: null, path: null, segment: null }
  }
  return {
    segment: WIDGET_CACHE_SEGMENT,
    resource: 'dashboards.widgets',
    method: 'POST',
    path: '/api/dashboards/widgets/data',
  }
}

export function deriveCrudSegmentTag(resource: string, request: Request): string {
  const url = new URL(request.url)
  const pathSegment = normalizePathSegment(url.pathname, resource)
  const fallback = sanitizeSegment(resource.replace(/[.]/g, '-'))
  const finalSegment = pathSegment ?? fallback
  return finalSegment || 'crud-root'
}

export async function collectCrudCacheStats(cache: CacheStrategy): Promise<CrudCacheStats> {
  const crudAnalyses = await analyzeCacheSegments(cache, {
    keysPattern: CRUD_CACHE_PATTERN,
    deriveSegment: (key) => parseCrudCacheKey(key).segment,
    filterKey: (key) => key !== CRUD_CACHE_STATS_KEY,
  })

  const crudSegments: CrudCacheSegmentInfo[] = crudAnalyses.map(({ segment, keys }) => {
    const sample = keys[0] ?? null
    const details = sample ? parseCrudCacheKey(sample) : { resource: null, method: null, path: null, segment: null }
    return {
      segment,
      resource: details.resource,
      method: details.method,
      path: details.path,
      keyCount: keys.length,
      keys,
    }
  })

  const widgetAnalyses = await analyzeCacheSegments(cache, {
    keysPattern: WIDGET_CACHE_PATTERN,
    deriveSegment: (key) => parseWidgetCacheKey(key).segment,
  })

  const widgetSegments: CrudCacheSegmentInfo[] = widgetAnalyses.map(({ segment, keys }) => {
    const sample = keys[0] ?? null
    const details = sample ? parseWidgetCacheKey(sample) : { resource: null, method: null, path: null, segment: null }
    return {
      segment,
      resource: details.resource,
      method: details.method,
      path: details.path,
      keyCount: keys.length,
      keys,
    }
  })

  const segments = [...crudSegments, ...widgetSegments].sort((a, b) => a.segment.localeCompare(b.segment))
  const stats: CrudCacheStats = {
    generatedAt: new Date().toISOString(),
    segments,
    totalKeys: segments.reduce((sum, entry) => sum + entry.keyCount, 0),
  }

  try {
    await cache.set(CRUD_CACHE_STATS_KEY, stats, { tags: ['crud-cache-stats'] })
  } catch {
    // best effort write; ignore failure
  }

  return stats
}

export async function purgeCrudCacheSegment(cache: CacheStrategy, segment: string): Promise<{ deleted: number; keys: string[] }> {
  if (segment === WIDGET_CACHE_SEGMENT) {
    return purgeCacheSegment(
      cache,
      {
        keysPattern: WIDGET_CACHE_PATTERN,
        deriveSegment: (key) => parseWidgetCacheKey(key).segment,
      },
      segment,
    )
  }
  return purgeCacheSegment(
    cache,
    {
      keysPattern: CRUD_CACHE_PATTERN,
      deriveSegment: (key) => parseCrudCacheKey(key).segment,
      filterKey: (key) => key !== CRUD_CACHE_STATS_KEY,
    },
    segment,
  )
}
