import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { EcommerceStoreDomain } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { storeDomainCreateSchema, storeDomainUpdateSchema } from '../../data/validators'
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
    storeId: z.string().uuid().optional(),
    verificationStatus: z.enum(['pending', 'verified', 'failed']).optional(),
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
    entity: EcommerceStoreDomain,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: (E as Record<string, Record<string, string>>).ecommerce?.ecommerce_store_domain ?? 'ecommerce:ecommerce_store_domain',
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'store_id',
      'host',
      'is_primary',
      'tls_mode',
      'verification_status',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      host: 'host',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.storeId) {
        filters.store_id = { $eq: query.storeId }
      }
      if (query.search) {
        filters.host = { $ilike: `%${escapeLikePattern(query.search)}%` }
      }
      if (query.verificationStatus) {
        filters.verification_status = { $eq: query.verificationStatus }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'ecommerce.store_domains.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return storeDomainCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'ecommerce.store_domains.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return storeDomainUpdateSchema.parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'ecommerce.store_domains.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: 'Store domain id is required' })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const domainListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  store_id: z.string().uuid().nullable().optional(),
  host: z.string().optional(),
  is_primary: z.boolean().nullable().optional(),
  tls_mode: z.string().nullable().optional(),
  verification_status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createEcommerceCrudOpenApi({
  resourceName: 'Store Domain',
  pluralName: 'Store Domains',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(domainListItemSchema),
  create: {
    schema: storeDomainCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description: 'Adds a custom domain to a store.',
  },
  update: {
    schema: storeDomainUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates domain configuration or verification status.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Removes a domain from a store.',
  },
})
