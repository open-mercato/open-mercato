import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CatalogProductCategory,
  CatalogService,
  CatalogServiceMedia,
  CatalogServiceWorkRequirement,
} from '../../data/entities'
import { serviceCreateSchema, serviceUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import {
  createCatalogCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    search: z.string().optional(),
    categoryId: z.string().uuid().optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    withDeleted: z.coerce.boolean().optional(),
  })
  .passthrough()

type ServicesQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.services.view'] },
  POST: { requireAuth: true, requireFeatures: ['catalog.services.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.services.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['catalog.services.manage'] },
}

export const metadata = routeMetadata

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

function parseIds(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => UUID_REGEX.test(value))
}

function parseBooleanFlag(raw?: string): boolean | undefined {
  if (raw === undefined || raw === null) return undefined
  const normalized = String(raw).trim().toLowerCase()
  if (['true', '1', 'yes', 'active'].includes(normalized)) return true
  if (['false', '0', 'no', 'inactive'].includes(normalized)) return false
  return undefined
}

async function buildServiceFilters(query: ServicesQuery, ctx: CrudCtx): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const scope = {
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    tenantId: ctx.auth?.tenantId ?? null,
  }
  if (query.id) {
    filters.id = { $eq: query.id }
  }
  const ids = parseIds(query.ids)
  if (ids.length) {
    filters.id = { $in: ids }
  }
  if (query.categoryId) {
    filters.category = { $eq: query.categoryId }
  }
  const active = parseBooleanFlag(query.isActive)
  if (active !== undefined) {
    filters.is_active = active
  }
  const term = query.search?.trim()
  if (term) {
    const like = `%${escapeLikePattern(term)}%`
    const matches = await findWithDecryption(
      em,
      CatalogService,
      {
        ...scope,
        ...(query.withDeleted ? {} : { deletedAt: null }),
        $or: [
          { title: { $ilike: like } },
          { description: { $ilike: like } },
          { scope: { $ilike: like } },
        ],
      },
      { fields: ['id'] },
      scope,
    )
    const matchedIds = matches.map((item) => item.id).filter((id): id is string => Boolean(id))
    filters.id = matchedIds.length ? { $in: matchedIds } : { $eq: '00000000-0000-0000-0000-000000000000' }
  }
  return filters
}

type ServiceListItem = {
  id: string
  organization_id?: string | null
  tenant_id?: string | null
  title?: string | null
  description?: string | null
  scope?: string | null
  category_id?: string | null
  default_price_amount?: string | null
  default_price_currency_code?: string | null
  default_media_id?: string | null
  default_media_url?: string | null
  metadata?: Record<string, unknown> | null
  is_active?: boolean | null
  created_at?: string | Date | null
  updated_at?: string | Date | null
  category?: { id: string; name: string; slug: string | null } | null
  media?: unknown[]
  workRequirements?: unknown[]
}

async function decorateServicesAfterList(items: ServiceListItem[], ctx: CrudCtx) {
  if (!items.length) return
  const ids = items.map((item) => item.id).filter((id): id is string => Boolean(id))
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const scope = {
    organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
    tenantId: ctx.auth?.tenantId ?? null,
  }
  const [mediaRows, requirementRows, categories] = await Promise.all([
    findWithDecryption(
      em,
      CatalogServiceMedia,
      { service: { $in: ids }, deletedAt: null, ...scope },
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' } },
      scope,
    ),
    findWithDecryption(
      em,
      CatalogServiceWorkRequirement,
      { service: { $in: ids }, deletedAt: null, ...scope },
      { orderBy: { sortOrder: 'asc', createdAt: 'asc' } },
      scope,
    ),
    findWithDecryption(
      em,
      CatalogProductCategory,
      {
        id: { $in: items.map((item) => item.category_id).filter((id): id is string => Boolean(id)) },
        deletedAt: null,
        ...scope,
      },
      { fields: ['id', 'name', 'slug'] },
      scope,
    ),
  ])
  const mediaByService = new Map<string, unknown[]>()
  for (const row of mediaRows) {
    const serviceId = typeof row.service === 'string' ? row.service : row.service?.id
    if (!serviceId) continue
    const list = mediaByService.get(serviceId) ?? []
    list.push({
      id: row.id,
      fileId: row.fileId ?? null,
      url: row.url ?? null,
      alt: row.alt ?? null,
      contentType: row.contentType ?? null,
      sortOrder: row.sortOrder,
      isDefault: row.isDefault,
      metadata: row.metadata ?? null,
    })
    mediaByService.set(serviceId, list)
  }
  const requirementsByService = new Map<string, unknown[]>()
  for (const row of requirementRows) {
    const serviceId = typeof row.service === 'string' ? row.service : row.service?.id
    if (!serviceId) continue
    const list = requirementsByService.get(serviceId) ?? []
    list.push({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId ?? null,
      labelSnapshot: row.labelSnapshot,
      allocationMode: row.allocationMode,
      allocationValue: row.allocationValue,
      sortOrder: row.sortOrder,
      metadata: row.metadata ?? null,
    })
    requirementsByService.set(serviceId, list)
  }
  const categoriesById = new Map(categories.map((category) => [category.id, category]))
  for (const item of items) {
    const category = item.category_id ? categoriesById.get(item.category_id) : null
    item.category = category
      ? { id: category.id, name: category.name, slug: category.slug ?? null }
      : null
    item.media = mediaByService.get(item.id) ?? []
    item.workRequirements = requirementsByService.get(item.id) ?? []
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogService,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: 'catalog:service',
  },
  list: {
    schema: listSchema,
    entityId: 'catalog:catalog_service',
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'title',
      'description',
      'scope',
      'category_id',
      'default_price_amount',
      'default_price_currency_code',
      'default_media_id',
      'default_media_url',
      'metadata',
      'is_active',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      title: 'title',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: buildServiceFilters,
  },
  hooks: {
    afterList: decorateServicesAfterList,
  },
  actions: {
    create: {
      commandId: 'catalog.services.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(serviceCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.serviceId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.services.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(serviceUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.services.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('catalog.errors.id_required', 'Record identifier is required.') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const workRequirementSchema = z.object({
  id: z.string().uuid(),
  targetType: z.string(),
  targetId: z.string().uuid().nullable().optional(),
  labelSnapshot: z.string(),
  allocationMode: z.string(),
  allocationValue: z.string(),
  sortOrder: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const mediaSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid().nullable().optional(),
  url: z.string().nullable().optional(),
  alt: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const serviceListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  category: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string().nullable().optional(),
  }).nullable().optional(),
  default_price_amount: z.string().nullable().optional(),
  default_price_currency_code: z.string().nullable().optional(),
  default_media_id: z.string().uuid().nullable().optional(),
  default_media_url: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.union([z.string(), z.date()]).nullable().optional(),
  updated_at: z.union([z.string(), z.date()]).nullable().optional(),
  media: z.array(mediaSchema).optional(),
  workRequirements: z.array(workRequirementSchema).optional(),
})

export const openApi = createCatalogCrudOpenApi({
  resourceName: 'Service',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(serviceListItemSchema),
  create: {
    schema: serviceCreateSchema,
    description: 'Create a catalog service.',
  },
  update: {
    schema: serviceUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Update a catalog service.',
  },
  del: {
    responseSchema: defaultOkResponseSchema,
    description: 'Delete a catalog service.',
  },
})
