import type { EntityManager } from '@mikro-orm/postgresql'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { runWithCacheTenant } from '@open-mercato/cache'
import { composeStoreContext, composeTrustedBuyer, resolveBuyerContext, resolveTrustedBuyerIdentity } from './buyerContext'
import { buyerContextCache, ecommerceResolutionCache, ecommerceStoreTag, type CacheContainer } from './cacheKeys'
import type { EcommercePriceDisplayMode } from '../data/validators'
import {
  StorefrontResolutionError,
  loadStoreChannelForBuyer,
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

/** `resolveForBuyer`'s own input (SPEC-029 §6.3, added 2026-10-26, Release 5, D-R5-22). */
export type ResolveForBuyerInput = {
  tenantId: string
  organizationId: string
  storeId?: string | null
  customerUserId?: string | null
  customerId?: string | null
}

/** `resolveForBuyer`'s own output (SPEC-029 §6.3). `assortmentScope` is present only when `storeId` is given. */
export type ResolveForBuyerResult = {
  tenantId: string
  organizationId: string
  storeId: string | null
  customerId: string | null
  customerIds: string[]
  customerUserId: string | null
  customerGroupIds: string[]
  priceKindId: string | null
  taxMode: EcommercePriceDisplayMode | null
  currencyCode: string | null
  buyerDigest: string
  assortmentScope?: EffectiveAssortmentScope
}

export type StoreContextService = {
  resolve(request: Request, opts?: ResolveStoreContextOptions): Promise<StoreContext>
  resolveBySlug(slug: string, opts?: ResolveStoreContextBySlugOptions): Promise<StoreContext>
  invalidate(storeId: string, opts?: InvalidateStoreContextOptions): Promise<void>
  /**
   * Trusted, in-process buyer resolution (SPEC-029 §6.3, D-R5-22): the identity is supplied by a
   * trusted caller instead of read from a session. `storeId` is optional; a `storeId` or buyer
   * outside `tenantId`/`organizationId` is refused (`store_out_of_scope` / `buyer_out_of_scope`).
   * Always reads fresh and never writes to or reads from the buyer's own 60 s cache. No route, AI
   * tool or MCP tool exposes it.
   */
  resolveForBuyer(input: ResolveForBuyerInput): Promise<ResolveForBuyerResult>
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
    async resolveForBuyer(input) {
      const { tenantId, organizationId } = input
      const storeId = input.storeId ?? null
      let storeInfo: Awaited<ReturnType<typeof loadStoreChannelForBuyer>> = null
      if (storeId) {
        storeInfo = await loadStoreChannelForBuyer(container, { storeId, tenantId, organizationId })
        if (!storeInfo) throw new StorefrontResolutionError(403, 'store_out_of_scope')
      }
      const identity = await resolveTrustedBuyerIdentity(container, {
        tenantId,
        organizationId,
        customerUserId: input.customerUserId ?? null,
        customerId: input.customerId ?? null,
      })
      const composed = await composeTrustedBuyer(container, {
        tenantId,
        organizationId,
        storeId,
        identity,
        channel: storeInfo?.channel ?? null,
        priceDisplayModeDefault: storeInfo?.priceDisplayModeDefault ?? null,
      })
      return {
        tenantId,
        organizationId,
        storeId,
        customerId: identity.customerId,
        customerIds: identity.customerIds,
        customerUserId: identity.customerUserId,
        customerGroupIds: composed.customerGroupIds,
        priceKindId: composed.priceKindId,
        taxMode: composed.taxMode,
        currencyCode: storeInfo?.currencyCode ?? null,
        buyerDigest: composed.buyerDigest,
        ...(storeId ? { assortmentScope: composed.assortmentScope } : {}),
      }
    },
  }
}
