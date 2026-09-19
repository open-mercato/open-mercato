import type { CacheStrategy } from '@open-mercato/cache'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { SalesSettings } from '../data/entities'

const logger = createLogger('sales')

export const TAX_PROVIDER_SELECTION_TTL_SECONDS = 300
export const TAX_PROVIDER_SETTINGS_CACHE_TAG = 'sales:settings'

export type TaxProviderSelectionRow = {
  providerKey: string | null
  providerSettings: Record<string, unknown> | null
  timeoutMs: number | null
  shipFromAddress: Record<string, unknown> | null
}

const EMPTY_SELECTION: TaxProviderSelectionRow = {
  providerKey: null,
  providerSettings: null,
  timeoutMs: null,
  shipFromAddress: null,
}

/**
 * Both scope ids are always in the key, so one organization can never read
 * another's selection out of the cache.
 */
export function taxProviderSelectionCacheKey(scope: {
  tenantId: string
  organizationId: string
}): string {
  return `sales:tax-provider:${scope.tenantId}:${scope.organizationId}`
}

export function taxProviderSelectionCacheTags(scope: {
  tenantId: string
  organizationId: string
}): string[] {
  return [
    `tenant:${scope.tenantId}`,
    `org:${scope.organizationId}`,
    TAX_PROVIDER_SETTINGS_CACHE_TAG,
  ]
}

type Container = { resolve: (key: string) => unknown }

/**
 * The cache is optional by design: a deployment without one, or one whose cache
 * is down, still resolves the selection from its own row. A tax calculation must
 * never fail because a cache is unavailable.
 */
function tryResolveCache(container: Container | null | undefined): CacheStrategy | null {
  if (!container) return null
  try {
    return (container.resolve('cache') as CacheStrategy) ?? null
  } catch {
    return null
  }
}

function toSelectionRow(settings: SalesSettings | null): TaxProviderSelectionRow {
  if (!settings) return EMPTY_SELECTION
  return {
    providerKey: settings.taxProviderKey ?? null,
    providerSettings: settings.taxProviderSettings ?? null,
    timeoutMs: settings.taxProviderTimeoutMs ?? null,
    shipFromAddress: settings.shipFromAddress ?? null,
  }
}

/**
 * Reads the organization's tax provider selection, through the cache when one is
 * available. Every read filters by both scope ids.
 */
export async function readTaxProviderSelection(params: {
  em: EntityManager
  container?: Container | null
  tenantId: string
  organizationId: string
}): Promise<TaxProviderSelectionRow> {
  const scope = { tenantId: params.tenantId, organizationId: params.organizationId }
  const cache = tryResolveCache(params.container)
  const key = taxProviderSelectionCacheKey(scope)

  if (cache) {
    try {
      const cached = await cache.get(key)
      if (cached && typeof cached === 'object') return cached as TaxProviderSelectionRow
    } catch (err) {
      logger.warn('tax provider selection cache read failed; falling through to the row', {
        organizationId: params.organizationId,
        err,
      })
    }
  }

  const settings = await params.em.findOne(SalesSettings, {
    tenantId: params.tenantId,
    organizationId: params.organizationId,
  })
  const row = toSelectionRow(settings)

  if (cache) {
    try {
      await cache.set(key, row as unknown as Record<string, unknown>, {
        ttl: TAX_PROVIDER_SELECTION_TTL_SECONDS,
        tags: taxProviderSelectionCacheTags(scope),
      })
    } catch (err) {
      logger.warn('tax provider selection cache write failed', {
        organizationId: params.organizationId,
        err,
      })
    }
  }

  return row
}

/** Called after a settings write commits, never inside its transaction. */
export async function invalidateTaxProviderSelection(params: {
  container?: Container | null
  tenantId: string
  organizationId: string
}): Promise<void> {
  const cache = tryResolveCache(params.container)
  if (!cache) return
  const scope = { tenantId: params.tenantId, organizationId: params.organizationId }
  try {
    await cache.delete(taxProviderSelectionCacheKey(scope))
    await cache.deleteByTags([TAX_PROVIDER_SETTINGS_CACHE_TAG])
  } catch (err) {
    logger.warn('tax provider selection cache invalidation failed', {
      organizationId: params.organizationId,
      err,
    })
  }
}
