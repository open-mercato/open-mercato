import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'
import { CatalogOptionSchemaTemplate } from '../../data/entities'
import {
  optionSchemaTemplateCreateSchema,
  optionSchemaTemplateUpdateSchema,
} from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as FO from '@open-mercato/core/generated/entities/catalog_option_schema_template'
import { parseBooleanFlag, sanitizeSearchTerm } from '../helpers'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    isActive: z.string().optional(),
    withDeleted: z.coerce.boolean().optional(),
  })
  .passthrough()

type SchemaQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
}

export const metadata = routeMetadata

export async function buildOptionSchemaFilters(
  query: SchemaQuery,
  ctx: { container: any; auth?: { tenantId?: string | null } },
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
  if (query.id) {
    filters.id = { $eq: query.id }
  }
  const term = sanitizeSearchTerm(query.search)
  if (term) {
    const like = `%${term}%`
    filters.$or = [
      { name: { $ilike: like } },
      { code: { $ilike: like } },
      { description: { $ilike: like } },
    ]
  }
  const active = parseBooleanFlag(query.isActive)
  if (active !== undefined) filters.is_active = active
  if (!query.withDeleted) filters.deleted_at = null
  const tenantId = ctx.auth?.tenantId ?? null
  if (tenantId) {
    try {
      const em = ctx.container.resolve('em') as EntityManager
      const cfFilters = await buildCustomFieldFiltersFromQuery({
        entityIds: [E.catalog.catalog_option_schema_template],
        query,
        em,
        tenantId,
      })
      Object.assign(filters, cfFilters)
    } catch {
      // ignore custom field filter errors and fall back to base filters
    }
  }
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogOptionSchemaTemplate,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_option_schema_template,
    fields: [
      FO.id,
      FO.name,
      FO.code,
      FO.description,
      FO.schema,
      FO.metadata,
      FO.is_active,
      FO.created_at,
      FO.updated_at,
    ],
    sortFieldMap: {
      name: FO.name,
      code: FO.code,
      createdAt: FO.created_at,
      updatedAt: FO.updated_at,
    },
    buildFilters: buildOptionSchemaFilters,
  },
  actions: {
    create: {
      commandId: 'catalog.optionSchemas.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(optionSchemaTemplateCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.schemaId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.optionSchemas.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(optionSchemaTemplateUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.optionSchemas.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('catalog.errors.id_required', 'Option schema id is required.'),
          })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud
