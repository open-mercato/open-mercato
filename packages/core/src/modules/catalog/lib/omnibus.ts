import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CatalogPriceHistoryEntry } from '../data/entities'
import type { CatalogPriceKind, CatalogProductPrice } from '../data/entities'
import type { PriceHistoryChangeType, PriceHistoryEntryInput, PriceHistorySource } from './omnibusTypes'
import { invalidateOmnibusCache } from './omnibusCache'

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
  customerId?: string | null
  customerGroupId?: string | null
  userId?: string | null
  userGroupId?: string | null
}

export type BuildHistoryEntryOptions = {
  recordedAt?: Date
  source?: PriceHistorySource
  announce?: boolean
  metadata?: Record<string, unknown> | null
}

export type CapturePriceHistoryOptions = BuildHistoryEntryOptions & {
  cache?: CacheStrategy | null
  invalidatePrices?: Array<PriceHistoryPriceInput | null | undefined>
}

export type RecordPriceHistoryResult = 'recorded' | 'duplicate'

/**
 * Drops cached Omnibus references for every product/variant/offer scope the given prices touch.
 * Pass both the before- and after-state of a moved price so the old scope is not left stale.
 */
export async function invalidateOmnibusCacheForPrices(
  cache: CacheStrategy | null | undefined,
  prices: Array<PriceHistoryPriceInput | null | undefined>,
): Promise<void> {
  if (!cache) return
  const present = prices.filter((price): price is PriceHistoryPriceInput => Boolean(price))
  if (!present.length) return
  await invalidateOmnibusCache(
    cache,
    present.map((price) => ({
      tenantId: price.tenantId,
      organizationId: price.organizationId,
      productId: price.productId,
      variantId: price.variantId,
      offerId: price.offerId,
    })),
  )
}

/**
 * A price feeds the public Omnibus reference only when it is addressed to the general public:
 * no customer, customer group, user, or user group individualization and no quantity tier above 1.
 */
export function isOmnibusTrackedPrice(
  price: Pick<PriceHistoryPriceInput, 'customerId' | 'customerGroupId' | 'userId' | 'userGroupId' | 'minQuantity'>,
): boolean {
  return (
    !price.customerId &&
    !price.customerGroupId &&
    !price.userId &&
    !price.userGroupId &&
    (price.minQuantity ?? 1) <= 1
  )
}

function normalizeDecimal(value: string | number | null | undefined): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  const trimmed = value.trim()
  if (!trimmed.length) return null
  const numeric = Number(trimmed)
  return Number.isNaN(numeric) ? trimmed : numeric
}

function normalizeTimestamp(value: Date | string | null | undefined): number | string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? String(value) : time
}

const PRICE_HISTORY_IDENTITY_FIELDS = [
  'productId',
  'variantId',
  'offerId',
  'channelId',
  'priceKindId',
  'currencyCode',
] as const satisfies ReadonlyArray<keyof PriceHistoryPriceInput>

const PRICE_HISTORY_DECIMAL_FIELDS = [
  'unitPriceNet',
  'unitPriceGross',
  'taxRate',
  'taxAmount',
  'minQuantity',
  'maxQuantity',
] as const satisfies ReadonlyArray<keyof PriceHistoryPriceInput>

const PRICE_HISTORY_TIMESTAMP_FIELDS = ['startsAt', 'endsAt'] as const satisfies ReadonlyArray<
  keyof PriceHistoryPriceInput
>

/**
 * True when an update changed anything the Omnibus history observes (scope, amounts, tiers, schedule
 * or tracked-ness). Decimals compare numerically and dates by instant, so re-saving an unchanged price
 * does not produce a fresh history row.
 */
