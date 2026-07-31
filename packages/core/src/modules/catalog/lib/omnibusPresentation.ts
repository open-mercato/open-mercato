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

/**
 * Per-request memo for the presented price kind.
 *
 * A products list resolves the same one or two price kinds for every row, so without this the
 * kind lookup is a pure N+1: one query per item for a value that barely varies. Pass a map that
 * lives for the duration of one request; omit it for a single-scope call such as the preview.
 */
export type PriceKindPromotionCache = Map<string, Promise<boolean>>

async function readPriceKindIsPromotion(
  em: EntityManager,
  tenantId: string,
  organizationId: string,
  priceKindId: string,
  cache?: PriceKindPromotionCache,
): Promise<boolean> {
  const cached = cache?.get(priceKindId)
  if (cached) return cached

  const promise = findOneWithDecryption(
    em,
    CatalogPriceKind,
    { id: priceKindId, tenantId },
    undefined,
    { tenantId, organizationId },
  )
    .then((priceKind) => priceKind?.isPromotion === true)
    .catch((err) => {
      cache?.delete(priceKindId)
      throw err
    })
  cache?.set(priceKindId, promise)
  return promise
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
  priceKindCache?: PriceKindPromotionCache,
): Promise<PresentedPrice> {
  const presentedPriceKindId = resolvePresentedPriceKindId(config, ctx)
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }

  const priceKindIsPromotion = await readPriceKindIsPromotion(
    em,
    ctx.tenantId,
    ctx.organizationId,
    presentedPriceKindId,
    priceKindCache,
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
    return { presentedPriceKindId, priceKindIsPromotion, presentedEntry: null }
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
    priceKindIsPromotion,
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
