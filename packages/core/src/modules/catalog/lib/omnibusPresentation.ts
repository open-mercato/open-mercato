import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { latestHistoryEntryIdsByPrice } from '../services/omnibusAggregate'
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

/** Per-request memo: without it the kind lookup is one query per list row. */
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

// Every resolution path MUST derive the presented entry the same way and pass it in: it is
// the anchor, the `applicable` signal, and the row EC-7 excludes from its own window.
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
    // `id` is the tie-break, not decoration: the seed data has several prices per scope with a
    // null startsAt and equal updatedAt, so without it the "active" price — and therefore the
    // promotion anchor — differed between this path and the batched one. M-3 requires they agree.
    { orderBy: { startsAt: 'DESC', updatedAt: 'DESC', id: 'DESC' }, limit: 1 },
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

export type PresentedPriceRequest = {
  productId: string
  priceKindId: string
  currencyCode: string
}

/**
 * Page-wide presented-price resolution.
 *
 * The per-item `resolvePresentedPrice` issues one price query and one history query each, so a
 * 100-row products grid fires 200 of them concurrently through a single forked EntityManager.
 * This collapses that to four for the whole page: the price kinds, the active prices, the id of
 * each active price's newest history row, and those rows. The neighbouring pricing and
 * unit-conversion enrichment in the same `afterList` hook batches for the same reason.
 *
 * Selection has to match the per-item version exactly: the active price is the one with the
 * newest `startsAt`, then the newest `updatedAt`.
 */
export async function resolvePresentedPricesForProducts(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  channelId: string | null,
  requests: PresentedPriceRequest[],
): Promise<Map<string, PresentedPrice>> {
  const result = new Map<string, PresentedPrice>()
  if (!requests.length) return result

  const priceKindIds = Array.from(new Set(requests.map((request) => request.priceKindId)))
  const currencyCodes = Array.from(new Set(requests.map((request) => request.currencyCode)))
  const productIds = Array.from(new Set(requests.map((request) => request.productId)))

  const priceKinds = await findWithDecryption(
    em,
    CatalogPriceKind,
    { id: { $in: priceKindIds }, tenantId: scope.tenantId },
    undefined,
    scope,
  )
  const promotionByKind = new Map(priceKinds.map((kind) => [kind.id, kind.isPromotion === true]))

  const priceFilters: Record<string, unknown> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    priceKind: { $in: priceKindIds },
    currencyCode: { $in: currencyCodes },
    product: { $in: productIds },
  }
  if (channelId) priceFilters.channelId = channelId

  const prices = await findWithDecryption(
    em,
    CatalogProductPrice,
    priceFilters,
    { orderBy: { startsAt: 'DESC', updatedAt: 'DESC', id: 'DESC' } },
    scope,
  )

  // First row per key wins: the query is already ordered the way the per-item version orders it,
  // including the `id` tie-break, so both paths select the same row.
  const priceByKey = new Map<string, (typeof prices)[number]>()
  for (const price of prices) {
    const productRef = price.product
    const productId = typeof productRef === 'string' ? productRef : (productRef?.id ?? null)
    const kindRef = price.priceKind
    const priceKindId = typeof kindRef === 'string' ? kindRef : (kindRef?.id ?? null)
    if (!productId || !priceKindId) continue
    const key = `${productId}|${priceKindId}|${price.currencyCode}`
    if (!priceByKey.has(key)) priceByKey.set(key, price)
  }

  const selectedPriceIds = Array.from(new Set(Array.from(priceByKey.values()).map((price) => price.id)))
  // Two steps rather than one, because "fetch the page's history and keep the newest per price"
  // is unbounded in the size of the log. The first resolves one winning row id per price, the
  // second reads exactly those rows through findWithDecryption.
  const newestEntryIds = await latestHistoryEntryIdsByPrice(em, scope, selectedPriceIds)
  const entries = newestEntryIds.length
    ? await findWithDecryption(
        em,
        CatalogPriceHistoryEntry,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, id: { $in: newestEntryIds } },
        undefined,
        scope,
      )
    : []
  const newestEntryByPriceId = new Map<string, (typeof entries)[number]>()
  for (const entry of entries) newestEntryByPriceId.set(entry.priceId, entry)

  for (const request of requests) {
    const priceKindIsPromotion = promotionByKind.get(request.priceKindId) === true
    const price = priceByKey.get(`${request.productId}|${request.priceKindId}|${request.currencyCode}`)
    if (!price) {
      result.set(request.productId, {
        presentedPriceKindId: request.priceKindId,
        priceKindIsPromotion,
        presentedEntry: null,
      })
      continue
    }
    const entry = newestEntryByPriceId.get(price.id)
    result.set(request.productId, {
      presentedPriceKindId: request.priceKindId,
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
    })
  }

  return result
}
