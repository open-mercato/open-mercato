import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { StoreContextService } from '@open-mercato/core/modules/ecommerce/lib/storeContextService'
import type { CartChannel, CartTaxMode } from '../data/entities'

// §6a.1a: scope, store and channel are resolved at the route edge, never caller-supplied.
// `ecommerce` is a soft dependency of `cart` (see index.ts's `requires`, which deliberately
// omits it) — "no storeContextService registered means no storefront carts at all, a clean
// 503". Only the `StoreContextService`/`StoreContext` *types* are imported here (type-only,
// erased at compile time); the module itself is resolved through DI with a try/catch, per
// packages/core/AGENTS.md's "Cross-Module Coupling" per-module local `tryResolve` pattern
// (see `shipping_carriers/api/webhook/[provider]/route.ts`, `promotions/lib/buyer-visibility.ts`
// for the same type-only-import + local-tryResolve combination against a soft peer).

export type CartRouteContainer = {
  resolve: <T = unknown>(name: string) => T
}

function tryResolveStoreContextService(container: CartRouteContainer): StoreContextService | null {
  try {
    return container.resolve<StoreContextService>('storeContextService') ?? null
  } catch {
    return null
  }
}

/**
 * Thrown by `resolveCartRouteContext` when `storeContextService` is not registered (the
 * `ecommerce` module is disabled). No route file exists yet in this step (Step 4.7 adds
 * the real HTTP routes), so the signaling mechanism is a typed error the route layer will
 * catch and map to a clean `503` — mirroring the existing convention for a soft dependency
 * going unavailable: `CredentialsEncryptionUnavailableError`
 * (`integrations/lib/credentials-service.ts`) is raised deep in a service and mapped to
 * `503` at the route (`integrations/api/[id]/credentials/route.ts`). Use
 * `isCartStoreContextUnavailableError` rather than `instanceof` across a possible
 * module/bundle boundary.
 */
export class CartStoreContextUnavailableError extends Error {
  readonly code = 'CART_STORE_CONTEXT_UNAVAILABLE'
  constructor() {
    super(
      '[internal] storeContextService is not registered — the ecommerce module is disabled, ' +
        'so no storefront cart route context can be resolved (§6a.1a). The route layer must ' +
        'map this to a 503.',
    )
    this.name = 'CartStoreContextUnavailableError'
  }
}

export function isCartStoreContextUnavailableError(error: unknown): error is CartStoreContextUnavailableError {
  return error instanceof CartStoreContextUnavailableError
}

/**
 * §6a.1a's "internal, branded command input... never constructed from request JSON".
 * This codebase has no existing nominal/branding utility type (checked
 * `packages/shared/src/lib` for a `Brand`/`__brand` helper and found none), so this is the
 * documented fallback: a plain exported interface whose invariant is enforced procedurally
 * — `resolveCartRouteContext` is the ONLY function permitted to construct one, and every
 * field below is copied from a resolved `StoreContext`/`BuyerContext`, never from a request
 * body. Commands accepting this type MUST treat it as trusted, unparsed input (never run it
 * through the public `.strict()` request-body schema).
 */
export type ResolvedCartRouteContext = {
  /**
   * (Step 4.5) The resolved store's own tenant/org — `cart.create`'s storefront path has no
   * `ctx.auth` to derive scope from (the caller is an anonymous buyer, or a buyer logged into
   * the storefront, never a staff `AuthContext`), so these are the ONLY source of the new
   * `Cart` row's `tenantId`/`organizationId`. `StoreContext.tenantId`/`organizationId` already
   * carry this (`ecommerce/lib/types.ts`); the route edge trusts them because
   * `storeContextService.resolve` itself only ever resolves a store the request's host/slug
   * legitimately maps to.
   */
  tenantId: string
  organizationId: string
  storeId: string
  channel: 'storefront'
  assortmentScope: EffectiveAssortmentScope
  buyerDigest: string
  customerId: string | null
  customerIds: string[]
  customerGroupIds: string[]
  /** `BuyerContext.customerUserId` — `customer_accounts.CustomerUser.id` for a buyer logged
   * into the storefront, null for a guest. */
  customerUserId: string | null
  /**
   * (Step 4.5) `cart.create` needs a pricing context to stamp on a brand-new `Cart` —
   * currency, locale and tax mode are NOT caller-supplied (§6a.1a's public `.strict()` body
   * convention) and are not optional on the entity (`Cart.currencyCode`/`locale`/`taxMode`
   * are all non-nullable, `data/entities.ts`), so they are resolved here, at the same route
   * edge that resolves everything else `ResolvedCartRouteContext` carries — never re-resolved
   * inside the command itself, which would risk a second, possibly inconsistent, read of
   * `storeContextService`.
   */
  currencyCode: string
  /** `StoreContext.effectiveLocale` — the resolved locale, not the raw request header. */
  locale: string
  /** `BuyerContext.taxMode`, derived from the resolved price kind's display mode
   * (`ecommerce/lib/types.ts`) — shares its `'gross' | 'net'` vocabulary with `CartTaxMode`
   * verbatim, so no mapping step exists to get wrong. */
  taxMode: CartTaxMode
  /** `StoreContext.channel?.salesChannelId ?? null` — null when no channel binding resolved. */
  salesChannelId: string | null
  /** `BuyerContext.priceKindId` — group terms override the channel default (D2); null when
   * no price kind resolved. */
  priceKindId: string | null
}

