import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogPriceHistoryEntry } from '../../../data/entities'
import { priceHistoryListQuerySchema } from '../../../data/validators'
import { createCatalogCrudOpenApi, createPagedListResponseSchema } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.price_history.view'] },
}

export async function GET(req: NextRequest) {
  const container = await createRequestContainer()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth?.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries())
    const query = priceHistoryListQuerySchema.parse(searchParams)

    const em = container.resolve<EntityManager>('em')
    const tenantId = auth.tenantId
    const organizationId = auth.orgId

    const baseFilters: Record<string, unknown> = {
      tenantId: { $eq: tenantId },
      organizationId: { $eq: organizationId },
    }
    if (query.productId) baseFilters.productId = { $eq: query.productId }
    if (query.variantId) baseFilters.variantId = { $eq: query.variantId }
    if (query.offerId) baseFilters.offerId = { $eq: query.offerId }
    if (query.priceKindId) baseFilters.priceKindId = { $eq: query.priceKindId }
    if (query.channelId) baseFilters.channelId = { $eq: query.channelId }
    if (query.currencyCode) baseFilters.currencyCode = { $eq: query.currencyCode }
    if (query.changeType) baseFilters.changeType = { $eq: query.changeType }
    if (query.from || query.to) {
      const dateFilter: Record<string, unknown> = {}
      if (query.from) dateFilter.$gte = new Date(query.from)
      if (query.to) dateFilter.$lte = new Date(query.to)
      baseFilters.recordedAt = dateFilter
    }

    const cursorFilter = query.cursor ? decodeCursor(query.cursor) : null
    const filters = cursorFilter
      ? {
          ...baseFilters,
          $or: [
            { recordedAt: { $lt: cursorFilter.recordedAt } },
            { recordedAt: { $eq: cursorFilter.recordedAt }, id: { $lt: cursorFilter.id } },
          ],
        }
      : baseFilters

    const pageSize = query.pageSize
    const items = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      filters,
      { orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: pageSize + 1 },
      { tenantId, organizationId },
    )

    const hasMore = items.length > pageSize
    const page = hasMore ? items.slice(0, pageSize) : items
    const nextCursor = hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1]!)
      : null

    const response: Record<string, unknown> = {
      items: page.map(serializeHistoryEntry),
      nextCursor,
    }

    if (query.includeTotal) {
      response.total = await em.count(CatalogPriceHistoryEntry, baseFilters)
    }

    return NextResponse.json(response)
  } finally {
    const disposable = container as unknown as { dispose?: () => Promise<void> }
    if (typeof disposable.dispose === 'function') await disposable.dispose()
  }
}

function serializeHistoryEntry(entry: CatalogPriceHistoryEntry) {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
    priceId: entry.priceId,
    productId: entry.productId,
    variantId: entry.variantId ?? null,
    offerId: entry.offerId ?? null,
    channelId: entry.channelId ?? null,
    priceKindId: entry.priceKindId,
    priceKindCode: entry.priceKindCode,
    currencyCode: entry.currencyCode,
    unitPriceNet: entry.unitPriceNet ?? null,
    unitPriceGross: entry.unitPriceGross ?? null,
    taxRate: entry.taxRate ?? null,
    taxAmount: entry.taxAmount ?? null,
    minQuantity: entry.minQuantity ?? null,
    maxQuantity: entry.maxQuantity ?? null,
    startsAt: entry.startsAt?.toISOString() ?? null,
    endsAt: entry.endsAt?.toISOString() ?? null,
    recordedAt: entry.recordedAt.toISOString(),
    changeType: entry.changeType,
    source: entry.source,
    isAnnounced: entry.isAnnounced ?? null,
    metadata: entry.metadata ?? null,
  }
}

function encodeCursor(entry: CatalogPriceHistoryEntry): string {
  return Buffer.from(JSON.stringify({ recordedAt: entry.recordedAt.toISOString(), id: entry.id })).toString('base64')
}

const cursorPayloadSchema = z.object({
  recordedAt: z.string().datetime(),
  id: z.string().uuid(),
})

function decodeCursor(cursor: string): { recordedAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'))
    const validated = cursorPayloadSchema.safeParse(parsed)
    if (!validated.success) return null
    return { recordedAt: new Date(validated.data.recordedAt), id: validated.data.id }
  } catch {
    return null
  }
}

const historyEntrySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  priceId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  offerId: z.string().uuid().nullable().optional(),
  channelId: z.string().uuid().nullable().optional(),
  priceKindId: z.string().uuid(),
  priceKindCode: z.string(),
  currencyCode: z.string(),
  unitPriceNet: z.string().nullable().optional(),
  unitPriceGross: z.string().nullable().optional(),
  taxRate: z.string().nullable().optional(),
  taxAmount: z.string().nullable().optional(),
  minQuantity: z.number().nullable().optional(),
  maxQuantity: z.number().nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  recordedAt: z.string(),
  changeType: z.enum(['create', 'update', 'delete', 'undo']),
  source: z.enum(['manual', 'import', 'api', 'rule', 'system']),
  isAnnounced: z.boolean().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const openApi = createCatalogCrudOpenApi({
  resourceName: 'Price History Entry',
  pluralName: 'Price History Entries',
  querySchema: priceHistoryListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(historyEntrySchema),
})