export function hasPriceHistoryRelevantChange(before: PriceHistoryPriceInput, after: PriceHistoryPriceInput): boolean {
  for (const field of PRICE_HISTORY_IDENTITY_FIELDS) {
    if ((before[field] ?? null) !== (after[field] ?? null)) return true
  }
  for (const field of PRICE_HISTORY_DECIMAL_FIELDS) {
    if (normalizeDecimal(before[field]) !== normalizeDecimal(after[field])) return true
  }
  for (const field of PRICE_HISTORY_TIMESTAMP_FIELDS) {
    if (normalizeTimestamp(before[field]) !== normalizeTimestamp(after[field])) return true
  }
  return isOmnibusTrackedPrice(before) !== isOmnibusTrackedPrice(after)
}

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
    customerId: record.customerId ?? null,
    customerGroupId: record.customerGroupId ?? null,
    userId: record.userId ?? null,
    userGroupId: record.userGroupId ?? null,
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
  options: CapturePriceHistoryOptions = {},
): Promise<RecordPriceHistoryResult | null> {
  if (!price) return null
  try {
    const result = isOmnibusTrackedPrice(price) ? await recordPriceHistoryEntry(em, price, changeType, options) : null
    await invalidateOmnibusCacheForPrices(options.cache, [price, ...(options.invalidatePrices ?? [])])
    return result
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

export type RecordPriceHistoryBatchResult = { recorded: number; duplicates: number }

function uniquePricesById(prices: PriceHistoryPriceInput[]): PriceHistoryPriceInput[] {
  const seen = new Set<string>()
  const unique: PriceHistoryPriceInput[] = []
  for (const price of prices) {
    if (seen.has(price.id)) continue
    seen.add(price.id)
    unique.push(price)
  }
  return unique
}

export function isCompletePriceHistoryInput(price: PriceHistoryPriceInput): boolean {
  return Boolean(price.productId && price.priceKindId)
}

export async function recordPriceHistoryEntries(
  em: EntityManager,
  prices: PriceHistoryPriceInput[],
  changeType: PriceHistoryChangeType,
  options: BuildHistoryEntryOptions = {},
): Promise<RecordPriceHistoryBatchResult> {
  const tracked = uniquePricesById(prices.filter(isOmnibusTrackedPrice))
  const unique = tracked.filter(isCompletePriceHistoryInput)
  if (unique.length < tracked.length) {
    const skipped = tracked.filter((price) => !isCompletePriceHistoryInput(price))
    logger.warn('[internal] catalog price history skipped prices without a product or price kind', {
      priceIds: skipped.map((price) => price.id),
      changeType,
      tenantId: skipped[0].tenantId,
      organizationId: skipped[0].organizationId,
    })
  }
  if (!unique.length) return { recorded: 0, duplicates: 0 }
  const batchOptions: BuildHistoryEntryOptions = { ...options, recordedAt: options.recordedAt ?? new Date() }
  const entries = unique.map((price) => buildHistoryEntry(price, changeType, batchOptions))
  const historyEm = em.fork()
  for (const entry of entries) {
    historyEm.persist(historyEm.create(CatalogPriceHistoryEntry, entry))
  }
  try {
    await historyEm.flush()
  } catch (err) {
    if (!isUniqueViolation(err, PRICE_HISTORY_IDEMPOTENCY_CONSTRAINT)) throw err
    let recorded = 0
    let duplicates = 0
    for (const price of unique) {
      const result = await recordPriceHistoryEntry(em, price, changeType, batchOptions)
      if (result === 'duplicate') duplicates += 1
      else recorded += 1
    }
    return { recorded, duplicates }
  }
  return { recorded: entries.length, duplicates: 0 }
}

export async function capturePriceHistoryEntries(
  em: EntityManager,
  prices: PriceHistoryPriceInput[] | null | undefined,
  changeType: PriceHistoryChangeType,
  options: CapturePriceHistoryOptions = {},
): Promise<RecordPriceHistoryBatchResult | null> {
  if (!prices || !prices.length) return null
  try {
    const result = await recordPriceHistoryEntries(em, prices, changeType, options)
    await invalidateOmnibusCacheForPrices(options.cache, [...prices, ...(options.invalidatePrices ?? [])])
    return result
  } catch (err) {
    logger.error('[internal] catalog price history batch capture failed', {
      priceIds: prices.map((price) => price.id),
      changeType,
      tenantId: prices[0].tenantId,
      organizationId: prices[0].organizationId,
      err,
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.price_history_capture_failed',
      attributes: { priceCount: prices.length, changeType },
    })
    return null
  }
}
