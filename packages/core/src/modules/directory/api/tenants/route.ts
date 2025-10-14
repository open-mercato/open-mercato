import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { loadCustomFieldValues, buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { tenantCrudEvents, tenantCrudIndexer } from '@open-mercato/core/modules/directory/commands/tenants'

const listQuerySchema = z.object({
  id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  sortField: z.enum(['name', 'createdAt', 'updatedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
}).passthrough()

type TenantRow = {
  id: string
  name: string
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
} & Record<string, unknown>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['directory.tenants.view'] },
  POST: { requireAuth: true, requireFeatures: ['directory.tenants.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['directory.tenants.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['directory.tenants.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()
type CrudInput = Record<string, unknown>

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: Tenant,
    idField: 'id',
    orgField: null,
    tenantField: null,
    softDeleteField: 'deletedAt',
  },
  events: tenantCrudEvents,
  indexer: tenantCrudIndexer,
  actions: {
    create: {
      commandId: 'directory.tenants.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.id) }),
      status: 201,
    },
    update: {
      commandId: 'directory.tenants.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'directory.tenants.delete',
      response: () => ({ ok: true }),
    },
  },
})

const toRow = (tenant: Tenant, cf: Record<string, unknown>): TenantRow => ({
  id: String(tenant.id),
  name: String(tenant.name),
  isActive: !!tenant.isActive,
  createdAt: tenant.createdAt ? tenant.createdAt.toISOString() : null,
  updatedAt: tenant.updatedAt ? tenant.updatedAt.toISOString() : null,
  ...cf,
})

const matchesValue = (current: unknown, expected: unknown): boolean => {
  if (Array.isArray(current)) return current.some((item) => item === expected)
  return current === expected
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
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
    isActive: url.searchParams.get('isActive') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const { id, page, pageSize, search, sortField, sortDir, isActive } = parsed.data
  const where: FilterQuery<Tenant> = { deletedAt: null }
  if (id) where.id = id
  if (search) where.name = { $ilike: `%${search}%` } as FilterQuery<Tenant>['name']
  if (isActive === 'true') where.isActive = true
  if (isActive === 'false') where.isActive = false

  const fieldMap: Record<string, string> = { name: 'name', createdAt: 'createdAt', updatedAt: 'updatedAt' }
  const orderBy: Record<string, 'ASC' | 'DESC'> = {}
  if (sortField) {
    const mapped = fieldMap[sortField] || 'name'
    orderBy[mapped] = sortDir === 'desc' ? 'DESC' : 'ASC'
  } else {
    orderBy.name = 'ASC'
  }

  const all = await em.find(Tenant, where, { orderBy })
  const recordIds = all.map((tenant) => String(tenant.id))

  const tenantIdByRecord: Record<string, string | null> = {}
  const organizationIdByRecord: Record<string, string | null> = {}
  for (const rid of recordIds) {
    tenantIdByRecord[rid] = null
    organizationIdByRecord[rid] = null
  }

  const cfValues = recordIds.length
    ? await loadCustomFieldValues({
        em,
        entityId: E.directory.tenant,
        recordIds,
        tenantIdByRecord,
        organizationIdByRecord,
        tenantFallbacks: auth.tenantId ? [auth.tenantId] : [],
      })
    : {}

  const rawQuery = Array.from(url.searchParams.keys()).reduce<Record<string, unknown>>((acc, key) => {
    const values = url.searchParams.getAll(key)
    if (!values.length) return acc
    acc[key] = values.length === 1 ? values[0] : values
    return acc
  }, {})

  const cfFilters = await buildCustomFieldFiltersFromQuery({
    entityId: E.directory.tenant,
    query: rawQuery,
    em,
    tenantId: auth.tenantId ?? null,
  })
  const cfFilterEntries = Object.entries(cfFilters).map(([rawKey, condition]) => {
    const normalizedKey = rawKey.startsWith('cf:') ? rawKey.slice(3) : rawKey.replace(/^cf_/, '')
    return [normalizedKey, condition] as const
  })

  const filtered = cfFilterEntries.length
    ? all.filter((tenant) => {
        const rid = String(tenant.id)
        const payload = cfValues[rid] ?? {}
        return cfFilterEntries.every(([key, expected]) => {
          const value = payload[`cf_${key}`]
          if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
            const maybeIn = (expected as { $in?: unknown[] }).$in
            if (Array.isArray(maybeIn)) {
              if (value === undefined || value === null) return false
              if (Array.isArray(value)) return value.some((val) => maybeIn.includes(val))
              return maybeIn.includes(value)
            }
          }
          return matchesValue(value, expected)
        })
      })
    : all

  const total = filtered.length
  const start = (page - 1) * pageSize
  const paged = filtered.slice(start, start + pageSize)
  const items = paged.map((tenant) => {
    const rid = String(tenant.id)
    const cf = cfValues[rid] ?? {}
    return toRow(tenant, cf)
  })
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
