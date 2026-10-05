import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CatalogPriceHistoryEntry } from '../../../data/entities'
import { priceHistoryQuerySchema } from '../../../data/validators'
import { PRICE_HISTORY_CHANGE_TYPES, PRICE_HISTORY_SOURCES } from '../../../lib/omnibusTypes'
import {
  applyPriceHistoryCursor,
  buildPriceHistoryWhere,
  decodePriceHistoryCursor,
  encodePriceHistoryCursor,
  resolvePriceHistoryOrganizationIds,
  serializePriceHistoryEntry,
} from '../../../lib/priceHistoryQuery'

const logger = createLogger('catalog')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.price_history.view'] },
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const parsed = priceHistoryQuerySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query', details: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }
    const query = parsed.data

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope.tenantId ?? auth.tenantId
    const organizationIds = resolvePriceHistoryOrganizationIds(scope, auth.orgId)
    if (organizationIds !== null && organizationIds.length === 0) {
      return NextResponse.json({ items: [], nextCursor: null, ...(query.includeTotal === 'true' ? { total: 0 } : {}) })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const baseWhere = buildPriceHistoryWhere(
      { tenantId, organizationIds },
      query,
    )
    const cursor = decodePriceHistoryCursor(query.cursor)
    const rows = await findWithDecryption(
      em,
      CatalogPriceHistoryEntry,
      applyPriceHistoryCursor(baseWhere, cursor),
      { orderBy: { recordedAt: 'desc', id: 'desc' }, limit: query.pageSize + 1 },
      { tenantId, organizationId: scope.selectedId ?? auth.orgId ?? null },
    )
    const hasMore = rows.length > query.pageSize
    const pageRows = hasMore ? rows.slice(0, query.pageSize) : rows
    const items = pageRows.map(serializePriceHistoryEntry)
    const last = items[items.length - 1]
    const nextCursor = hasMore && last ? encodePriceHistoryCursor({ recordedAt: last.recordedAt, id: last.id }) : null

    if (query.includeTotal === 'true') {
      const total = await em.count(CatalogPriceHistoryEntry, baseWhere)
      return NextResponse.json({ items, nextCursor, total })
    }
    return NextResponse.json({ items, nextCursor })
  } catch (err) {
    logger.error('catalog.prices.history.GET Unexpected error', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.price_history_read_failed',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const priceHistoryItemSchema = z.object({
  id: z.string().uuid(),
  priceId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  offerId: z.string().uuid().nullable(),
  channelId: z.string().uuid().nullable(),
  priceKindId: z.string().uuid(),
  priceKindCode: z.string(),
  currencyCode: z.string(),
  unitPriceNet: z.string().nullable(),
  unitPriceGross: z.string().nullable(),
  taxRate: z.string().nullable(),
  taxAmount: z.string().nullable(),
  minQuantity: z.number().int().nullable(),
  maxQuantity: z.number().int().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  recordedAt: z.string(),
  changeType: z.enum(PRICE_HISTORY_CHANGE_TYPES),
  source: z.enum(PRICE_HISTORY_SOURCES),
  isAnnounced: z.boolean(),
})

const priceHistoryResponseSchema = z.object({
  items: z.array(priceHistoryItemSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().optional(),
})

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog price history',
  methods: {
    GET: {
      summary: 'List recorded price history entries',
      description:
        'Returns immutable price history snapshots ordered by recordedAt DESC, id DESC with keyset pagination. Monetary values are fixed 4-decimal strings. An invalid cursor returns the first page.',
      query: priceHistoryQuerySchema,
      responses: [
        { status: 200, description: 'Price history page', schema: priceHistoryResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid query', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing catalog.price_history.view', schema: errorSchema },
      ],
    },
  },
}
