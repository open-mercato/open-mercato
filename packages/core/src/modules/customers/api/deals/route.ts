/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDeal } from '../../data/entities'
import { dealCreateSchema, dealUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    status: z.string().optional(),
    pipelineStage: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerDeal,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.customers.customer_deal,
    fields: [
      'id',
      'title',
      'description',
      'status',
      'pipeline_stage',
      'value_amount',
      'value_currency',
      'probability',
      'expected_close_at',
      'owner_user_id',
      'source',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      title: 'title',
      value: 'value_amount',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.search) {
        filters.title = { $ilike: `%${query.search}%` }
      }
      if (query.status) {
        filters.status = { $eq: query.status }
      }
      if (query.pipelineStage) {
        filters.pipeline_stage = { $eq: query.pipelineStage }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'customers.deals.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const tenantId = raw?.tenantId ?? ctx.auth?.tenantId ?? null
        if (!tenantId) throw new CrudHttpError(400, { error: translate('customers.errors.tenant_required', 'Tenant context is required') })
        const organizationId = raw?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
        if (!organizationId) throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
        return dealCreateSchema.parse({
          ...raw,
          tenantId,
          organizationId,
        })
      },
      response: ({ result }) => ({ id: result?.dealId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.deals.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const tenantId = raw?.tenantId ?? ctx.auth?.tenantId ?? null
        if (!tenantId) throw new CrudHttpError(400, { error: translate('customers.errors.tenant_required', 'Tenant context is required') })
        const organizationId = raw?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
        if (!organizationId) throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
        return dealUpdateSchema.parse({
          ...raw,
          tenantId,
          organizationId,
        })
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.deals.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = parsed?.id ?? (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.deal_required', 'Deal id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
