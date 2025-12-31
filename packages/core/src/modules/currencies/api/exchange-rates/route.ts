import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { ExchangeRate } from '../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['currencies.rates.view'] },
  POST: { requireAuth: true, requireFeatures: ['currencies.rates.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['currencies.rates.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['currencies.rates.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.looseObject({})
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: ExchangeRate,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: {
    module: 'currencies',
    entity: 'exchange_rate',
    persistent: true,
  },
  actions: {
    create: {
      commandId: 'currencies.exchange_rates.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.exchangeRateId) }),
      status: 201,
    },
    update: {
      commandId: 'currencies.exchange_rates.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'currencies.exchange_rates.delete',
      response: () => ({ ok: true }),
    },
  },
})

const listQuerySchema = z
  .object({
    id: z.string().uuid().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.enum(['fromCurrencyCode', 'toCurrencyCode', 'date', 'createdAt', 'updatedAt']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    fromCurrencyCode: z.string().optional(),
    toCurrencyCode: z.string().optional(),
    isActive: z.enum(['true', 'false']).optional(),
    source: z.string().optional(),
  })
  .passthrough()

type ExchangeRateRow = {
  id: string
  fromCurrencyCode: string
  toCurrencyCode: string
  rate: string
  date: string
  source: string
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
  organizationId: string
  tenantId: string
}

const toRow = (rate: ExchangeRate): ExchangeRateRow => ({
  id: String(rate.id),
  fromCurrencyCode: String(rate.fromCurrencyCode),
  toCurrencyCode: String(rate.toCurrencyCode),
  rate: String(rate.rate),
  date: rate.date.toISOString(),
  source: String(rate.source),
  isActive: !!rate.isActive,
  createdAt: rate.createdAt ? rate.createdAt.toISOString() : null,
  updatedAt: rate.updatedAt ? rate.updatedAt.toISOString() : null,
  organizationId: String(rate.organizationId),
  tenantId: String(rate.tenantId),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = listQuerySchema.safeParse({
    id: url.searchParams.get('id') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    sortField: url.searchParams.get('sortField') ?? undefined,
    sortDir: url.searchParams.get('sortDir') ?? undefined,
    fromCurrencyCode: url.searchParams.get('fromCurrencyCode') ?? undefined,
    toCurrencyCode: url.searchParams.get('toCurrencyCode') ?? undefined,
    isActive: url.searchParams.get('isActive') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { id, page, pageSize, sortField, sortDir, fromCurrencyCode, toCurrencyCode, isActive, source } = parsed.data
  const where: FilterQuery<ExchangeRate> = {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  }

  if (id) where.id = id
  if (fromCurrencyCode) where.fromCurrencyCode = fromCurrencyCode
  if (toCurrencyCode) where.toCurrencyCode = toCurrencyCode
  if (source) where.source = source
  if (isActive === 'true') where.isActive = true
  if (isActive === 'false') where.isActive = false

  const fieldMap: Record<string, string> = {
    fromCurrencyCode: 'fromCurrencyCode',
    toCurrencyCode: 'toCurrencyCode',
    date: 'date',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'date'
    orderBy[mapped] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.date = 'DESC'
  }

  const [all, total] = await em.findAndCount(ExchangeRate, where, { orderBy })
  const start = (page - 1) * pageSize
  const paged = all.slice(start, start + pageSize)
  const items = paged.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
