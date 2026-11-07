import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CHECKOUT_DELIVERY_RATE_CACHE_TTL_MS } from './constants'
import type { DeliveryOption } from './deliveryRateQuote'

// Release 5, Step 2.13 (C13/§5.3: "cached 5 min per (address hash, cart hash), re-
// validated at submit"). Mirrors `promotions/services/promotion-cache.ts`'s own
// `readPromotionCacheEntry`/`writePromotionCacheEntry` best-effort shape — a cache
// miss or a cache write failure must never fail the rate-quote request it is backing,
// only cost it the recompute it would have needed anyway.

const logger = createLogger('checkout')

export function buildDeliveryRateCacheKey(
  tenantId: string,
  organizationId: string,
  sessionId: string,
  addressHash: string,
  cartHash: string,
): string {
  return `checkout:delivery-rates:${tenantId}:${organizationId}:${sessionId}:${addressHash}:${cartHash}`
}

export type DeliveryRateCacheContainer = { resolve: <T = unknown>(name: string) => T }

function resolveDeliveryRateCache(container: DeliveryRateCacheContainer): CacheStrategy | null {
  try {
    return container.resolve<CacheStrategy>('cache') ?? null
  } catch {
    return null
  }
}

export async function getOrComputeDeliveryOptions(
  container: DeliveryRateCacheContainer,
  scope: { tenantId: string; organizationId: string; sessionId: string },
  addressHash: string,
  cartHash: string,
  compute: () => Promise<DeliveryOption[]>,
): Promise<DeliveryOption[]> {
  const cache = resolveDeliveryRateCache(container)
  const key = buildDeliveryRateCacheKey(scope.tenantId, scope.organizationId, scope.sessionId, addressHash, cartHash)

  if (cache) {
    try {
      const cached = await runWithCacheTenant(scope.tenantId, () => cache.get(key))
      if (cached != null) return cached as DeliveryOption[]
    } catch (err) {
      logger.warn('[internal] delivery rate cache read failed, recomputing', { err, sessionId: scope.sessionId })
    }
  }

  const options = await compute()

  if (cache) {
    try {
      await runWithCacheTenant(scope.tenantId, () =>
        cache.set(key, options, { ttl: CHECKOUT_DELIVERY_RATE_CACHE_TTL_MS, tags: [`checkout:delivery-rates:${scope.tenantId}`] }),
      )
    } catch (err) {
      logger.warn('[internal] delivery rate cache write failed', { err, sessionId: scope.sessionId })
    }
  }

  return options
}
