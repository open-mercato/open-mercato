import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import { EudrProductMapping } from '../../data/entities'
import {
  EUDR_COMMODITIES,
  productMappingCreateSchema,
  productMappingUpdateSchema,
} from '../../data/validators'
import {
  createEudrCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

type TranslateFn = (key: string, fallback?: string) => string

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  commodity: z.enum(EUDR_COMMODITIES).optional(),
  isInScope: z.string().optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

type ProductMappingListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.mappings.view'] },
  POST: { requireAuth: true, requireFeatures: ['eudr.mappings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['eudr.mappings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['eudr.mappings.manage'] },
}

export const metadata = routeMetadata

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function resolveDeleteInput(parsed: unknown, ctx: { request?: Request }, translate: TranslateFn) {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const body = record.body && typeof record.body === 'object' ? record.body as Record<string, unknown> : null
  const query = record.query && typeof record.query === 'object' ? record.query as Record<string, unknown> : null
  const requestId = ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null
  const id = asStringOrNull(body?.id) ?? asStringOrNull(record.id) ?? asStringOrNull(query?.id) ?? requestId
  if (!id) throw new CrudHttpError(400, { error: translate('eudr.errors.mapping_required', 'Product mapping id is required') })
  return { id }
}

function buildFilters(query: ProductMappingListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.commodity) filters.commodity = { $eq: query.commodity }
  const isInScope = parseBooleanToken(query.isInScope)
  if (isInScope !== null) filters.is_in_scope = { $eq: isInScope }
  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search) {
    const searchPattern = buildIlikeTerm(search)
    filters.$or = [
      { commodity: { $ilike: searchPattern } },
      { hs_code: { $ilike: searchPattern } },
      { notes: { $ilike: searchPattern } },
    ]
  }
  return filters
}

function transformProductMappingItem(item: unknown) {
  if (!item || typeof item !== 'object') return item
  const record = item as Record<string, unknown>
  return {
    id: record.id,
    productId: record.product_id ?? null,
    productSnapshot: record.product_snapshot ?? null,
    commodity: record.commodity ?? null,
    hsCode: record.hs_code ?? null,
    isInScope: typeof record.is_in_scope === 'boolean' ? record.is_in_scope : parseBooleanToken(typeof record.is_in_scope === 'string' ? record.is_in_scope : null),
    notes: record.notes ?? null,
    createdAt: toIsoString(record.created_at),
    updatedAt: toIsoString(record.updated_at),
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EudrProductMapping,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.eudr.eudr_product_mapping },
  list: {
    schema: listSchema,
    entityId: E.eudr.eudr_product_mapping,
    fields: [
      'id',
      'product_id',
      'product_snapshot',
      'commodity',
      'hs_code',
      'is_in_scope',
      'notes',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      created_at: 'created_at',
      createdAt: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
      commodity: 'commodity',
      productId: 'product_id',
      hsCode: 'hs_code',
      isInScope: 'is_in_scope',
    },
    buildFilters,
    transformItem: transformProductMappingItem,
  },
  actions: {
    create: {
      commandId: 'eudr.product_mappings.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = productMappingCreateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => ({ id: result?.entityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'eudr.product_mappings.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = productMappingUpdateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => {
        const updatedAt = result?.updatedAt
        return {
          ok: true,
          updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : (typeof updatedAt === 'string' ? updatedAt : null),
        }
      },
    },
    delete: {
      commandId: 'eudr.product_mappings.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return resolveDeleteInput(parsed, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const productMappingListItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable().optional(),
  productSnapshot: z.object({
    name: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
  }).nullable().optional(),
  commodity: z.enum(EUDR_COMMODITIES).nullable().optional(),
  hsCode: z.string().nullable().optional(),
  isInScope: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createEudrCrudOpenApi({
  resourceName: 'Product mapping',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(productMappingListItemSchema),
  create: {
    schema: productMappingCreateSchema,
    description: 'Creates an EUDR product commodity mapping for the scoped organization.',
  },
  update: {
    schema: productMappingUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an EUDR product commodity mapping.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an EUDR product commodity mapping by id. Request body or query may provide the identifier.',
  },
})
