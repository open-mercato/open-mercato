import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogAttributeSchemaTemplate } from '../../data/entities'
import {
  attributeSchemaTemplateCreateSchema,
  attributeSchemaTemplateUpdateSchema,
} from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/catalog_attribute_schema_template'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
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

export function sanitizeSearchTerm(value?: string): string {
  if (!value) return ''
  return value.trim().replace(/[%_]/g, '')
}

export function parseBooleanFlag(raw?: string): boolean | undefined {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

export async function buildFilters(query: SchemaQuery): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
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
  if (active !== undefined) {
    filters.is_active = active
  }
  if (!query.withDeleted) {
    filters.deleted_at = null
  }
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogAttributeSchemaTemplate,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_attribute_schema_template,
    fields: [
      F.id,
      F.name,
      F.code,
      F.description,
      F.schema,
      F.metadata,
      F.is_active,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
      code: F.code,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters,
  },
  actions: {
    create: {
      commandId: 'catalog.attributeSchemas.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(attributeSchemaTemplateCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.schemaId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.attributeSchemas.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(attributeSchemaTemplateUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.attributeSchemas.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('catalog.errors.id_required', 'Attribute schema id is required.'),
          })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const { GET, POST, PUT, DELETE } = crud
