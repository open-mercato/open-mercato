import type { CacheStrategy } from '@open-mercato/cache'

const COUNTS_CACHE_PREFIX = 'inbox_ops:counts'
const SETTINGS_CACHE_PREFIX = 'inbox_ops:settings'

// Cache key and tag share the same value intentionally — each tenant has exactly
// one counts entry and one settings entry, so a 1:1 key-to-tag mapping suffices.

export const COUNTS_CACHE_TTL_MS = 30 * 1000
export const SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000

export function createCountsCacheKey(tenantId: string): string {
  return `${COUNTS_CACHE_PREFIX}:${tenantId}`
}

export function createCountsCacheTag(tenantId: string): string {
  return `${COUNTS_CACHE_PREFIX}:${tenantId}`
}

export function createSettingsCacheKey(tenantId: string): string {
  return `${SETTINGS_CACHE_PREFIX}:${tenantId}`
}

export function createSettingsCacheTag(tenantId: string): string {
  return `${SETTINGS_CACHE_PREFIX}:${tenantId}`
}

export async function invalidateCountsCache(
  cache: CacheStrategy | null | undefined,
  tenantId: string,
): Promise<void> {
  if (!cache?.deleteByTags) return
  const tag = createCountsCacheTag(tenantId)
  try {
    await cache.deleteByTags([tag])
  } catch (err) {
    console.warn('[inbox_ops:cache] Failed to invalidate counts cache', err)
  }
}

export async function invalidateSettingsCache(
  cache: CacheStrategy | null | undefined,
  tenantId: string,
): Promise<void> {
  if (!cache?.deleteByTags) return
  const tag = createSettingsCacheTag(tenantId)
  try {
    await cache.deleteByTags([tag])
  } catch (err) {
    console.warn('[inbox_ops:cache] Failed to invalidate settings cache', err)
  }
}

export function resolveCache(container: { resolve: (name: string) => unknown }): CacheStrategy | null {
  try {
    return container.resolve('cache') as CacheStrategy
  } catch {
    return null
  }
}
