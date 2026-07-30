import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogPriceHistoryEntry, CatalogPriceKind, CatalogProductPrice } from '../data/entities'
import type { OmnibusConfig } from '../data/validators'
import type { OmnibusHistoryRow, OmnibusResolutionContext } from './omnibusTypes'

export type PresentedPrice = {
  presentedPriceKindId: string
  priceKindIsPromotion: boolean
  presentedEntry: OmnibusHistoryRow | null
}

export function resolvePresentedPriceKindId(config: OmnibusConfig, ctx: OmnibusResolutionContext): string {
  return (
    config.channels?.[ctx.channelId ?? '']?.presentedPriceKindId ??
    config.defaultPresentedPriceKindId ??
    ctx.priceKindId
  )
}

// The presented entry is what the customer is being shown right now. Every resolution path
// (products list, admin preview, and any future storefront) MUST derive it the same way and
// pass it in: it supplies the promotion anchor, drives the `applicable` decision, and — most
// importantly — is the row the EC-7 rule excludes from its own reference window. Passing null
// silently degrades the reference to whatever the promotion itself costs.
export async function resolvePresentedPrice(
  em: EntityManager,
  ctx: OmnibusResolutionContext,
  config: OmnibusConfig,
): Promise<PresentedPrice> {
  const presentedPriceKindId = resolvePresentedPriceKindId(config, ctx)
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }

  const priceKind = await findOneWithDecryption(
    em,
    CatalogPriceKind,
    { id: presentedPriceKindId, tenantId: ctx.tenantId },
    undefined,
    scope,
  )

  const priceFilters: Record<string, unknown> = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    priceKind: presentedPriceKindId,
    currencyCode: ctx.currencyCode,
  }
  if (ctx.variantId) priceFilters.variant = ctx.variantId
  else if (ctx.productId) priceFilters.product = ctx.productId
  if (ctx.offerId) priceFilters.offer = ctx.offerId
  if (ctx.channelId) priceFilters.channelId = ctx.channelId

  const prices = await findWithDecryption(
    em,
    CatalogProductPrice,
    priceFilters,
    { orderBy: { startsAt: 'DESC', updatedAt: 'DESC' }, limit: 1 },
    scope,
  )
  const activePrice = prices[0]
  if (!activePrice) {
    return { presentedPriceKindId, priceKindIsPromotion: priceKind?.isPromotion === true, presentedEntry: null }
  }

  const entries = await findWithDecryption(
    em,
    CatalogPriceHistoryEntry,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId, priceId: activePrice.id },
    { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 1 },
    scope,
  )
  const entry = entries[0]

  return {
    presentedPriceKindId,
    priceKindIsPromotion: priceKind?.isPromotion === true,
    presentedEntry: entry
      ? {
          id: entry.id,
          priceId: entry.priceId,
          changeType: entry.changeType,
          unitPriceNet: entry.unitPriceNet ?? null,
          unitPriceGross: entry.unitPriceGross ?? null,
          recordedAt: entry.recordedAt.toISOString(),
          startsAt: entry.startsAt?.toISOString() ?? null,
          offerId: entry.offerId ?? null,
          isAnnounced: entry.isAnnounced ?? null,
        }
      : null,
  }
}
