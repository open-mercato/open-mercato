/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { personCreateSchema, personUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.people.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.people.manage'] },
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
      'primary_email',
      'primary_phone',
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
      const filters: Record<string, any> = { kind: { $eq: 'person' } }
      if (query.search) {
        filters.display_name = { $ilike: `%${query.search}%` }
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
      commandId: 'customers.people.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const tenantId = raw?.tenantId ?? ctx.auth?.tenantId ?? null
        if (!tenantId) {
          throw new CrudHttpError(400, { error: translate('customers.errors.tenant_required', 'Tenant context is required') })
        }
        const organizationId = raw?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
        if (!organizationId) {
          throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
        }
        const payload = personCreateSchema.parse({
          ...raw,
          tenantId,
          organizationId,
        })
        return payload
      },
      response: ({ result }) => ({
        id: result?.entityId ?? result?.id ?? null,
        personId: result?.personId ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'customers.people.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const tenantId = raw?.tenantId ?? ctx.auth?.tenantId ?? null
        if (!tenantId) {
          throw new CrudHttpError(400, { error: translate('customers.errors.tenant_required', 'Tenant context is required') })
        }
        const organizationId = raw?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
        if (!organizationId) {
          throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
        }
        return personUpdateSchema.parse({
          ...raw,
          tenantId,
          organizationId,
        })
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.people.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = parsed?.id ?? (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.person_required', 'Person id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
