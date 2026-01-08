import { NextResponse } from 'next/server'
import { z } from 'zod'
import { logCrudAccess, makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { tenantCreateSchema, tenantUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'
import { loadCustomFieldValues, buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { tenantCrudEvents, tenantCrudIndexer } from '@open-mercato/core/modules/directory/commands/tenants'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { directoryTag, directoryErrorSchema, directoryOkSchema, tenantListResponseSchema } from '../openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

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

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager

  const { id, page, pageSize, search, sortField, sortDir, isActive } = parsed.data
  const where: FilterQuery<Tenant> = { deletedAt: null }
  if (id) where.id = id
  if (search) {
    Object.assign(where, { name: { $ilike: `%${escapeLikePattern(search)}%` } })
  }
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

  await logCrudAccess({
    container,
    auth,
    request: req,
    items,
    idField: 'id',
    resourceKind: 'directory.tenant',
    organizationId: null,
    tenantId: auth.tenantId ?? null,
    query: rawQuery,
    accessType: id ? 'read:item' : undefined,
  })

  return NextResponse.json({ items, total, page, pageSize, totalPages })
}

export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const tenantCreateResponseSchema = z.object({
  id: z.string().uuid(),
})

const tenantDeleteRequestSchema = z.object({
  id: z.string().uuid(),
})

const tenantGetDoc: OpenApiMethodDoc = {
  summary: 'List tenants',
  description: 'Returns tenants visible to the current user with optional search and pagination.',
  tags: [directoryTag],
  query: listQuerySchema,
  responses: [
    { status: 200, description: 'Paged list of tenants.', schema: tenantListResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid query parameters', schema: directoryErrorSchema },
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
  ],
}

const tenantPostDoc: OpenApiMethodDoc = {
  summary: 'Create tenant',
  description: 'Creates a new tenant and returns its identifier.',
  tags: [directoryTag],
  requestBody: {
    contentType: 'application/json',
    schema: tenantCreateSchema,
    description: 'Tenant name and optional activation flag.',
  },
  responses: [
    { status: 201, description: 'Tenant created.', schema: tenantCreateResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: directoryErrorSchema },
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
    { status: 403, description: 'Missing directory.tenants.manage feature', schema: directoryErrorSchema },
  ],
}

const tenantPutDoc: OpenApiMethodDoc = {
  summary: 'Update tenant',
  description: 'Updates tenant properties such as name or activation state.',
  tags: [directoryTag],
  requestBody: {
    contentType: 'application/json',
    schema: tenantUpdateSchema,
    description: 'Tenant identifier with fields to update.',
  },
  responses: [
    { status: 200, description: 'Tenant updated.', schema: directoryOkSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: directoryErrorSchema },
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
    { status: 403, description: 'Missing directory.tenants.manage feature', schema: directoryErrorSchema },
  ],
}

const tenantDeleteDoc: OpenApiMethodDoc = {
  summary: 'Delete tenant',
  description: 'Soft deletes the tenant identified by id.',
  tags: [directoryTag],
  requestBody: {
    contentType: 'application/json',
    schema: tenantDeleteRequestSchema,
    description: 'Identifier of the tenant to remove.',
  },
  responses: [
    { status: 200, description: 'Tenant removed.', schema: directoryOkSchema },
  ],
  errors: [
    { status: 400, description: 'Validation failed', schema: directoryErrorSchema },
    { status: 401, description: 'Authentication required', schema: directoryErrorSchema },
    { status: 403, description: 'Missing directory.tenants.manage feature', schema: directoryErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: directoryTag,
  summary: 'Manage tenants',
  methods: {
    GET: tenantGetDoc,
    POST: tenantPostDoc,
    PUT: tenantPutDoc,
    DELETE: tenantDeleteDoc,
  },
}
