import { NextResponse } from 'next/server'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import {
  tenantCreateSchema,
  tenantUpdateSchema,
  type TenantCreateInput,
  type TenantUpdateInput,
} from '@open-mercato/core/modules/directory/data/validators'
import { splitCustomFieldPayload, loadCustomFieldValues, buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'

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

type CreateState = {
  data: TenantCreateInput
  custom: Record<string, unknown>
}

type UpdateState = {
  data: TenantUpdateInput
  custom: Record<string, unknown>
}

const createStateStore = new WeakMap<object, CreateState>()
const updateStateStore = new WeakMap<object, UpdateState>()

const crud = makeCrudRoute<CrudInput, CrudInput, Record<string, unknown>>({
  metadata: routeMetadata,
  orm: {
    entity: Tenant,
    idField: 'id',
    orgField: null,
    tenantField: null,
    softDeleteField: 'deletedAt',
  },
  events: { module: 'directory', entity: 'tenant', persistent: true },
  indexer: { entityType: E.directory.tenant },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input) => {
      const state = createStateStore.get(input as object)
      if (!state) throw new CrudHttpError(400, { error: 'Invalid input' })
      return {
        name: state.data.name,
        isActive: state.data.isActive ?? true,
      }
    },
    response: (entity: Tenant) => ({ id: String(entity.id) }),
  },
  update: {
    schema: rawBodySchema,
    applyToEntity: (entity: Tenant, input) => {
      const state = updateStateStore.get(input as object)
      if (!state) throw new CrudHttpError(400, { error: 'Invalid input' })
      if (state.data.name !== undefined) entity.name = state.data.name
      if (state.data.isActive !== undefined) entity.isActive = state.data.isActive
      entity.updatedAt = new Date()
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'query',
    softDelete: true,
    response: () => ({ ok: true }),
  },
  hooks: {
    beforeCreate: async (raw) => {
      const { base, custom } = splitCustomFieldPayload(raw)
      const parsed = tenantCreateSchema.safeParse(base)
      if (!parsed.success) throw new CrudHttpError(400, { error: 'Invalid input' })
      const token = parsed.data as unknown as object
      createStateStore.set(token, { data: parsed.data, custom })
      return token as CrudInput
    },
    afterCreate: async (entity, ctx) => {
      const state = createStateStore.get(ctx.input as object)
      if (!state) return
      if (Object.keys(state.custom).length) {
        const de = ctx.container.resolve<DataEngine>('dataEngine')
        await de.setCustomFields({
          entityId: E.directory.tenant,
          recordId: String(entity.id),
          organizationId: null,
          tenantId: ctx.auth?.tenantId ?? null,
          values: state.custom,
          notify: false,
        })
      }
      createStateStore.delete(ctx.input as object)
    },
    beforeUpdate: async (raw) => {
      const { base, custom } = splitCustomFieldPayload(raw)
      const parsed = tenantUpdateSchema.safeParse(base)
      if (!parsed.success) throw new CrudHttpError(400, { error: 'Invalid input' })
      const token = parsed.data as unknown as object
      updateStateStore.set(token, { data: parsed.data, custom })
      return token as CrudInput
    },
    afterUpdate: async (entity, ctx) => {
      const state = updateStateStore.get(ctx.input as object)
      if (!state) return
      if (Object.keys(state.custom).length) {
        const de = ctx.container.resolve<DataEngine>('dataEngine')
        await de.setCustomFields({
          entityId: E.directory.tenant,
          recordId: String(entity.id),
          organizationId: null,
          tenantId: ctx.auth?.tenantId ?? null,
          values: state.custom,
          notify: false,
        })
      }
      updateStateStore.delete(ctx.input as object)
    },
    beforeDelete: async (id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      const tenant = await em.findOne(Tenant, { id })
      if (!tenant || tenant.deletedAt) throw new CrudHttpError(404, { error: 'Not found' })
      if (tenant.isActive) {
        tenant.isActive = false
        await em.persistAndFlush(tenant)
      }
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
  const auth = getAuthFromRequest(req)
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
