import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'

export const OMNIBUS_CACHE_TTL_MS = 5 * 60 * 1000

const OMNIBUS_CACHE_PREFIX = 'catalog:omnibus'

const logger = createLogger('catalog')

export type OmnibusCacheScope = {
  tenantId: string
  organizationId: string
}

export type OmnibusCacheTargets = {
  productId?: string | null
  variantId?: string | null
  offerId?: string | null
}

export type OmnibusInvalidationTarget = OmnibusCacheScope & OmnibusCacheTargets

type ContainerLike = { resolve: <T = unknown>(name: string) => T }

export function resolveOmnibusCache(container: ContainerLike | null | undefined): CacheStrategy | null {
  if (!container) return null
  try {
    return container.resolve<CacheStrategy>('cache') ?? null
  } catch {
    return null
  }
}

export function omnibusTenantWideTag(tenantId: string): string {
  return `${OMNIBUS_CACHE_PREFIX}:${tenantId}`
}

export function omnibusTenantTag(scope: OmnibusCacheScope): string {
  return `${OMNIBUS_CACHE_PREFIX}:${scope.tenantId}:${scope.organizationId}`
}

export function omnibusTargetTags(scope: OmnibusCacheScope, targets: OmnibusCacheTargets): string[] {
  const base = omnibusTenantTag(scope)
  const tags: string[] = []
  if (targets.productId) tags.push(`${base}:product:${targets.productId}`)
  if (targets.variantId) tags.push(`${base}:variant:${targets.variantId}`)
  if (targets.offerId) tags.push(`${base}:offer:${targets.offerId}`)
  return tags
}

export function buildOmnibusCacheTags(scope: OmnibusCacheScope, targets: OmnibusCacheTargets): string[] {
  return [omnibusTenantWideTag(scope.tenantId), omnibusTenantTag(scope), ...omnibusTargetTags(scope, targets)]
}

export function buildOmnibusCacheKey(kind: string, parts: Array<string | number | null | undefined>): string {
  return [OMNIBUS_CACHE_PREFIX, 'v1', kind, ...parts.map((part) => (part === null || part === undefined ? '-' : String(part)))].join(':')
}

export async function readOmnibusCache<T>(cache: CacheStrategy | null, tenantId: string, key: string): Promise<T | null> {
  if (!cache) return null
  try {
    const value = await runWithCacheTenant(tenantId, () => cache.get(key))
    return value === null || value === undefined ? null : (value as T)
  } catch {
    return null
  }
}

export async function writeOmnibusCache(
  cache: CacheStrategy | null,
  tenantId: string,
  key: string,
  value: unknown,
  tags: string[],
): Promise<void> {
  if (!cache) return
  try {
    await runWithCacheTenant(tenantId, () => cache.set(key, value, { ttl: OMNIBUS_CACHE_TTL_MS, tags }))
  } catch {}
}

export async function invalidateOmnibusCache(
  cache: CacheStrategy | null | undefined,
  targets: OmnibusInvalidationTarget[],
): Promise<void> {
  if (!cache || !targets.length) return
  const tagsByTenant = new Map<string, Set<string>>()
  for (const target of targets) {
    const tags = omnibusTargetTags(target, target)
    if (!tags.length) continue
    const bucket = tagsByTenant.get(target.tenantId) ?? new Set<string>()
    for (const tag of tags) bucket.add(tag)
    tagsByTenant.set(target.tenantId, bucket)
  }
  for (const [tenantId, tags] of tagsByTenant) {
    try {
      await runWithCacheTenant(tenantId, () => cache.deleteByTags(Array.from(tags)))
    } catch (err) {
      logger.warn('[internal] catalog omnibus cache invalidation failed', { tenantId, err })
    }
  }
}

export async function invalidateOmnibusTenantCache(cache: CacheStrategy | null | undefined, tenantId: string): Promise<void> {
  if (!cache) return
  try {
    await runWithCacheTenant(tenantId, () => cache.deleteByTags([omnibusTenantWideTag(tenantId)]))
  } catch (err) {
    logger.warn('[internal] catalog omnibus tenant cache invalidation failed', { tenantId, err })
  }
}
