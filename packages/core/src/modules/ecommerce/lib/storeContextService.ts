import type { EntityManager } from '@mikro-orm/postgresql'
import { composeStoreContext, resolveBuyerContext } from './buyerContext'
import { buyerContextCache, ecommerceResolutionCache, ecommerceStoreTag, type CacheContainer } from './cacheKeys'
import {
  resolveStoreBySlug,
  resolveStoreFromRequest,
  type ResolveStoreBySlugOptions,
  type ResolveStoreFromRequestOptions,
} from './storeContext'
import type { StoreContext } from './types'

/**
 * `storeContextService` (SPEC-029 §6): composes the store layer (`storeContext.ts`) and the
 * buyer layer (`buyerContext.ts`) into a full `StoreContext`. Registered per request container.
 */

export type ResolveStoreContextBySlugOptions = ResolveStoreBySlugOptions & {
  request?: Request | null
}

export type InvalidateStoreContextOptions = { tenantId?: string | null }

export type StoreContextService = {
  resolve(request: Request, opts?: ResolveStoreFromRequestOptions): Promise<StoreContext>
  resolveBySlug(slug: string, opts?: ResolveStoreContextBySlugOptions): Promise<StoreContext>
  invalidate(storeId: string, opts?: InvalidateStoreContextOptions): Promise<void>
}

type StoreTenantDatabase = {
  ecommerce_stores: { id: string; tenant_id: string }
}

async function lookupStoreTenantId(container: CacheContainer, storeId: string): Promise<string | null> {
  let em: EntityManager | null = null
  try {
    em = (container.resolve('em') as EntityManager | null | undefined) ?? null
  } catch {
    em = null
  }
  if (!em) return null
  const row = await em
    .getKysely<StoreTenantDatabase>()
    .selectFrom('ecommerce_stores')
    .select('tenant_id')
    .where('id', '=', storeId)
    .executeTakeFirst()
  return row?.tenant_id ?? null
}

export function createStoreContextService(container: CacheContainer): StoreContextService {
  return {
    async resolve(request, opts) {
      const store = await resolveStoreFromRequest(container, request, opts)
      const buyer = await resolveBuyerContext(container, store, request)
      return composeStoreContext(store, buyer)
    },
    async resolveBySlug(slug, opts = {}) {
      const { request = null, ...slugOptions } = opts
      const store = await resolveStoreBySlug(container, slug, slugOptions)
      const buyer = await resolveBuyerContext(container, store, request)
      return composeStoreContext(store, buyer)
    },
    async invalidate(storeId, opts = {}) {
      const tags = [ecommerceStoreTag(storeId)]
      await ecommerceResolutionCache(container).deleteByTags(tags)
      const tenantId = opts.tenantId ?? (await lookupStoreTenantId(container, storeId))
      if (tenantId) await buyerContextCache(container, { tenantId, storeId }).deleteByTags(tags)
    },
  }
}
