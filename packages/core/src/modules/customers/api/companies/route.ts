/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { companyCreateSchema, companyUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    status: z.string().optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.companies.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.companies.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.companies.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.companies.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerEntity,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.customers.customer_entity,
    fields: [
      'id',
      'display_name',
      'description',
      'owner_user_id',
      'status',
      'lifecycle_stage',
      'source',
      'next_interaction_at',
      'next_interaction_name',
      'next_interaction_ref_id',
      'organization_id',
      'tenant_id',
      'kind',
    ],
    sortFieldMap: {
      name: 'display_name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = { kind: { $eq: 'company' } }
      if (query.search) {
        filters.display_name = { $ilike: `%${query.search}%` }
      }
      if (query.status) {
        filters.status = { $eq: query.status }
      }
      return filters
    },
    transformItem: (item: any) => {
      if (item) delete item.kind
      return item
    },
  },
  actions: {
    create: {
      commandId: 'customers.companies.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return companyCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({
        id: result?.entityId ?? result?.id ?? null,
        companyId: result?.companyId ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'customers.companies.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return companyUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.companies.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = parsed?.id ?? (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.company_required', 'Company id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
