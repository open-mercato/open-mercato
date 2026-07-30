import { createHash } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogPriceHistoryEntry } from '../data/entities'
import type { CatalogPriceHistoryChangeType, CatalogPriceHistorySource } from '../data/types'
import type { PriceHistorySnapshot, PriceSnapshot } from './omnibusTypes'

export type { PriceHistorySnapshot, PriceSnapshot }

export const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface BuildHistoryEntryOptions {
  snapshot: PriceHistorySnapshot
  changeType: CatalogPriceHistoryChangeType
  source: CatalogPriceHistorySource
  announce?: boolean
  metadata?: Record<string, unknown> | null
  recordedAt?: Date
}

export type HistoryEntryFields = Omit<CatalogPriceHistoryEntry, 'id'>

export function buildHistoryEntry(opts: BuildHistoryEntryOptions): HistoryEntryFields {
  const { snapshot, changeType, source, announce, metadata } = opts
  if (!snapshot.productId) {
    throw new Error('[internal] buildHistoryEntry requires a non-null productId')
  }
  const recordedAt = opts.recordedAt ?? new Date()

  const isAnnounced = snapshot.startsAt != null || snapshot.offerId != null || announce === true

  return {
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
    priceId: snapshot.id,
    productId: snapshot.productId,
    variantId: snapshot.variantId ?? null,
    offerId: snapshot.offerId ?? null,
    channelId: snapshot.channelId ?? null,
    priceKindId: snapshot.priceKindId,
    priceKindCode: snapshot.priceKindCode,
    currencyCode: snapshot.currencyCode,
    unitPriceNet: snapshot.unitPriceNet ?? null,
    unitPriceGross: snapshot.unitPriceGross ?? null,
    taxRate: snapshot.taxRate ?? null,
    taxAmount: snapshot.taxAmount ?? null,
    minQuantity: snapshot.minQuantity ?? null,
    maxQuantity: snapshot.maxQuantity ?? null,
    startsAt: snapshot.startsAt ? new Date(snapshot.startsAt) : null,
    endsAt: snapshot.endsAt ? new Date(snapshot.endsAt) : null,
    recordedAt,
    changeType,
    source,
    isAnnounced,
    idempotencyKey: computeIdempotencyKey(snapshot.id, changeType, recordedAt),
    metadata: metadata ?? null,
  }
}

// Keyed on the stored recorded_at rather than on price values: a recurring sale that returns a
// price to a previously-seen value must still record a fresh row. A content-based key would
// collide on legitimately repeated prices and silently drop them from the compliance log.
export function computeIdempotencyKey(
  priceId: string,
  changeType: CatalogPriceHistoryChangeType,
  recordedAt: Date,
): string {
  return createHash('sha256')
    .update([priceId, changeType, recordedAt.toISOString()].join('|'))
    .digest('hex')
}

export async function recordPriceHistoryEntry(
  em: EntityManager,
  snapshot: PriceHistorySnapshot,
  changeType: CatalogPriceHistoryChangeType,
  source: CatalogPriceHistorySource,
  opts?: { announce?: boolean; metadata?: Record<string, unknown> | null },
): Promise<void> {
  if (!snapshot.productId) return

  const fields = buildHistoryEntry({
    snapshot,
    changeType,
    source,
    announce: opts?.announce,
    metadata: opts?.metadata,
  })

  try {
    em.persist(em.create(CatalogPriceHistoryEntry, { ...fields }))
    await em.flush()
  } catch (err: unknown) {
    if (isUniqueViolation(err)) return
    throw err
  }
}

export type OmnibusCacheScope = {
  tenantId: string
  organizationId: string
  productId?: string | null
  variantId?: string | null
}

// Single source of truth for cache tags. The resolver tags every entry it writes with these,
// and price writes delete exactly the same tags after commit — keeping "what is tagged" and
// "what is invalidated" from drifting apart. A tag that is written but never deleted silently
// degrades the reference price to TTL-stale.
export function buildOmnibusCacheTags(scope: OmnibusCacheScope): string[] {
  const prefix = `omnibus:${scope.tenantId}:${scope.organizationId}`
  const tags = [prefix]
  if (scope.productId) tags.push(`${prefix}:product:${scope.productId}`)
  if (scope.variantId) tags.push(`${prefix}:variant:${scope.variantId}`)
  return tags
}

type CacheLike = { deleteByTags(tags: string[]): Promise<number> }

// Invalidate AFTER the price write commits — never inside withAtomicFlush or the write
// transaction (same rule as command side effects).
export async function invalidateOmnibusCache(cache: CacheLike | null | undefined, scope: OmnibusCacheScope): Promise<void> {
  if (!cache) return
  const tags = buildOmnibusCacheTags(scope).filter((tag) => tag.includes(':product:') || tag.includes(':variant:'))
  if (!tags.length) return
  await cache.deleteByTags(tags)
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const candidate = err as Record<string, unknown>
  const code = candidate['code']
  const constraint = candidate['constraint']
  return code === '23505' || (typeof constraint === 'string' && constraint.includes('idempotency_key'))
}
