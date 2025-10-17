/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerActivity } from '../../data/entities'
import { activityCreateSchema, activityUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    entityId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    activityType: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.activities.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerActivity,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    entityId: E.customers.customer_activity,
    fields: [
      'id',
      'entity_id',
      'deal_id',
      'activity_type',
      'subject',
      'body',
      'occurred_at',
      'author_user_id',
      'organization_id',
      'tenant_id',
      'created_at',
    ],
    sortFieldMap: {
      occurredAt: 'occurred_at',
      createdAt: 'created_at',
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.entityId) filters.entity_id = { $eq: query.entityId }
      if (query.dealId) filters.deal_id = { $eq: query.dealId }
      if (query.activityType) filters.activity_type = { $eq: query.activityType }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'customers.activities.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const tenantId = raw?.tenantId ?? ctx.auth?.tenantId ?? null
        if (!tenantId) throw new CrudHttpError(400, { error: translate('customers.errors.tenant_required', 'Tenant context is required') })
        const organizationId = raw?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
        if (!organizationId) throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
        return activityCreateSchema.parse({
          ...raw,
          tenantId,
          organizationId,
        })
      },
      response: ({ result }) => ({ id: result?.activityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.activities.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const tenantId = raw?.tenantId ?? ctx.auth?.tenantId ?? null
        if (!tenantId) throw new CrudHttpError(400, { error: translate('customers.errors.tenant_required', 'Tenant context is required') })
        const organizationId = raw?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
        if (!organizationId) throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
        return activityUpdateSchema.parse({
          ...raw,
          tenantId,
          organizationId,
        })
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.activities.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = parsed?.id ?? (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.activity_required', 'Activity id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