export type ResolveCartRouteContextOptions = {
  /** Forwarded to `storeContextService.resolve` — bypasses the buyer context's 60s cache
   * (lock/merge routes use this so they never act on a stale group membership, D-R4-22). */
  fresh?: boolean
}

/**
 * Route-edge resolution per §6a.1a. Resolves `storeContextService.resolve(request)` and
 * maps the result onto the branded `ResolvedCartRouteContext` — every field read off the
 * resolved `StoreContext`/`BuyerContext`, never off `request`'s own body or query string.
 *
 * Field mapping cross-checked against `ecommerce/lib/types.ts`'s actual `StoreContext`/
 * `BuyerContext` shapes (NOT the spec's own §6a.1a pseudocode, which showed a flat
 * `{ storeId, channel, assortmentScope, buyerDigest }` as if `assortmentScope` sat directly
 * on `StoreContext`). The real shape nests buyer-identity fields one level deeper:
 *   - `tenantId`         <- `storeContext.tenantId`
 *   - `organizationId`   <- `storeContext.organizationId`
 *   - `storeId`          <- `storeContext.store.id`               (StoreContext.store.id)
 *   - `assortmentScope`  <- `storeContext.buyer.assortmentScope`  (nested under `buyer`, not top-level)
 *   - `buyerDigest`      <- `storeContext.digest`                 (StoreContext.digest — matches Cart.buyer_digest's own doc comment, "StoreContext.digest at last pricing")
 *   - `customerId`       <- `storeContext.buyer.customerId`
 *   - `customerIds`      <- `storeContext.buyer.customerIds`
 *   - `customerGroupIds` <- `storeContext.buyer.customerGroupIds`
 *   - `customerUserId`   <- `storeContext.buyer.customerUserId`
 *   - `currencyCode`     <- `storeContext.currencyCode`
 *   - `locale`           <- `storeContext.effectiveLocale`
 *   - `taxMode`          <- `storeContext.buyer.taxMode`
 *   - `salesChannelId`   <- `storeContext.channel?.salesChannelId ?? null`
 *   - `priceKindId`      <- `storeContext.buyer.priceKindId`
 *
 * Soft DI: throws `CartStoreContextUnavailableError` when `storeContextService` is not
 * registered, rather than returning a context.
 */
export async function resolveCartRouteContext(
  request: Request,
  container: CartRouteContainer,
  opts?: ResolveCartRouteContextOptions,
): Promise<ResolvedCartRouteContext> {
  const storeContextService = tryResolveStoreContextService(container)
  if (!storeContextService) throw new CartStoreContextUnavailableError()

  const storeContext = await storeContextService.resolve(request, { fresh: opts?.fresh })

  return {
    tenantId: storeContext.tenantId,
    organizationId: storeContext.organizationId,
    storeId: storeContext.store.id,
    channel: 'storefront',
    assortmentScope: storeContext.buyer.assortmentScope,
    buyerDigest: storeContext.digest,
    customerId: storeContext.buyer.customerId,
    customerIds: storeContext.buyer.customerIds,
    customerGroupIds: storeContext.buyer.customerGroupIds,
    customerUserId: storeContext.buyer.customerUserId,
    currencyCode: storeContext.currencyCode,
    locale: storeContext.effectiveLocale,
    taxMode: storeContext.buyer.taxMode,
    salesChannelId: storeContext.channel?.salesChannelId ?? null,
    priceKindId: storeContext.buyer.priceKindId,
  }
}

/**
 * §6a.1b's enforcement key: enforce the assortment visibility check if, and only if, the
 * cart is `storefront` OR a scope was resolved for this call.
 *
 * `resolvedScope` is `undefined` when no `ResolvedCartRouteContext` was supplied for this
 * call at all (the common case for a trusted `pos`/`pay_link`/`agent`/`api` caller that
 * chose not to resolve one) — distinct from a resolved-but-unrestricted scope, which is a
 * legitimate `null` value of `EffectiveAssortmentScope` itself (§6.4/types.ts: "null =
 * unrestricted, [] = deny-all"). Collapsing those two together (as the spec's own §6a.1a
 * pseudocode literally does, via `routeContext?.assortmentScope` as a bare truthy check)
 * would silently skip enforcement for a trusted caller that explicitly resolved an
 * unrestricted scope — harmless in practice (an unrestricted scope matches everything
 * anyway) but not what §6a.1b's prose actually describes, so this helper keeps the two
 * states distinguishable via `undefined` vs. `null`/array.
 *
 * Centralized here so later steps (§6a.1c / §6a.2, Steps 4.4/4.6) that run the real
 * visibility check share one derivation instead of re-deriving this condition per call site.
 */
export function shouldEnforceAssortmentScope(
  cartChannel: CartChannel,
  resolvedScope: EffectiveAssortmentScope | undefined,
): boolean {
  return cartChannel === 'storefront' || resolvedScope !== undefined
}
