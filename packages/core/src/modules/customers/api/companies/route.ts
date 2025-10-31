/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerEntity } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { companyCreateSchema, companyUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'
import {
  buildCustomFieldFiltersFromQuery,
  extractAllCustomFieldEntries,
  splitCustomFieldPayload,
} from '@open-mercato/shared/lib/crud/custom-fields'
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
    search: z.string().optional(),
    email: z.string().optional(),
    emailStartsWith: z.string().optional(),
    emailContains: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    status: z.string().optional(),
    lifecycleStage: z.string().optional(),
    source: z.string().optional(),
    hasEmail: z.string().optional(),
    hasPhone: z.string().optional(),
    hasNextInteraction: z.string().optional(),
    createdFrom: z.string().optional(),
    createdTo: z.string().optional(),
    id: z.string().uuid().optional(),
    tagIds: z.string().optional(),
    tagIdsEmpty: z.string().optional(),
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
      'primary_email',
      'primary_phone',
      'status',
      'lifecycle_stage',
      'source',
      'next_interaction_at',
      'next_interaction_name',
      'next_interaction_ref_id',
      'next_interaction_icon',
      'next_interaction_color',
      'organization_id',
      'tenant_id',
      'kind',
      'created_at',
    ],
    sortFieldMap: {
      name: 'display_name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: any, ctx) => {
      const filters: Record<string, any> = { kind: { $eq: 'company' } }
      if (query.id) filters.id = { $eq: query.id }
      if (query.search) {
        filters.display_name = { $ilike: `%${query.search}%` }
      }
      if (query.status) {
        filters.status = { $eq: query.status }
      }
      if (query.lifecycleStage) {
        filters.lifecycle_stage = { $eq: query.lifecycleStage }
      }
      if (query.source) {
        filters.source = { $eq: query.source }
      }
      const tagIdsRaw = typeof query.tagIds === 'string' ? query.tagIds : ''
      const tagIds = tagIdsRaw
        .split(',')
        .map((value: string) => value.trim())
        .filter((value: string) => value.length > 0)
      const tagIdsEmpty = query.tagIdsEmpty === 'true'
      if (tagIdsEmpty) {
        filters.id = { $eq: '00000000-0000-0000-0000-000000000000' }
      } else if (tagIds.length > 0) {
        filters['tag_assignments.tag_id'] = { $in: tagIds }
      }
      const email = typeof query.email === 'string' ? query.email.trim().toLowerCase() : ''
      const emailStartsWith = typeof query.emailStartsWith === 'string' ? query.emailStartsWith.trim().toLowerCase() : ''
      const emailContains = typeof query.emailContains === 'string' ? query.emailContains.trim().toLowerCase() : ''
      if (email) {
        filters.primary_email = { $eq: email }
      } else if (emailStartsWith) {
        filters.primary_email = { $ilike: `${emailStartsWith}%` }
      } else if (emailContains) {
        filters.primary_email = { $ilike: `%${emailContains}%` }
      }
      const hasEmail = query.hasEmail === 'true' ? true : query.hasEmail === 'false' ? false : undefined
      if (!email && !emailStartsWith && !emailContains && hasEmail !== undefined) {
        filters.primary_email = { $exists: hasEmail }
      }
      const hasPhone = query.hasPhone === 'true' ? true : query.hasPhone === 'false' ? false : undefined
      if (hasPhone !== undefined) {
        filters.primary_phone = { $exists: hasPhone }
      }
      const hasNextInteraction = query.hasNextInteraction === 'true' ? true : query.hasNextInteraction === 'false' ? false : undefined
      if (hasNextInteraction !== undefined) {
        filters.next_interaction_at = { $exists: hasNextInteraction }
      }
      const createdRange: Record<string, Date> = {}
      if (query.createdFrom) {
        const from = new Date(query.createdFrom)
        if (!Number.isNaN(from.getTime())) createdRange.$gte = from
      }
      if (query.createdTo) {
        const to = new Date(query.createdTo)
        if (!Number.isNaN(to.getTime())) createdRange.$lte = to
      }
      if (Object.keys(createdRange).length) {
        filters.created_at = createdRange
      }
      if (ctx) {
        try {
          const em = ctx.container.resolve('em') as any
          const cfFilters = await buildCustomFieldFiltersFromQuery({
            entityIds: [E.customers.customer_entity, E.customers.customer_company_profile],
            query,
            em,
            tenantId: ctx.auth?.tenantId ?? null,
          })
          Object.assign(filters, cfFilters)
        } catch {
          // ignore custom field filter errors; fall back to base filters
        }
      }
      return filters
    },
    customFieldSources: [
      {
        entityId: E.customers.customer_company_profile,
        table: 'customer_companies',
        alias: 'company_profile',
        recordIdColumn: 'id',
        join: { fromField: 'id', toField: 'entity_id' },
      },
    ],
    joins: [
      {
        alias: 'tag_assignments',
        table: 'customer_tag_assignments',
        from: { field: 'id' },
        to: { field: 'entity_id' },
        type: 'left',
      },
    ],
    transformItem: (item: any) => {
      if (!item) return item
      const normalized = { ...item }
      delete normalized.kind
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
      commandId: 'customers.companies.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = companyCreateSchema.parse(base)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
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
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = companyUpdateSchema.parse(base)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.companies.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
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

const companyListItemSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().optional(),
  description: z.string().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  primary_email: z.string().nullable().optional(),
  primary_phone: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  lifecycle_stage: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  next_interaction_at: z.string().nullable().optional(),
  next_interaction_name: z.string().nullable().optional(),
  next_interaction_ref_id: z.string().nullable().optional(),
  next_interaction_icon: z.string().nullable().optional(),
  next_interaction_color: z.string().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
})

const companyCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  companyId: z.string().uuid().nullable(),
})

export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Company',
  pluralName: 'Companies',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(companyListItemSchema),
  create: {
    schema: companyCreateSchema,
    responseSchema: companyCreateResponseSchema,
    description: 'Creates a company record and associated profile data.',
  },
  update: {
    schema: companyUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates company profile fields, tags, or custom attributes.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a company by id. The identifier can be provided via body or query.',
  },
})
