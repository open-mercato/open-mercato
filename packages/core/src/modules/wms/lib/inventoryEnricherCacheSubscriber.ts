// Shared handler behind the WMS inventory enricher-cache invalidation
// subscribers. Each subscriber file binds it to one event pattern, because
// `metadata.event` takes a single pattern and the matcher is single-segment —
// `wms.*` does NOT match `wms.inventory_balance.created`, so every event family
// the enrichers read from is registered explicitly.
//
// It lives here rather than under `subscribers/` because the module generator
// scans that directory recursively and treats every file it finds as a
// subscriber.

import {
  invalidateWmsInventoryEnricherCache,
  type EnricherCacheScope,
} from './invalidateInventoryEnricherCache'

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
}

export function createInventoryEnricherCacheHandler(scope: EnricherCacheScope) {
  return async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
    const data = (payload ?? {}) as Record<string, unknown>
    const tenantId =
      typeof data.tenantId === 'string' && data.tenantId.length > 0
        ? data.tenantId
        : ctx.tenantId ?? null
    await invalidateWmsInventoryEnricherCache(ctx, tenantId, scope)
  }
}
