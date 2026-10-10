import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogPriceHistoryEntry } from '../data/entities'
import { fetchOmnibusLatestPriceEntryIds } from './omnibusHistoryQueries'
import type { OmnibusPresentedEntry } from './omnibusTypes'
import { resolvePriceOfferId, type PriceRow } from './pricing'

export function isPromotionPriceKind(price: PriceRow | null | undefined): boolean {
  if (!price || !price.priceKind || typeof price.priceKind === 'string') return false
  return price.priceKind.isPromotion === true
}

function fallbackPresentedEntry(price: PriceRow): OmnibusPresentedEntry {
  return {
    priceId: price.id,
    changeType: 'update',
    recordedAt: price.updatedAt ?? price.createdAt ?? new Date(),
    startsAt: price.startsAt ?? null,
    offerId: resolvePriceOfferId(price),
    isAnnounced: null,
  }
}

export async function resolveOmnibusPresentedEntries(
  em: EntityManager,
  prices: PriceRow[],
): Promise<Map<string, OmnibusPresentedEntry>> {
  const entries = new Map<string, OmnibusPresentedEntry>()
  const unique = new Map<string, PriceRow>()
  for (const price of prices) {
    if (price?.id && !unique.has(price.id)) unique.set(price.id, price)
  }
  if (!unique.size) return entries
  const priced = Array.from(unique.values())
  const ids = await fetchOmnibusLatestPriceEntryIds(
    em,
    priced.map((price) => ({ tenantId: price.tenantId, organizationId: price.organizationId, priceId: price.id })),
  )
  const idsByScope = new Map<string, { tenantId: string; organizationId: string; ids: string[] }>()
  priced.forEach((price, index) => {
    const id = ids[index]
    if (!id) return
    const key = `${price.tenantId}|${price.organizationId}`
    const bucket = idsByScope.get(key) ?? { tenantId: price.tenantId, organizationId: price.organizationId, ids: [] }
    bucket.ids.push(id)
    idsByScope.set(key, bucket)
  })
  const rows = new Map<string, CatalogPriceHistoryEntry>()
  for (const scope of idsByScope.values()) {
    const found = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      { id: { $in: scope.ids }, tenantId: scope.tenantId, organizationId: scope.organizationId },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    for (const row of found) rows.set(row.id, row)
  }
  priced.forEach((price, index) => {
    const id = ids[index]
    const row = id ? rows.get(id) : undefined
    if (!row || row.priceId !== price.id) {
      entries.set(price.id, fallbackPresentedEntry(price))
      return
    }
    entries.set(price.id, {
      priceId: price.id,
      changeType: row.changeType,
      recordedAt: row.recordedAt,
      startsAt: row.startsAt ?? price.startsAt ?? null,
      offerId: row.offerId ?? resolvePriceOfferId(price),
      isAnnounced: row.isAnnounced ?? null,
    })
  })
  return entries
}
