import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CatalogPriceHistoryEntry } from '../../../data/entities'
import { priceHistoryQuerySchema } from '../../../data/validators'

const logger = createLogger('catalog')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.price_history.view'] },
}

const MONEY_DECIMALS = 4

type PriceHistoryScope = {
  em: EntityManager
  tenantId: string
  organizationId: string
}

type PriceHistoryCursor = {
  recordedAt: string
  id: string
}

const historyItemSchema = z.object({
  id: z.string(),
  priceId: z.string(),
  productId: z.string(),
  variantId: z.string().nullable(),
  offerId: z.string().nullable(),
  channelId: z.string().nullable(),
  priceKindId: z.string(),
  priceKindCode: z.string(),
  currencyCode: z.string(),
  unitPriceNet: z.string().nullable(),
  unitPriceGross: z.string().nullable(),
  taxRate: z.string().nullable(),
  taxAmount: z.string().nullable(),
  minQuantity: z.number().nullable(),
  maxQuantity: z.number().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  recordedAt: z.string(),
  changeType: z.string(),
  source: z.string(),
  isAnnounced: z.boolean().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
})

const historyResponseSchema = z.object({
  items: z.array(historyItemSchema),
  nextCursor: z.string().nullable(),
  total: z.number().optional(),
})

function formatMoney(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return numeric.toFixed(MONEY_DECIMALS)
}

function toIsoString(value: Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function encodeCursor(cursor: PriceHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64')
}

function decodeCursor(raw: string | undefined): PriceHistoryCursor | null {
  if (!raw) return null
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as unknown
    if (!decoded || typeof decoded !== 'object') return null
    const candidate = decoded as Record<string, unknown>
    const recordedAt = candidate.recordedAt
    const id = candidate.id
    if (typeof recordedAt !== 'string' || typeof id !== 'string' || !id) return null
    const parsedDate = new Date(recordedAt)
    if (Number.isNaN(parsedDate.getTime())) return null
    return { recordedAt: parsedDate.toISOString(), id }
  } catch {
    return null
  }
}

async function resolveScope(req: Request): Promise<PriceHistoryScope> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  return { em, tenantId: auth.tenantId, organizationId: auth.orgId }
}

function parseQuery(req: Request): z.infer<typeof priceHistoryQuerySchema> {
  const params = new URL(req.url).searchParams
  const raw = {
    productId: params.get('productId') ?? undefined,
    variantId: params.get('variantId') ?? undefined,
    priceKindId: params.get('priceKindId') ?? undefined,
    channelId: params.get('channelId') ?? undefined,
    currencyCode: params.get('currencyCode') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    includeTotal: parseBooleanWithDefault(params.get('includeTotal'), false),
  }
  const parsed = priceHistoryQuerySchema.safeParse(raw)
  if (!parsed.success) {
    throw new CrudHttpError(400, { error: 'Invalid query', details: parsed.error.issues })
  }
  return parsed.data
}

function buildFilters(
  scope: PriceHistoryScope,
  query: z.infer<typeof priceHistoryQuerySchema>,
): FilterQuery<CatalogPriceHistoryEntry> {
  const where: Record<string, unknown> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
  if (query.productId) where.productId = query.productId
  if (query.variantId) where.variantId = query.variantId
  if (query.priceKindId) where.priceKindId = query.priceKindId
  if (query.channelId) where.channelId = query.channelId
  if (query.currencyCode) where.currencyCode = query.currencyCode
  if (query.from || query.to) {
    const recordedAt: Record<string, Date> = {}
    if (query.from) recordedAt.$gte = query.from
    if (query.to) recordedAt.$lte = query.to
    where.recordedAt = recordedAt
  }
  return where as FilterQuery<CatalogPriceHistoryEntry>
}

function applyCursor(
  where: FilterQuery<CatalogPriceHistoryEntry>,
  cursor: PriceHistoryCursor | null,
): FilterQuery<CatalogPriceHistoryEntry> {
  if (!cursor) return where
  const recordedAt = new Date(cursor.recordedAt)
  return {
    ...(where as Record<string, unknown>),
    $or: [
      { recordedAt: { $lt: recordedAt } },
      { recordedAt, id: { $lt: cursor.id } },
    ],
  } as FilterQuery<CatalogPriceHistoryEntry>
}

function serializeEntry(entry: CatalogPriceHistoryEntry): z.infer<typeof historyItemSchema> {
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
    unitPriceNet: formatMoney(entry.unitPriceNet),
    unitPriceGross: formatMoney(entry.unitPriceGross),
    taxRate: formatMoney(entry.taxRate),
    taxAmount: formatMoney(entry.taxAmount),
    minQuantity: entry.minQuantity ?? null,
    maxQuantity: entry.maxQuantity ?? null,
    startsAt: toIsoString(entry.startsAt),
    endsAt: toIsoString(entry.endsAt),
    recordedAt: new Date(entry.recordedAt).toISOString(),
    changeType: entry.changeType,
    source: entry.source,
    isAnnounced: entry.isAnnounced ?? null,
    metadata: entry.metadata ?? null,
  }
}

async function GET(req: Request) {
  try {
    const scope = await resolveScope(req)
    const query = parseQuery(req)
    const baseWhere = buildFilters(scope, query)
    const cursor = decodeCursor(query.cursor)

    const rows = await findWithDecryption(
      scope.em,
      CatalogPriceHistoryEntry,
      applyCursor(baseWhere, cursor),
      {
        orderBy: [{ recordedAt: 'DESC' }, { id: 'DESC' }],
        limit: query.pageSize + 1,
      },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )

    const hasMore = rows.length > query.pageSize
    const pageRows = hasMore ? rows.slice(0, query.pageSize) : rows
    const lastRow = pageRows[pageRows.length - 1]
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({ recordedAt: new Date(lastRow.recordedAt).toISOString(), id: lastRow.id })
        : null

    const body: z.infer<typeof historyResponseSchema> = {
      items: pageRows.map(serializeEntry),
      nextCursor,
    }
    if (query.includeTotal) {
      // Deliberate exception to the "reads go through findWithDecryption" rule: there is no
      // decryption-aware count helper, and a COUNT returns a scalar rather than column values,
      // so there is nothing to decrypt. `findWithDecryption` passes `where` through untouched,
      // so the SQL predicate is identical. `baseWhere` — not the cursor-narrowed filter — is
      // correct here: the total describes the whole result set, not the current page.
      body.total = await scope.em.count(CatalogPriceHistoryEntry, baseWhere)
    }
    return NextResponse.json(body)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('catalog.prices.history.GET Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const getDoc: OpenApiMethodDoc = {
  operationId: 'listCatalogPriceHistory',
  summary: 'List catalog price history entries',
  description:
    'Returns the append-only Omnibus price-history log ordered by recordedAt DESC, id DESC using keyset pagination. An invalid cursor falls back to the first page.',
  tags: ['Catalog'],
  query: priceHistoryQuerySchema,
  responses: [
    { status: 200, description: 'Price history page', schema: historyResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid query' },
    { status: 401, description: 'Unauthorized' },
    { status: 500, description: 'Internal server error' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog price history',
  methods: {
    GET: getDoc,
  },
}

export { GET }
