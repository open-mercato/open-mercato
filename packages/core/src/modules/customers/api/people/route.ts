/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { personUpdateSchema } from '../../data/validators'

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

function ensureScopedInput(body: any, ctx: any, { requireOrganization = true }: { requireOrganization?: boolean } = {}) {
  const tenantId = body?.tenantId ?? ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'tenantId is required' })
  const resolvedOrgId = body?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (requireOrganization && !resolvedOrgId) {
    throw new CrudHttpError(400, { error: 'organizationId is required' })
  }
  const payload = { ...body, tenantId }
  if (resolvedOrgId) payload.organizationId = resolvedOrgId
  return payload
}

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
        const merged = ensureScopedInput(raw ?? {}, ctx)
        return merged
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
        const merged = ensureScopedInput(raw ?? {}, ctx)
        const parsed = personUpdateSchema.parse(merged)
        return parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.people.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const id = parsed?.id ?? (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: 'Person id is required' })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
