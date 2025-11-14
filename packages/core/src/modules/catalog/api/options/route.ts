import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildCustomFieldFiltersFromQuery, extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogProductOption } from '../../data/entities'
import { optionCreateSchema, optionUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as FO from '@open-mercato/core/generated/entities/catalog_product_option'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    productId: z.string().uuid().optional(),
    code: z.string().optional(),
    isRequired: z.string().optional(),
    isMultiple: z.string().optional(),
    withDeleted: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type OptionQuery = z.infer<typeof listSchema>

const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['catalog.options.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.options.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['catalog.options.manage'] },
}

export const routeMetadata = metadata
export { metadata }

export function sanitizeSearch(value?: string): string {
  if (!value) return ''
  return value.trim().replace(/[%_]/g, '')
}

export function parseBoolean(raw?: string): boolean | undefined {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

export async function buildOptionFilters(
  query: OptionQuery
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
  const term = sanitizeSearch(query.search)
  if (term) {
    const like = `%${term}%`
    filters.$or = [
      { label: { $ilike: like } },
      { code: { $ilike: like } },
      { description: { $ilike: like } },
    ]
  }
  if (query.productId) filters.product_id = { $eq: query.productId }
  if (query.code && query.code.trim()) filters.code = { $eq: query.code.trim().toLowerCase() }
  const isRequired = parseBoolean(query.isRequired)
  if (isRequired !== undefined) filters.is_required = isRequired
  const isMultiple = parseBoolean(query.isMultiple)
  if (isMultiple !== undefined) filters.is_multiple = isMultiple
  return filters
}

const crud = makeCrudRoute({
  metadata,
  orm: {
    entity: CatalogProductOption,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_product_option,
    fields: [
      FO.id,
      FO.product_id,
      FO.code,
      FO.label,
      FO.description,
      FO.position,
      FO.is_required,
      FO.is_multiple,
      FO.input_type,
      FO.input_config,
      FO.metadata,
      FO.created_at,
      FO.updated_at,
    ],
    sortFieldMap: {
      label: FO.label,
      code: FO.code,
      position: FO.position,
      createdAt: FO.created_at,
      updatedAt: FO.updated_at,
    },
    buildFilters: async (query, ctx) => {
      const filters = await buildOptionFilters(query)
      const tenantId = ctx.auth?.tenantId ?? null
      try {
        const em = ctx.container.resolve('em') as EntityManager
        const cfFilters = await buildCustomFieldFiltersFromQuery({
          entityIds: [E.catalog.catalog_product_option],
          query,
          em,
          tenantId,
        })
        Object.assign(filters, cfFilters)
      } catch {
        // ignore
      }
      return filters
    },
    customFieldSources: [
      {
        entityId: E.catalog.catalog_product_option,
        table: 'catalog_product_options',
        alias: 'catalog_product_options',
        recordIdColumn: 'id',
      },
    ],
    transformItem: (item: any) => {
      if (!item) return item
      const normalized = { ...item }
      const cfEntries = extractAllCustomFieldEntries(item)
      for (const key of Object.keys(normalized)) {
        if (key.startsWith('cf:')) delete normalized[key]
      }
      return { ...normalized, ...cfEntries }
    },
  },
  actions: {
    create: {
      commandId: 'catalog.options.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(optionCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.optionId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.options.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(optionUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.options.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('catalog.errors.id_required', 'Option id is required.') })
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
