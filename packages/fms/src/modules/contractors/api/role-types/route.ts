import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ContractorRoleType } from '../../data/entities'
import { contractorRoleTypeCreateSchema, contractorRoleTypeUpdateSchema, contractorRoleCategories } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(100),
    category: z.enum(contractorRoleCategories).optional(),
    isActive: z.coerce.boolean().optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['contractors.view'] },
  POST: { requireAuth: true, requireFeatures: ['contractors.admin'] },
  PUT: { requireAuth: true, requireFeatures: ['contractors.admin'] },
  DELETE: { requireAuth: true, requireFeatures: ['contractors.admin'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ContractorRoleType,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: null,
  },
  list: {
    schema: listSchema,
    fields: [
      'id',
      'code',
      'name',
      'category',
      'description',
      'color',
      'icon',
      'has_custom_fields',
      'sort_order',
      'is_system',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      code: 'code',
      category: 'category',
      sortOrder: 'sort_order',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: z.infer<typeof listSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.category) filters.category = { $eq: query.category }
      if (typeof query.isActive === 'boolean') filters.is_active = { $eq: query.isActive }
      if (query.search) {
        const pattern = `%${escapeLikePattern(query.search)}%`
        filters.$or = [
          { name: { $ilike: pattern } },
          { code: { $ilike: pattern } },
          { description: { $ilike: pattern } },
        ]
      }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      description: item.description ?? null,
      color: item.color ?? null,
      icon: item.icon ?? null,
      hasCustomFields: item.has_custom_fields ?? false,
      sortOrder: item.sort_order ?? 0,
      isSystem: item.is_system ?? false,
      isActive: item.is_active ?? true,
      organizationId: item.organization_id,
      tenantId: item.tenant_id,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  actions: {
    create: {
      commandId: 'contractors.role-types.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return contractorRoleTypeCreateSchema.parse(scoped)
      },
      response: ({ result }) => ({ id: result?.roleTypeId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'contractors.role-types.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return contractorRoleTypeUpdateSchema.extend({
          id: z.string().uuid(),
        }).parse(scoped)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'contractors.role-types.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('contractors.validation.roleTypeIdRequired', 'Role type id is required') })
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
