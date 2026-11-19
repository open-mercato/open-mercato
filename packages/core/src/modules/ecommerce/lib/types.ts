import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { EcommercePriceDisplayMode, EcommercePriceSortFallback, EcommerceStoreSettings } from '../data/validators'

/**
 * Suite-wide buyer shape (SPEC-029 v4.6 §6, §6.0). Identity ids are read fresh from
 * `customer_accounts.CustomerUser`, never from JWT claims.
 */
export type BuyerContext = {
  /** `customer_accounts.CustomerUser.id` (auth.sub); null for anonymous buyers. */
  customerUserId: string | null
  /** `personEntityId ?? customerEntityId` — the most specific identity ("person wins"). */
  customerId: string | null
  /** `CustomerUser.customer_entity_id` — always the company. */
  companyId: string | null
  /** Distinct non-null `[personEntityId, customerEntityId]`, person first (D3). */
  customerIds: string[]
  /** Priority-ordered union over `customerIds` from `customerGroupsService`. */
  customerGroupIds: string[]
  isAuthenticated: boolean
  /** Derived from the resolved price kind's `displayMode` (§6.1a); never set independently. */
  taxMode: EcommercePriceDisplayMode
  /** Group terms override the channel default; passed to `PricingContext` as a filter (D2). */
  priceKindId: string | null
  allowPurchaseOnAccount: boolean
  approvalRequiredAbove: number | null
  /** `intersectScopes(channel, group union)`; null = unrestricted, [] = deny-all. */
  assortmentScope: EffectiveAssortmentScope
  /** `hashEffectiveScope(assortmentScope)` — digest of the canonicalized resolved scope, never of its inputs. */
  assortmentScopeHash: string
  /** Truncated sha256 of channelId, currencyCode, priceKindId and sorted customerGroupIds. */
  priceScopeKey: string
  /** Null when no id in `customerIds` has its own price rows; otherwise those ids, person first, joined with ','. */
  customerOverlayId: string | null
}

export type StoreContextStore = {
  id: string
  code: string
  name: string
  slug: string
  status: 'active'
  defaultLocale: string
  supportedLocales: string[]
  defaultCurrencyCode: string
  settings: EcommerceStoreSettings
}

export type StoreContextChannel = {
  channelBindingId: string
  salesChannelId: string
  priceKindId: string | null
  priceSortFallback: EcommercePriceSortFallback
}

export type StoreContext = {
  store: StoreContextStore
  tenantId: string
  organizationId: string
  channel: StoreContextChannel | null
  buyer: BuyerContext
  effectiveLocale: string
  requestedLocale: string | null
  currencyCode: string
  /**
   * Stable digest of every field that can change what a buyer sees or pays (§6.1).
   * MUST be a component of every buyer-dependent cache key derived from this context.
   */
  digest: string
}
