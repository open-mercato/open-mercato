import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { EudrPlot } from '../../data/entities'
import { resolveDetailReadScope } from '../../lib/detail-read-scope'
import {
  EUDR_PLOT_TYPES,
  plotCreateSchema,
  plotUpdateSchema,
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
  supplierEntityId: z.string().uuid().optional(),
  plotType: z.enum(EUDR_PLOT_TYPES).optional(),
  isActive: z.string().optional(),
  originCountry: z.string().length(2).optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

type PlotListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.plots.view'] },
  POST: { requireAuth: true, requireFeatures: ['eudr.plots.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['eudr.plots.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['eudr.plots.manage'] },
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function resolveDeleteInput(parsed: unknown, ctx: { request?: Request }, translate: TranslateFn) {
  const record = parsed && typeof parsed === 'object' ? recordFrom(parsed) : {}
  const body = record.body && typeof record.body === 'object' ? recordFrom(record.body) : null
  const query = record.query && typeof record.query === 'object' ? recordFrom(record.query) : null
  const requestId = ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null
  const id = asStringOrNull(body?.id) ?? asStringOrNull(record.id) ?? asStringOrNull(query?.id) ?? requestId
  if (!id) throw new CrudHttpError(400, { error: translate('eudr.errors.plot_required', 'Plot id is required') })
  return { id }
}

function recordFrom(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

function buildFilters(query: PlotListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.supplierEntityId) filters.supplier_entity_id = { $eq: query.supplierEntityId }
  if (query.plotType) filters.plot_type = { $eq: query.plotType }
  if (query.originCountry) filters.origin_country = { $eq: query.originCountry.toUpperCase() }
  const isActive = parseBooleanToken(query.isActive)
  if (isActive !== null) filters.is_active = { $eq: isActive }
  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search) {
    const searchPattern = buildIlikeTerm(search)
    filters.$or = [
      { name: { $ilike: searchPattern } },
      { external_id: { $ilike: searchPattern } },
    ]
  }
  return filters
}

function transformPlotItem(item: unknown) {
  if (!item || typeof item !== 'object') return item
  const record = item as Record<string, unknown>
  // Bare list items intentionally omit `geometry`; the afterList hook attaches
  // it (with decryption) for id/ids detail reads only.
  return {
    id: record.id,
    supplierEntityId: record.supplier_entity_id ?? null,
    supplierSnapshot: record.supplier_snapshot ?? null,
    name: record.name ?? null,
    externalId: record.external_id ?? null,
    originCountry: record.origin_country ?? null,
    plotType: record.plot_type ?? null,
    areaHa: record.area_ha ?? null,
    validationWarnings: stringArray(record.validation_warnings),
    producerName: record.producer_name ?? null,
    isActive: typeof record.is_active === 'boolean' ? record.is_active : parseBooleanToken(typeof record.is_active === 'string' ? record.is_active : null),
    createdAt: toIsoString(record.created_at),
    updatedAt: toIsoString(record.updated_at),
  }
}

const listFields = [
  'id',
  'supplier_entity_id',
  'supplier_snapshot',
  'name',
  'external_id',
  'origin_country',
  'plot_type',
  'area_ha',
  'validation_warnings',
  'is_active',
  'created_at',
  'updated_at',
]

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EudrPlot,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.eudr.eudr_plot },
  list: {
    schema: listSchema,
    entityId: E.eudr.eudr_plot,
    fields: listFields,
    sortFieldMap: {
      created_at: 'created_at',
      createdAt: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
      name: 'name',
      area_ha: 'area_ha',
      areaHa: 'area_ha',
    },
    buildFilters,
    transformItem: transformPlotItem,
  },
  actions: {
    create: {
      commandId: 'eudr.plots.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = plotCreateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => ({ id: result?.entityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'eudr.plots.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = plotUpdateSchema.parse(base)
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
      commandId: 'eudr.plots.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return resolveDeleteInput(parsed, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const detailRead = (typeof ctx.query.id === 'string' && ctx.query.id.length > 0)
        || (typeof ctx.query.ids === 'string' && ctx.query.ids.length > 0)
      if (!detailRead) return
      const items: unknown[] = Array.isArray(payload?.items) ? payload.items : []
      if (!items.length) return
      const scope = resolveDetailReadScope(ctx)
      if (!scope) return
      const ids = items
        .map((item) => (item && typeof item === 'object' ? asStringOrNull((item as Record<string, unknown>).id) : null))
        .filter((id): id is string => id !== null)
      if (!ids.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const where: FilterQuery<EudrPlot> = {
        id: { $in: ids },
        deletedAt: null,
        tenantId: scope.tenantId,
        organizationId: scope.organizationFilter,
      }
      const decrypted = await findWithDecryption(
        em,
        EudrPlot,
        where,
        {},
        { tenantId: scope.tenantId, organizationId: scope.decryptionOrganizationId },
      )
      const byId = new Map(decrypted.map((plot) => [plot.id, plot]))
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const id = asStringOrNull(record.id)
        const plot = id ? byId.get(id) : null
        if (!plot) continue
        record.geometry = plot.geometry ?? null
        record.producerName = plot.producerName ?? null
        record.description = plot.description ?? null
      }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const plotListItemSchema = z.object({
  id: z.string().uuid(),
  supplierEntityId: z.string().uuid().nullable().optional(),
  supplierSnapshot: z.object({
    displayName: z.string().nullable().optional(),
  }).nullable().optional(),
  name: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  originCountry: z.string().nullable().optional(),
  plotType: z.enum(EUDR_PLOT_TYPES).nullable().optional(),
  areaHa: z.union([z.string(), z.number()]).nullable().optional(),
  geometry: z.unknown().nullable().optional().describe(
    'Present only on detail reads requested with id or ids; omitted from bare paginated list reads.',
  ),
  validationWarnings: z.array(z.string()),
  producerName: z.string().nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createEudrCrudOpenApi({
  resourceName: 'Plot',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(plotListItemSchema),
  create: {
    schema: plotCreateSchema,
    description: 'Creates an EUDR supplier plot for the scoped organization.',
  },
  update: {
    schema: plotUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an EUDR supplier plot.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an EUDR supplier plot by id. Request body or query may provide the identifier.',
  },
})
