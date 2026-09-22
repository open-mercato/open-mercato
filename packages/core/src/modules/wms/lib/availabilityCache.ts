/**
 * Read-through cache for `wms`'s `AvailabilityProvider` — §6 staleness
 * budget (60s TTL for a browse-time `check`, never cached for
 * `query.bypassCache`), tag-based invalidation on `wms` balance changes.
 *
 * Tag granularity is a deliberate deviation from §6's literal
 * `availability:{tenantId}:{variantId}` naming: this module already has a
 * coarse, tenant-scoped tag for the same purpose
 * (`enricherCacheTags.ts`'s `WMS_INVENTORY_CACHE_TAG`), justified there as
 * "collection tags over-invalidate slightly; a per-warehouse scheme the
 * write side could miss would under-invalidate, which is the failure that
 * actually shows wrong stock to a user." The same reasoning applies here, so
 * `WMS_AVAILABILITY_CACHE_TAG` follows that established precedent rather
 * than a literal per-variant tag. `runWithCacheTenant` already scopes both
 * keys and tags to the current tenant (`packages/cache/src/service.ts`), so
 * neither needs `tenantId` embedded manually.
 */

import { runWithCacheTenant } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { availabilityItemKey } from '@open-mercato/shared/lib/availability'
import type { AvailabilityItemResult, AvailabilityQuery, AvailabilityResult } from '@open-mercato/shared/lib/availability'
import type { EntityManager } from '@mikro-orm/postgresql'
import { computeAvailability } from './availabilityCalculation'

export const WMS_AVAILABILITY_CACHE_TAG = 'wms:availability'
/** §6 staleness budget: a browse-time `check` may be up to 60s stale. */
export const WMS_AVAILABILITY_CACHE_TTL_MS = 60_000

const logger = createLogger('wms').child({ component: 'availability-cache' })

type CacheService = {
  get(key: string, options?: { returnExpired?: boolean }): Promise<unknown>
  set(key: string, value: unknown, options?: { ttl?: number; tags?: string[] }): Promise<void>
  deleteByTags(tags: string[]): Promise<number>
}

type Resolver = { resolve: <T = unknown>(name: string) => T }

function resolveCache(container: Resolver | null | undefined): CacheService | null {
  if (!container?.resolve) return null
  for (const name of ['cache', 'cacheService']) {
    try {
      const candidate = container.resolve<CacheService>(name)
      if (candidate && typeof candidate.deleteByTags === 'function') return candidate
    } catch {
      // try the next registration name
    }
  }
  return null
}

function cacheKeyForItem(query: AvailabilityQuery, item: AvailabilityQuery['items'][number]): string {
  return [
    'wms:availability',
    query.organizationId,
    query.storeId ?? '',
    item.catalogProductId,
    item.catalogVariantId ?? '',
  ].join(':')
}

/**
 * Wraps `computeAvailability` with the read-through cache. Falls back to a
 * live computation when no cache service is registered or `bypassCache` is
 * set — the same code path either way, just without the read/write.
 */
export async function computeAvailabilityCached(
  em: EntityManager,
  container: Resolver,
  query: AvailabilityQuery,
): Promise<AvailabilityResult> {
  const cache = resolveCache(container)
  if (!cache || query.bypassCache) {
    return computeAvailability(em, container, query)
  }

  return runWithCacheTenant(query.tenantId, async () => {
    const byItem: AvailabilityResult['byItem'] = {}
    const missed: AvailabilityQuery['items'] = []

    for (const item of query.items) {
      const key = availabilityItemKey(item)
      try {
        const cached = await cache.get(cacheKeyForItem(query, item))
        if (cached) {
          byItem[key] = { ...(cached as AvailabilityItemResult), isAuthoritative: false }
          continue
        }
      } catch (err) {
        logger.warn('Availability cache read failed; computing live', { key, err })
      }
      missed.push(item)
    }

    if (missed.length > 0) {
      const live = await computeAvailability(em, container, { ...query, items: missed })
      for (const item of missed) {
        const key = availabilityItemKey(item)
        const result = live.byItem[key]
        byItem[key] = result
        try {
          await cache.set(cacheKeyForItem(query, item), result, {
            ttl: WMS_AVAILABILITY_CACHE_TTL_MS,
            tags: [WMS_AVAILABILITY_CACHE_TAG],
          })
        } catch (err) {
          logger.warn('Availability cache write failed', { key, err })
        }
      }
    }

    return { byItem }
  })
}

/**
 * Best-effort tag invalidation — mirrors
 * `invalidateInventoryEnricherCache.ts`. A failure is logged and swallowed:
 * invalidation must never fail the write that triggered it, and the TTL
 * bounds how long a missed drop can serve stale data.
 */
export async function invalidateWmsAvailabilityCache(
  container: Resolver | null | undefined,
  tenantId: string | null | undefined,
): Promise<void> {
  if (!tenantId) return
  const cache = resolveCache(container)
  if (!cache) return
  try {
    await runWithCacheTenant(tenantId, () => cache.deleteByTags([WMS_AVAILABILITY_CACHE_TAG]))
  } catch (err) {
    logger.warn('Failed to invalidate wms availability cache', { tenantId, err })
  }
}
