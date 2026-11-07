import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
// `ecommerce` stays a SOFT dependency of `checkout` (C10/D-R5-18) — only the type is
// imported here; the service itself is resolved through `tryResolve` below, never an
// unconditional `container.resolve(...)`.
import type { StoreContextService } from '@open-mercato/core/modules/ecommerce/lib/storeContextService'
import { tryResolve } from './tryResolve'

/**
 * Release 5, Step 3.5 (C9, D-R5-19, X13). "Session creation and submit refuse with
 * `409 cart_store_mismatch` when any of these differ: `cart.store_id` vs. the store
 * resolved from the request; `cart.channel` vs. the session channel; currency vs. the
 * session's; tenant or organization."
 *
 * ONE reusable guard, wired at session creation now (`commands/session.ts`) and left
 * ready for Step 4.1 to call again at submit without duplicating this logic — the two
 * call sites differ only in what they pass as `session` (a freshly-built draft at
 * creation, the persisted `CheckoutSession` row at submit) and `resolvedStoreId`
 * (resolved once per call, never cached across the two).
 */
export const CART_STORE_MISMATCH_CODE = 'cart_store_mismatch'

export type CartConsistencyCartSnapshot = {
  storeId: string | null
  channel: string
  currencyCode: string
  tenantId: string
  organizationId: string
}

export type CartConsistencySessionSnapshot = {
  channel: string
  currencyCode: string
  tenantId: string
  organizationId: string
}

function cartStoreMismatchError(reason: 'tenant_organization' | 'channel' | 'currency' | 'store'): CrudHttpError {
  return new CrudHttpError(409, {
    error: '[internal] the cart no longer matches this checkout session\'s store, channel, currency, tenant or organization',
    code: CART_STORE_MISMATCH_CODE,
    reason,
  })
}

/**
 * The pure comparison (C9). `resolvedStoreId` is whatever the caller already resolved for
 * this request (or `null` when none applies/resolves) — this function never resolves a
 * store itself, so it stays trivially unit-testable and reusable at submit.
 *
 * X13: the store comparison applies ONLY when `cart.storeId` is non-null — a link or API
 * cart always has `store_id = null` and skips it outright; every other comparison still
 * runs regardless of channel.
 */
export function assertCartMatchesCheckoutScope(input: {
  cart: CartConsistencyCartSnapshot
  session: CartConsistencySessionSnapshot
  resolvedStoreId: string | null
}): void {
  const { cart, session, resolvedStoreId } = input
  if (cart.tenantId !== session.tenantId || cart.organizationId !== session.organizationId) {
    throw cartStoreMismatchError('tenant_organization')
  }
  if (cart.channel !== session.channel) {
    throw cartStoreMismatchError('channel')
  }
  if (cart.currencyCode !== session.currencyCode) {
    throw cartStoreMismatchError('currency')
  }
  if (cart.storeId != null && cart.storeId !== resolvedStoreId) {
    throw cartStoreMismatchError('store')
  }
}

/**
 * Resolves the store id to compare `cart.storeId` against — "the store resolved from the
 * request" (C9) — via the soft `storeContextService` peer, `{ fresh: true }` so a stale
 * 60s buyer-context cache can never mask a real mismatch (D-R4-22 precedent).
 *
 * X13: never called/consulted when `cart.storeId` is `null` (link/API carts) — returning
 * `null` immediately in that case so a caller that always calls this unconditionally still
 * gets the correct "skip" behavior from `assertCartMatchesCheckoutScope` above.
 *
 * A storefront-channel cart (non-null `storeId`) with `ecommerce` absent, or with no
 * request to resolve from, cannot be scope-verified at all — `503`, not `409`, matching
 * §3.4: "Storefront-channel carts cannot be locked ... sessions on them are refused with
 * 503 checkout_sessions_unavailable" when `ecommerce` is absent. A request that resolves to
 * no store, or throws (unmapped host, wrong tenant), degrades to `null` here — the caller's
 * `assertCartMatchesCheckoutScope` then correctly reports it as a `409 cart_store_mismatch`,
 * not a second availability error.
 */
export async function resolveRequestStoreIdForConsistencyCheck(
  container: { resolve: <T = unknown>(name: string) => T },
  cartStoreId: string | null,
  request: Request | null | undefined,
): Promise<string | null> {
  if (cartStoreId == null) return null
  const storeContextService = tryResolve<StoreContextService>(container, 'storeContextService')
  if (!storeContextService || !request) {
    throw new CrudHttpError(503, {
      error: '[internal] checkout sessions require a resolvable store context for a storefront cart',
      code: 'checkout_sessions_unavailable',
    })
  }
  try {
    const storeContext = await storeContextService.resolve(request, { fresh: true })
    return storeContext.store.id
  } catch {
    return null
  }
}
