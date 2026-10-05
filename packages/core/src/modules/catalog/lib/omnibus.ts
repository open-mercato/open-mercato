import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CatalogPriceHistoryEntry } from '../data/entities'
import type { CatalogPriceKind, CatalogProductPrice } from '../data/entities'
import type { PriceHistoryChangeType, PriceHistoryEntryInput, PriceHistorySource } from './omnibusTypes'

export const PRICE_HISTORY_IDEMPOTENCY_CONSTRAINT = 'catalog_price_history_idempotency_uq'

const logger = createLogger('catalog')

export type PriceHistoryPriceInput = {
  id: string
  tenantId: string
  organizationId: string
  productId: string | null
  variantId: string | null
  offerId: string | null
  channelId: string | null
  priceKindId: string | null
  priceKindCode: string | null
  currencyCode: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  taxAmount: string | null
  minQuantity: number | null
  maxQuantity: number | null
  startsAt: Date | string | null
  endsAt: Date | string | null
}

export type BuildHistoryEntryOptions = {
  recordedAt?: Date
  source?: PriceHistorySource
  announce?: boolean
  metadata?: Record<string, unknown> | null
}

export type RecordPriceHistoryResult = 'recorded' | 'duplicate'

export function buildPriceHistoryIdempotencyKey(
  priceId: string,
  changeType: PriceHistoryChangeType,
  recordedAt: Date,
): string {
  return createHash('sha256').update(`${priceId}|${changeType}|${recordedAt.toISOString()}`).digest('hex')
}

export function resolvePriceHistoryAnnounced(
  price: Pick<PriceHistoryPriceInput, 'startsAt' | 'offerId'>,
  announce?: boolean,
): boolean {
  return Boolean(price.startsAt) || Boolean(price.offerId) || announce === true
}

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`[internal] Invalid price history date value: ${String(value)}`)
  }
  return date
}

export function buildHistoryEntry(
  price: PriceHistoryPriceInput,
  changeType: PriceHistoryChangeType,
  options: BuildHistoryEntryOptions = {},
): PriceHistoryEntryInput {
  if (!price.productId) {
    throw new Error('[internal] Price history entry requires a product id')
  }
  if (!price.priceKindId) {
    throw new Error('[internal] Price history entry requires a price kind id')
  }
  const recordedAt = options.recordedAt ? new Date(options.recordedAt.getTime()) : new Date()
  const source: PriceHistorySource = options.source ?? 'api'
  return {
    tenantId: price.tenantId,
    organizationId: price.organizationId,
    priceId: price.id,
    productId: price.productId,
    variantId: price.variantId ?? null,
    offerId: price.offerId ?? null,
    channelId: price.channelId ?? null,
    priceKindId: price.priceKindId,
    priceKindCode: price.priceKindCode ?? '',
    currencyCode: price.currencyCode,
    unitPriceNet: price.unitPriceNet ?? null,
    unitPriceGross: price.unitPriceGross ?? null,
    taxRate: price.taxRate ?? null,
    taxAmount: price.taxAmount ?? null,
    minQuantity: price.minQuantity ?? null,
    maxQuantity: price.maxQuantity ?? null,
    startsAt: toDateOrNull(price.startsAt),
    endsAt: toDateOrNull(price.endsAt),
    recordedAt,
    changeType,
    source,
    isAnnounced: resolvePriceHistoryAnnounced(price, options.announce),
    idempotencyKey: source === 'system' ? null : buildPriceHistoryIdempotencyKey(price.id, changeType, recordedAt),
    metadata: options.metadata ?? null,
  }
}

type EntityRef = string | { id: string } | null | undefined

function refId(ref: EntityRef): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id ?? null
}

function nestedProductId(ref: unknown): string | null {
  if (!ref || typeof ref !== 'object') return null
  return refId((ref as { product?: EntityRef }).product)
}

export function priceHistoryInputFromRecord(record: CatalogProductPrice): PriceHistoryPriceInput {
  const priceKind = record.priceKind as unknown as string | CatalogPriceKind | null | undefined
  const priceKindCode = priceKind && typeof priceKind === 'object' && priceKind.code ? priceKind.code : record.kind
  return {
    id: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    productId:
      refId(record.product as EntityRef) ?? nestedProductId(record.variant) ?? nestedProductId(record.offer),
    variantId: refId(record.variant as EntityRef),
    offerId: refId(record.offer as EntityRef),
    channelId: record.channelId ?? null,
    priceKindId: refId(priceKind),
    priceKindCode: priceKindCode ?? null,
    currencyCode: record.currencyCode,
    unitPriceNet: record.unitPriceNet ?? null,
    unitPriceGross: record.unitPriceGross ?? null,
    taxRate: record.taxRate ?? null,
    taxAmount: record.taxAmount ?? null,
    minQuantity: record.minQuantity ?? null,
    maxQuantity: record.maxQuantity ?? null,
    startsAt: record.startsAt ?? null,
    endsAt: record.endsAt ?? null,
  }
}

export async function recordPriceHistoryEntry(
  em: EntityManager,
  price: PriceHistoryPriceInput,
  changeType: PriceHistoryChangeType,
  options: BuildHistoryEntryOptions = {},
): Promise<RecordPriceHistoryResult> {
  const entry = buildHistoryEntry(price, changeType, options)
  const historyEm = em.fork()
  const row = historyEm.create(CatalogPriceHistoryEntry, entry)
  historyEm.persist(row)
  try {
    await historyEm.flush()
  } catch (err) {
    if (entry.idempotencyKey && isUniqueViolation(err, PRICE_HISTORY_IDEMPOTENCY_CONSTRAINT)) {
      return 'duplicate'
    }
    throw err
  }
  return 'recorded'
}

export async function capturePriceHistoryEntry(
  em: EntityManager,
  price: PriceHistoryPriceInput | null | undefined,
  changeType: PriceHistoryChangeType,
  options: BuildHistoryEntryOptions = {},
): Promise<RecordPriceHistoryResult | null> {
  if (!price) return null
  try {
    return await recordPriceHistoryEntry(em, price, changeType, options)
  } catch (err) {
    logger.error('[internal] catalog price history capture failed', {
      priceId: price.id,
      changeType,
      tenantId: price.tenantId,
      organizationId: price.organizationId,
      err,
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.price_history_capture_failed',
      attributes: { priceId: price.id, changeType },
    })
    return null
  }
}
