import type { CartChannel } from '../data/entities'
import type { CartPriceChangeReason } from './reprice'

// Step 5.1 — §5.2 triggers 2-4, the per-request buyer-context/currency/locale/staleness
// comparison. PLAN.md's Step 5.1 row calls for "per-request BuyerContext digest comparison
// (also on GET)" — read literally: this is evaluated on EVERY request that resolves the
// current cart by token (`commands/cart.ts`'s `getCartCommand`, which Step 4.7's
// `resolveCurrentCart` — `lib/currentCartRoute.ts` — calls from all four `/current/*`
// routes, not only the literal HTTP `GET`), so a drifted/stale cart re-prices the first
// time ANY request touches it, not only on an explicit read. "GET writes only when a
// trigger fires" means an ordinary GET inside the staleness budget with no digest change
// must still leave the cart untouched — `detectCartRepriceTrigger` returning `null` is what
// keeps that true.

export type CartRepriceTriggerReason = Exclude<CartPriceChangeReason, 'tier_change'>

const MINUTE_MS = 60 * 1000

/**
 * §5.2 trigger 4: "the staleness budget (default 30 minutes)". Follows the env-var-with-
 * default convention `lib/sweepConfig.ts` already uses for this module's other configurable
 * windows (`CART_INACTIVITY_WINDOW_HOURS`, `CART_LOCK_TIMEOUT_MINUTES`) rather than a new
 * config system.
 */
export const DEFAULT_CART_PRICE_STALENESS_MINUTES = 30
const MIN_CART_PRICE_STALENESS_MINUTES = 1

export function resolveCartPriceStalenessMs(): number {
  const raw = Number.parseInt(process.env.CART_PRICE_STALENESS_MINUTES ?? '', 10)
  const minutes =
    Number.isFinite(raw) && raw >= MIN_CART_PRICE_STALENESS_MINUTES ? raw : DEFAULT_CART_PRICE_STALENESS_MINUTES
  return minutes * MINUTE_MS
}

export type CartStoredPricingContext = {
  channel: CartChannel
  buyerDigest: string
  currencyCode: string
  locale: string
  /**
   * §5.1: "A line snapshot is older than the staleness budget ... and the cart is read" —
   * the spec names a LINE's own `priced_at`, not the cart's `totals_computed_at`. This
   * module uses `Cart.totalsComputedAt` as a conservative proxy instead of querying every
   * line on every request: `totalsComputedAt` only advances on a whole-cart re-price
   * (`cart.create`, `cart.reprice`), while a single-line trigger-1 re-price
   * (`commands/lines.ts`'s `isWithinStoredPriceTier` path) only ever moves that ONE line's
   * `pricedAt` forward (to `now`), never backward. So `totalsComputedAt` can never be
   * NEWER than the true oldest line's `pricedAt` — it is always a safe (if anything,
   * slightly early-firing) lower bound, at the cost of one fewer query per request. A
   * tighter-to-the-letter implementation would compare against `min(line.pricedAt)`
   * instead; documented here as the deliberate choice this step made.
   */
  totalsComputedAt: Date
}

export type CartFreshPricingContext = {
  buyerDigest: string
  currencyCode: string
  locale: string
}

export type DetectedCartRepriceTrigger = { reason: CartRepriceTriggerReason }

/**
 * Triggers 2/3 (buyer identity / currency / locale drift) are meaningful ONLY for a
 * `storefront` cart. `cart.create`'s trusted (non-storefront) path never resolves a
 * `StoreContext`/`BuyerContext` at all (`commands/cart.ts`: "no `StoreContext`/
 * `BuyerContext` is resolved on this path at all"), so a `pos`/`pay_link`/`agent`/`api`
 * cart's `buyerDigest` stays `''` by construction. Comparing that against a storefront
 * visitor's freshly-resolved digest (the only kind of `fresh` context this module ever
 * resolves) would misfire on every non-storefront cart a storefront-bound token happens to
 * reach. Trigger 4 (staleness) has no such caveat — it is purely time-based — so it is
 * always evaluated regardless of channel.
 *
 * Precedence when more than one differs at once (buyer identity > currency > locale >
 * staleness): the whole-cart re-price this produces is identical no matter which reason
 * wins — this only decides which single label is attached to `priceChanges` and the
 * `cart.price.changed` event for this call.
 */
export function detectCartRepriceTrigger(
  stored: CartStoredPricingContext,
  fresh: CartFreshPricingContext,
  now: Date,
): DetectedCartRepriceTrigger | null {
  if (stored.channel === 'storefront') {
    if (stored.buyerDigest !== fresh.buyerDigest) return { reason: 'buyer_context_changed' }
    if (stored.currencyCode !== fresh.currencyCode) return { reason: 'currency_changed' }
    if (stored.locale !== fresh.locale) return { reason: 'locale_changed' }
  }
  const staleMs = now.getTime() - stored.totalsComputedAt.getTime()
  if (staleMs >= resolveCartPriceStalenessMs()) return { reason: 'stale_snapshot' }
  return null
}
