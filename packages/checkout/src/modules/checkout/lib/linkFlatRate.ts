import type { EntityManager } from '@mikro-orm/postgresql'
import { CheckoutLink } from '../data/entities'
import type { StoreFlatRateFallback } from './storeSettingsPeer'

// Release 5, Step 2.13 (C13/D-R5-35). The link-cart flat-rate carrier fallback lives on
// `CheckoutLink.flatRateShippingAmount`/`flatRateShippingCurrencyCode` (Migration
// 20261027180000) — unlike the cart/wms/ecommerce peer reads elsewhere in this Step,
// `CheckoutLink` is `checkout`'s OWN entity, so a plain `em.findOne` is used directly
// rather than a raw-Kysely cross-module peek.
export async function lookupLinkFlatRateFallback(
  em: EntityManager,
  linkId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<StoreFlatRateFallback | null> {
  const link = await em.findOne(CheckoutLink, {
    id: linkId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  } as any)
  if (!link?.flatRateShippingAmount || !link.flatRateShippingCurrencyCode) return null
  const amount = Number(link.flatRateShippingAmount)
  if (!Number.isFinite(amount)) return null
  return { amount, currencyCode: link.flatRateShippingCurrencyCode }
}
