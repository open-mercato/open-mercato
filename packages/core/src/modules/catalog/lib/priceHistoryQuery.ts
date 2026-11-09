import { z } from 'zod'
import type { FilterQuery } from '@mikro-orm/postgresql'
import type { CatalogPriceHistoryEntry } from '../data/entities'
import type { PriceHistoryQuery } from '../data/validators'
import type { PriceHistoryChangeType, PriceHistorySource } from './omnibusTypes'

export type PriceHistoryCursor = {
  recordedAt: string
  id: string
}

const cursorSchema = z.object({
  recordedAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
})

export function encodePriceHistoryCursor(cursor: PriceHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64')
}

export function decodePriceHistoryCursor(value: string | null | undefined): PriceHistoryCursor | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    const decoded = Buffer.from(value.trim(), 'base64').toString('utf8')
    const parsed = cursorSchema.safeParse(JSON.parse(decoded))
    if (!parsed.success) return null
    return { recordedAt: new Date(parsed.data.recordedAt).toISOString(), id: parsed.data.id }
  } catch {
    return null
  }
}

export type PriceHistoryScope = {
  tenantId: string
  organizationIds: string[] | null
}

export type PriceHistoryOrganizationScopeInput = {
  selectedId: string | null
  filterIds: string[] | null
  allowedIds: string[] | null
}

export function resolvePriceHistoryOrganizationIds(
  scope: PriceHistoryOrganizationScopeInput,
  authOrganizationId: string | null | undefined,
): string[] | null {
  if (scope.selectedId) return [scope.selectedId]
  if (Array.isArray(scope.filterIds) && scope.filterIds.length > 0) return Array.from(new Set(scope.filterIds))
  if (scope.filterIds === null && scope.allowedIds === null) return null
  return authOrganizationId ? [authOrganizationId] : []
}

export function buildPriceHistoryWhere(
  scope: PriceHistoryScope,
  query: PriceHistoryQuery,
): FilterQuery<CatalogPriceHistoryEntry> {
  const where: Record<string, unknown> = { tenantId: scope.tenantId }
  if (scope.organizationIds) where.organizationId = { $in: scope.organizationIds }
  if (query.productId) where.productId = query.productId
  if (query.variantId) where.variantId = query.variantId
  if (query.priceKindId) where.priceKindId = query.priceKindId
  if (query.channelId) where.channelId = query.channelId
  if (query.currencyCode) where.currencyCode = query.currencyCode
  const recordedAt: Record<string, Date> = {}
  if (query.from) recordedAt.$gte = new Date(query.from)
  if (query.to) recordedAt.$lte = new Date(query.to)
  if (Object.keys(recordedAt).length > 0) where.recordedAt = recordedAt
  return where as FilterQuery<CatalogPriceHistoryEntry>
}

export function applyPriceHistoryCursor(
  where: FilterQuery<CatalogPriceHistoryEntry>,
  cursor: PriceHistoryCursor | null,
): FilterQuery<CatalogPriceHistoryEntry> {
  if (!cursor) return where
  const recordedAt = new Date(cursor.recordedAt)
  return {
    $and: [
      where,
      {
        $or: [
          { recordedAt: { $lt: recordedAt } },
          { recordedAt, id: { $lt: cursor.id } },
        ],
      },
    ],
  } as FilterQuery<CatalogPriceHistoryEntry>
}

export function formatFixedDecimal4(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const raw = typeof value === 'number' ? value.toFixed(4) : value.trim()
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(raw)
  if (!match) return raw
  const [, sign, whole, fraction = ''] = match
  const normalizedFraction = fraction.length >= 4 ? fraction.slice(0, 4) : fraction.padEnd(4, '0')
  return `${sign}${whole}.${normalizedFraction}`
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export type PriceHistoryItem = {
  id: string
  priceId: string
  productId: string
  variantId: string | null
  offerId: string | null
  channelId: string | null
  priceKindId: string
  priceKindCode: string
  currencyCode: string
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  taxAmount: string | null
  minQuantity: number | null
  maxQuantity: number | null
  startsAt: string | null
  endsAt: string | null
  recordedAt: string
  changeType: PriceHistoryChangeType
  source: PriceHistorySource
  isAnnounced: boolean
}

export function serializePriceHistoryEntry(entry: CatalogPriceHistoryEntry): PriceHistoryItem {
  return {
    id: entry.id,
    priceId: entry.priceId,
    productId: entry.productId,
    variantId: entry.variantId ?? null,
    offerId: entry.offerId ?? null,
    channelId: entry.channelId ?? null,
    priceKindId: entry.priceKindId,
    priceKindCode: entry.priceKindCode,
    currencyCode: entry.currencyCode,
    unitPriceNet: formatFixedDecimal4(entry.unitPriceNet),
    unitPriceGross: formatFixedDecimal4(entry.unitPriceGross),
    taxRate: formatFixedDecimal4(entry.taxRate),
    taxAmount: formatFixedDecimal4(entry.taxAmount),
    minQuantity: entry.minQuantity ?? null,
    maxQuantity: entry.maxQuantity ?? null,
    startsAt: toIsoOrNull(entry.startsAt),
    endsAt: toIsoOrNull(entry.endsAt),
    recordedAt: toIsoOrNull(entry.recordedAt) ?? new Date(0).toISOString(),
    changeType: entry.changeType,
    source: entry.source,
    isAnnounced: entry.isAnnounced === true,
  }
}
