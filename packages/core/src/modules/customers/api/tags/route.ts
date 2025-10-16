/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerTag } from '../../data/entities'
import { tagCreateSchema, tagUpdateSchema } from '../../data/validators'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

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
  GET: { requireAuth: true, requireFeatures: ['customers.activities.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

export const metadata = routeMetadata

function ensureScopedInput(body: any, ctx: any) {
  const tenantId = body?.tenantId ?? ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'tenantId is required' })
  const organizationId = body?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: 'organizationId is required' })
  return { ...body, tenantId, organizationId }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerTag,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    entityId: E.customers.customer_tag,
    fields: ['id', 'slug', 'label', 'color', 'description', 'organization_id', 'tenant_id'],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.search) {
        filters.label = { $ilike: `%${query.search}%` }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'customers.tags.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => tagCreateSchema.parse(ensureScopedInput(raw ?? {}, ctx)),
      response: ({ result }) => ({ id: result?.tagId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.tags.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => tagUpdateSchema.parse(ensureScopedInput(raw ?? {}, ctx)),
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.tags.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const id = parsed?.id ?? (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: 'Tag id is required' })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET
