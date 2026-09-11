// Drop the cached WMS inventory enrichment for a tenant after a write that
// changed the data it was derived from.
//
// The three WMS inventory enrichers cache their cross-module reads read-through
// with a short TTL (see `enricherCacheTags.ts`). Every write surface that moves
// balances, reservations, movements, profiles, warehouses or the sales-order
// warehouse assignment drops the matching tags here, so a user sees the new
// stock on the next request rather than after the TTL.
//
// The cache service prefixes tags with the *current* cache tenant, which is an
// AsyncLocalStorage value set on the request path. A subscriber or command side
// effect running outside that scope would otherwise write its invalidation
// against the `tenant:global:` prefix and silently miss every entry the request
// path stored. `runWithCacheTenant` re-enters the right scope, mirroring
// `directory/subscribers/invalidateOrgScopeCache.ts`.

import { runWithCacheTenant } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  WMS_INVENTORY_CACHE_TAG,
  WMS_WAREHOUSE_CACHE_TAG,
} from './enricherCacheTags'

const logger = createLogger('wms').child({ component: 'enricher-cache' })

type CacheService = {
  deleteByTags(tags: string[]): Promise<number>
}

export type EnricherCacheScope = 'inventory' | 'warehouse' | 'all'

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

function tagsForScope(scope: EnricherCacheScope): string[] {
  if (scope === 'inventory') return [WMS_INVENTORY_CACHE_TAG]
  if (scope === 'warehouse') return [WMS_WAREHOUSE_CACHE_TAG]
  return [WMS_INVENTORY_CACHE_TAG, WMS_WAREHOUSE_CACHE_TAG]
}

/**
 * Best-effort tag invalidation. A failure is logged and swallowed: an
 * invalidation that throws must never fail the write that triggered it, and the
 * enricher TTL bounds how long a missed drop can serve stale data.
 */
export async function invalidateWmsInventoryEnricherCache(
  container: Resolver | null | undefined,
  tenantId: string | null | undefined,
  scope: EnricherCacheScope = 'all',
): Promise<void> {
  if (!tenantId) return
  const cache = resolveCache(container)
  if (!cache) return
  try {
    await runWithCacheTenant(tenantId, () => cache.deleteByTags(tagsForScope(scope)))
  } catch (err) {
    logger.warn('Failed to invalidate WMS inventory enricher cache', { tenantId, scope, err })
  }
}
