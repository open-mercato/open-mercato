import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorRole } from '../../data/entities'
import { contractorRoleAssignSchema, contractorRoleUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    contractorId: z.string().uuid().optional(),
    roleTypeId: z.string().uuid().optional(),
    isActive: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['contractors.view'] },
  POST: { requireAuth: true, requireFeatures: ['contractors.manage_roles'] },
  PUT: { requireAuth: true, requireFeatures: ['contractors.manage_roles'] },
  DELETE: { requireAuth: true, requireFeatures: ['contractors.manage_roles'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ContractorRole,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    fields: [
      'id',
      'contractor_id',
      'role_type_id',
      'settings',
      'is_active',
      'effective_from',
      'effective_to',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof listSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.contractorId) filters.contractor_id = { $eq: query.contractorId }
      if (query.roleTypeId) filters.role_type_id = { $eq: query.roleTypeId }
      if (typeof query.isActive === 'boolean') filters.is_active = { $eq: query.isActive }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: item.id,
      contractorId: item.contractor_id,
      roleTypeId: item.role_type_id,
      settings: item.settings ?? null,
      isActive: item.is_active ?? true,
      effectiveFrom: item.effective_from ?? null,
      effectiveTo: item.effective_to ?? null,
      organizationId: item.organization_id,
      tenantId: item.tenant_id,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  actions: {
    create: {
      commandId: 'contractors.roles.assign',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return contractorRoleAssignSchema.extend({
          contractorId: z.string().uuid(),
        }).parse(scoped)
      },
      response: ({ result }) => ({ id: result?.roleId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'contractors.roles.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return contractorRoleUpdateSchema.extend({
          id: z.string().uuid(),
        }).parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'contractors.roles.remove',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('contractors.validation.roleIdRequired', 'Role assignment id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
