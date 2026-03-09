import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerBranch, CustomerEntity } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { branchCreateSchema, branchUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
import {
  splitCustomFieldPayload,
  extractAllCustomFieldEntries,
} from '@open-mercato/shared/lib/crud/custom-fields'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  createCustomersCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    companyEntityId: z.string().uuid().optional(),
    search: z.string().optional(),
    branchType: z.string().optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.branches.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.branches.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.branches.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.branches.manage'] },
}

export const metadata = routeMetadata

const BRANCH_ENTITY_TYPE = E.customers.customer_branch

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CustomerBranch,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: BRANCH_ENTITY_TYPE },
  list: {
    schema: listSchema,
    entityId: BRANCH_ENTITY_TYPE,
    fields: [
      'id',
      'company_entity_id',
      'name',
      'branch_type',
      'specialization',
      'budget',
      'headcount',
      'responsible_person_id',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      branchType: 'branch_type',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.companyEntityId) {
        filters.company_entity_id = { $eq: query.companyEntityId }
      }
      if (query.search) {
        filters.name = { $ilike: `%${escapeLikePattern(query.search)}%` }
      }
      if (query.branchType) {
        filters.branch_type = { $eq: query.branchType }
      }
      if (query.isActive === 'true') {
        filters.is_active = { $eq: true }
      } else if (query.isActive === 'false') {
        filters.is_active = { $eq: false }
      }
      return filters
    },
    transformItem: (item) => {
      if (!item) return item
      const normalized = { ...item }
      const cfEntries = extractAllCustomFieldEntries(item)
      for (const key of Object.keys(normalized)) {
        if (key.startsWith('cf:')) {
          delete normalized[key]
        }
      }
      return { ...normalized, ...cfEntries }
    },
  },
  actions: {
    create: {
      commandId: 'customers.branches.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        if (!base.organizationId && base.companyEntityId) {
          const em = ctx.container.resolve('em') as EntityManager
          const company = await findOneWithDecryption(em, CustomerEntity, {
            id: base.companyEntityId as string,
            deletedAt: null,
          })
          if (company?.organizationId) {
            base.organizationId = company.organizationId
          }
        }
        const parsed = branchCreateSchema.parse(base)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
      },
      response: ({ result }) => ({
        id: result?.branchId ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'customers.branches.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = branchUpdateSchema.parse(base)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.branches.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.branch_required', 'Branch id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const branchListItemSchema = z.object({
  id: z.string().uuid(),
  company_entity_id: z.string().uuid(),
  name: z.string(),
  branch_type: z.string().nullable().optional(),
  specialization: z.string().nullable().optional(),
  budget: z.string().nullable().optional(),
  headcount: z.number().nullable().optional(),
  responsible_person_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

const branchCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Branch',
  pluralName: 'Branches',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(branchListItemSchema),
  create: {
    schema: branchCreateSchema,
    responseSchema: branchCreateResponseSchema,
    description: 'Creates a branch record for a company.',
  },
  update: {
    schema: branchUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates branch fields.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a branch by id.',
  },
})
