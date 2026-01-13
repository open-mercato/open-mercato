import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { Currency } from '../../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['currencies.view'] },
  POST: { requireAuth: true, requireFeatures: ['currencies.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['currencies.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['currencies.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).loose()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: Currency,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: {
    module: 'currencies',
    entity: 'currency',
    persistent: true,
  },
  actions: {
    create: {
      commandId: 'currencies.currencies.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.currencyId) }),
      status: 201,
    },
    update: {
      commandId: 'currencies.currencies.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'currencies.currencies.delete',
      response: () => ({ ok: true }),
    },
  },
})

const listQuerySchema = z.object({
  id: z.uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  sortField: z.enum(['code', 'name', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  isBase: z.enum(['true', 'false']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  code: z.string().optional(),
}).loose()

type CurrencyRow = {
  id: string
  code: string
  name: string
  symbol: string | null
  decimalPlaces: number
  thousandsSeparator: string | null
  decimalSeparator: string | null
  isBase: boolean
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
  organizationId: string
  tenantId: string
}

const toRow = (currency: Currency): CurrencyRow => ({
  id: String(currency.id),
  code: String(currency.code),
  name: String(currency.name),
  symbol: currency.symbol ?? null,
  decimalPlaces: currency.decimalPlaces,
  thousandsSeparator: currency.thousandsSeparator ?? null,
  decimalSeparator: currency.decimalSeparator ?? null,
  isBase: !!currency.isBase,
  isActive: !!currency.isActive,
  createdAt: currency.createdAt ? currency.createdAt.toISOString() : null,
  updatedAt: currency.updatedAt ? currency.updatedAt.toISOString() : null,
  organizationId: String(currency.organizationId),
  tenantId: String(currency.tenantId),
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
    search: url.searchParams.get('search') ?? undefined,
    sortField: url.searchParams.get('sortField') ?? undefined,
    sortDir: url.searchParams.get('sortDir') ?? undefined,
    isBase: url.searchParams.get('isBase') ?? undefined,
    isActive: url.searchParams.get('isActive') ?? undefined,
    code: url.searchParams.get('code') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { id, page, pageSize, search, sortField, sortDir, isBase, isActive, code } = parsed.data
  const filter: FilterQuery<Currency> = {
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    deletedAt: null,
  }
  
  if (id) filter.id = id
  if (code) filter.code = code
  if (search) {
    filter.$or = [
      { code: { $ilike: `%${search}%` } },
      { name: { $ilike: `%${search}%` } },
      { symbol: { $ilike: `%${search}%` } },
    ]
  }
  if (isBase === 'true') filter.isBase = true
  if (isBase === 'false') filter.isBase = false
  if (isActive === 'true') filter.isActive = true
  if (isActive === 'false') filter.isActive = false

  const fieldMap: Record<string, string> = {
    code: 'code',
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'code'
    orderBy[mapped] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.code = 'ASC'
  }

  const [all, total] = await em.findAndCount(Currency, filter, { orderBy })
  const start = (page - 1) * pageSize
  const paged = all.slice(start, start + pageSize)
  const items = paged.map(toRow)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
