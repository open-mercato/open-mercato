import type { EntityManager } from '@mikro-orm/postgresql'
import { runWithCacheTenant } from '@open-mercato/cache'
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

/**
 * `resolve`'s own options: `ResolveStoreFromRequestOptions` plus `fresh` (D-R4-22), additive —
 * `fresh` only affects the buyer layer's 60 s cache (`resolveBuyerContext`), never the store/domain
 * resolution layer, and is a no-op when omitted or `false`.
 */
export type ResolveStoreContextOptions = ResolveStoreFromRequestOptions & {
  /** Bypasses the buyer context's 60 s cache and re-resolves the buyer directly. Lock and merge
   * routes use this so they never act on a stale customer-group membership (D-R4-22). */
  fresh?: boolean
}

export type InvalidateStoreContextOptions = { tenantId?: string | null }

export type FindStoreForOrganizationsOptions = {
  tenantId: string
  organizationIds: string[] | null
  storeId: string
}

export type StoreOwnership = {
  id: string
  tenantId: string
  organizationId: string
}

export type StoreContextService = {
  resolve(request: Request, opts?: ResolveStoreContextOptions): Promise<StoreContext>
  resolveBySlug(slug: string, opts?: ResolveStoreContextBySlugOptions): Promise<StoreContext>
  invalidate(storeId: string, opts?: InvalidateStoreContextOptions): Promise<void>
  /**
   * Store-by-id read within a tenant and, when `organizationIds` is not `null`, those
   * organizations. Returns `null` for a deleted, unknown or out-of-scope store. Optional so a
   * third-party `StoreContextService` stays valid; consumers treat its absence as no store.
   */
  findStoreForOrganizations?(opts: FindStoreForOrganizationsOptions): Promise<StoreOwnership | null>
}

type StoreTenantDatabase = {
  ecommerce_stores: { id: string; tenant_id: string; organization_id: string; deleted_at: Date | null }
}

function resolveEntityManager(container: CacheContainer): EntityManager | null {
  try {
    return (container.resolve('em') as EntityManager | null | undefined) ?? null
  } catch {
    return null
  }
}

async function lookupStoreTenantId(container: CacheContainer, storeId: string): Promise<string | null> {
  const em = resolveEntityManager(container)
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
      const buyer = await runWithCacheTenant(store.tenantId, () =>
        resolveBuyerContext(container, store, request, { fresh: opts?.fresh }),
      )
      return composeStoreContext(store, buyer)
    },
    async resolveBySlug(slug, opts = {}) {
      const { request = null, ...slugOptions } = opts
      const store = await resolveStoreBySlug(container, slug, slugOptions)
      const buyer = await runWithCacheTenant(store.tenantId, () => resolveBuyerContext(container, store, request))
      return composeStoreContext(store, buyer)
    },
    async invalidate(storeId, opts = {}) {
      const tags = [ecommerceStoreTag(storeId)]
      await ecommerceResolutionCache(container).deleteByTags(tags)
      const tenantId = opts.tenantId ?? (await lookupStoreTenantId(container, storeId))
      if (tenantId) await buyerContextCache(container, { tenantId, storeId }).deleteByTags(tags)
    },
    async findStoreForOrganizations({ tenantId, organizationIds, storeId }) {
      if (organizationIds && organizationIds.length === 0) return null
      const em = resolveEntityManager(container)
      if (!em) return null
      let query = em
        .getKysely<StoreTenantDatabase>()
        .selectFrom('ecommerce_stores')
        .select(['id', 'tenant_id', 'organization_id'])
        .where('id', '=', storeId)
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
      if (organizationIds) query = query.where('organization_id', 'in', organizationIds)
      const row = await query.executeTakeFirst()
      return row ? { id: row.id, tenantId: row.tenant_id, organizationId: row.organization_id } : null
    },
  }
}
