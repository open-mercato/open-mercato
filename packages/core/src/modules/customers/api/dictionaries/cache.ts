import type { CacheStrategy } from '@open-mercato/cache'

const CACHE_PREFIX = 'customers:dictionaries'
export const DICTIONARY_CACHE_TTL_MS = 5 * 60 * 1000

type CacheKeyOptions = {
  tenantId: string
  organizationId: string | null
  mappedKind: string
  readableOrganizationIds: string[]
}

type CacheTagOptions = {
  tenantId: string
  mappedKind: string
  organizationIds: string[]
  includeBase?: boolean
}

export function createDictionaryCacheKey(options: CacheKeyOptions): string {
  const scope = options.readableOrganizationIds.join('|')
  const organizationPart = options.organizationId ?? 'all'
  return `${CACHE_PREFIX}:${options.tenantId}:${options.mappedKind}:org=${organizationPart}:scope=${scope}`
}

export function createDictionaryCacheTags(options: CacheTagOptions): string[] {
  const tags = new Set<string>()
  if (options.includeBase !== false) {
    tags.add(`${CACHE_PREFIX}:${options.tenantId}:${options.mappedKind}`)
  }
  for (const orgId of options.organizationIds) {
    if (orgId) {
      tags.add(`${CACHE_PREFIX}:${options.tenantId}:${options.mappedKind}:org:${orgId}`)
    }
  }
  return Array.from(tags)
}

export async function invalidateDictionaryCache(
  cache: CacheStrategy | undefined,
  options: { tenantId: string; mappedKind: string; organizationIds: string[] }
): Promise<void> {
  if (!cache?.deleteByTags) return
  const tags = createDictionaryCacheTags({ ...options, includeBase: false })
  if (!tags.length) return
  try {
    await cache.deleteByTags(tags)
  } catch (err) {
    console.warn('[customers.dictionaries.cache] Failed to invalidate cache', err)
  }
}
