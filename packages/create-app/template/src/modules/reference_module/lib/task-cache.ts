import type { AwilixContainer } from 'awilix'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import type { ReferenceScope } from '../data/validators'

const CACHE_TTL_MS = 60_000

export type ReferenceTaskSafeCacheValue = {
  id: string
  title: string
  status: string
  priority: number
  dueAt: string | null
  isActive: boolean
  updatedAt: string
}

function resolveCache(container: AwilixContainer): CacheStrategy | null {
  try {
    return container.resolve('cacheService') as CacheStrategy
  } catch {
    return null
  }
}

export function referenceTaskCacheTags(scope: ReferenceScope): string[] {
  return [
    `reference_module:tasks:tenant:${scope.tenantId}`,
    `reference_module:tasks:organization:${scope.organizationId}`,
  ]
}

export async function readReferenceTaskCache<T>(
  container: AwilixContainer,
  scope: ReferenceScope,
  key: string,
): Promise<T | null> {
  const cache = resolveCache(container)
  if (!cache) return null
  try {
    return await runWithCacheTenant(scope.tenantId, async () => {
      const value = await cache.get(`reference_module:${scope.organizationId}:${key}`)
      return value === null ? null : value as T
    })
  } catch {
    return null
  }
}

export async function writeReferenceTaskCache<T>(
  container: AwilixContainer,
  scope: ReferenceScope,
  key: string,
  value: T,
): Promise<void> {
  const cache = resolveCache(container)
  if (!cache) return
  try {
    await runWithCacheTenant(scope.tenantId, () => cache.set(
      `reference_module:${scope.organizationId}:${key}`,
      value,
      { ttl: CACHE_TTL_MS, tags: referenceTaskCacheTags(scope) },
    ))
  } catch {
    return
  }
}

export async function invalidateReferenceTaskCache(
  container: AwilixContainer,
  scope: ReferenceScope,
): Promise<void> {
  const cache = resolveCache(container)
  if (!cache) return
  try {
    await runWithCacheTenant(scope.tenantId, () => cache.deleteByTags(referenceTaskCacheTags(scope)))
  } catch {
    return
  }
}
