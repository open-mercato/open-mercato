import { createHash } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CatalogPriceHistoryEntry } from '../data/entities'
import type { CatalogPriceHistoryChangeType, CatalogPriceHistorySource } from '../data/entities'
import type { PriceHistorySnapshot, PriceSnapshot } from './omnibusTypes'

export type { PriceHistorySnapshot, PriceSnapshot }

export const MS_PER_DAY = 24 * 60 * 60 * 1000

export const OMNIBUS_MODULE_ID = 'catalog'
export const OMNIBUS_CONFIG_KEY = 'catalog.omnibus'

export interface BuildHistoryEntryOptions {
  snapshot: PriceHistorySnapshot
  changeType: CatalogPriceHistoryChangeType
  source: CatalogPriceHistorySource
  announce?: boolean
  metadata?: Record<string, unknown> | null
}

export function buildHistoryEntry(opts: BuildHistoryEntryOptions): Omit<CatalogPriceHistoryEntry, 'id'> {
  const { snapshot, changeType, source, announce, metadata } = opts
  const recordedAt = new Date()

  const isAnnounced = snapshot.startsAt != null || snapshot.offerId != null || announce === true

  const idempotencyKey = computeIdempotencyKey(snapshot.id, changeType, recordedAt)

  return {
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
    priceId: snapshot.id,
    productId: snapshot.productId ?? '',
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
    idempotencyKey,
    metadata: metadata ?? null,
  }
}

function computeIdempotencyKey(
  priceId: string,
  changeType: CatalogPriceHistoryChangeType,
  recordedAt: Date
): string {
  const raw = `${priceId}|${changeType}|${recordedAt.toISOString()}`
  return createHash('sha256').update(raw).digest('hex')
}

export async function recordPriceHistoryEntry(
  em: EntityManager,
  snapshot: PriceHistorySnapshot,
  changeType: CatalogPriceHistoryChangeType,
  source: CatalogPriceHistorySource,
  opts?: { announce?: boolean; metadata?: Record<string, unknown> | null }
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
    const entry = em.create(CatalogPriceHistoryEntry, { ...fields })
    em.persist(entry)
    await em.flush()
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return
    }
    throw err
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  const code = e['code'] as string | undefined
  const constraint = (e['constraint'] as string | undefined) ?? ''
  return code === '23505' || constraint.includes('idempotency_key')
}
