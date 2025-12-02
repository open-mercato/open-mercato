import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesDocumentTag } from '../../data/entities'
import { salesTagCreateSchema, salesTagUpdateSchema } from '../../data/validators'
import { withScopedPayload } from '../utils'
import { createPagedListResponseSchema, createSalesCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { slugifyTagLabel } from '@open-mercato/shared/lib/utils'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.orders.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.orders.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesDocumentTag,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: null,
  },
  list: {
    schema: listSchema,
    fields: ['id', 'slug', 'label', 'color', 'description', 'organization_id', 'tenant_id'],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.search) {
        filters.$or = [
          { label: { $ilike: `%${query.search}%` } },
          { slug: { $ilike: `%${query.search}%` } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'sales.tags.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        try {
          const scoped = withScopedPayload(raw ?? {}, ctx, translate)
          const slug =
            typeof scoped.slug === 'string' && scoped.slug.trim().length
              ? scoped.slug.trim()
              : typeof scoped.label === 'string'
                ? slugifyTagLabel(scoped.label)
                : scoped.slug
          const payload = { ...scoped, slug }
          return salesTagCreateSchema.parse(payload)
        } catch {
          throw new CrudHttpError(400, { error: translate('sales.errors.tag_invalid', 'Invalid tag payload') })
        }
      },
      response: ({ result }) => ({ id: result?.tagId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.tags.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        try {
          return salesTagUpdateSchema.parse(raw ?? {})
        } catch {
          throw new CrudHttpError(400, { error: translate('sales.errors.tag_invalid', 'Invalid tag payload') })
        }
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.tags.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('sales.errors.tag_required', 'Tag id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud
export { POST, PUT, DELETE }
export const GET = crud.GET

const tagSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Sales tag',
  pluralName: 'Sales tags',
  description: 'Manage reusable tags to categorize sales orders and quotes.',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(tagSchema),
  create: {
    schema: salesTagCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a sales document tag.',
  },
  update: {
    schema: salesTagUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing sales tag.',
  },
  del: {
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a sales tag.',
  },
})
