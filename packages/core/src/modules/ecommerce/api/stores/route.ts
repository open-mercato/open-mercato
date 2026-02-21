import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { EcommerceStore } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { storeCreateSchema, storeUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  createEcommerceCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
  defaultCreateResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    id: z.string().uuid().optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
  POST: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EcommerceStore,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: (E as Record<string, Record<string, string>>).ecommerce?.ecommerce_store ?? 'ecommerce:ecommerce_store',
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'code',
      'name',
      'slug',
      'status',
      'default_locale',
      'supported_locales',
      'default_currency_code',
      'is_primary',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      code: 'code',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) {
        filters.id = { $eq: query.id }
      }
      if (query.search) {
        filters['$or'] = [
          { name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { code: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        ]
      }
      if (query.status) {
        filters.status = { $eq: query.status }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'ecommerce.stores.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return storeCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'ecommerce.stores.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return storeUpdateSchema.parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'ecommerce.stores.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: 'Store id is required' })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const storeListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  code: z.string().optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  default_locale: z.string().nullable().optional(),
  supported_locales: z.array(z.string()).nullable().optional(),
  default_currency_code: z.string().nullable().optional(),
  is_primary: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createEcommerceCrudOpenApi({
  resourceName: 'Store',
  pluralName: 'Stores',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(storeListItemSchema),
  create: {
    schema: storeCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description: 'Creates a new ecommerce store scoped to the authenticated organization.',
  },
  update: {
    schema: storeUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates store configuration.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a store by id.',
  },
})
