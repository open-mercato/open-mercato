import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { EcommerceStoreChannelBinding } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { storeChannelBindingCreateSchema, storeChannelBindingUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
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
    storeId: z.string().uuid().optional(),
    salesChannelId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ecommerce.storefront.view'] },
  POST: { requireAuth: true, requireFeatures: ['ecommerce.storefront.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['ecommerce.storefront.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ecommerce.storefront.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EcommerceStoreChannelBinding,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: (E as Record<string, Record<string, string>>).ecommerce?.ecommerce_store_channel_binding ?? 'ecommerce:ecommerce_store_channel_binding',
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'store_id',
      'sales_channel_id',
      'price_kind_id',
      'catalog_scope',
      'is_default',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.storeId) {
        filters.store_id = { $eq: query.storeId }
      }
      if (query.salesChannelId) {
        filters.sales_channel_id = { $eq: query.salesChannelId }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'ecommerce.store_channel_bindings.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return storeChannelBindingCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'ecommerce.store_channel_bindings.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return storeChannelBindingUpdateSchema.parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'ecommerce.store_channel_bindings.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: 'Store channel binding id is required' })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const bindingListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  store_id: z.string().uuid().nullable().optional(),
  sales_channel_id: z.string().uuid().nullable().optional(),
  price_kind_id: z.string().uuid().nullable().optional(),
  catalog_scope: z.record(z.string(), z.unknown()).nullable().optional(),
  is_default: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createEcommerceCrudOpenApi({
  resourceName: 'Store Channel Binding',
  pluralName: 'Store Channel Bindings',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(bindingListItemSchema),
  create: {
    schema: storeChannelBindingCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description: 'Binds a sales channel to a store with optional pricing and catalog scope overrides.',
  },
  update: {
    schema: storeChannelBindingUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates the sales channel binding configuration.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Removes a sales channel binding from a store.',
  },
})
