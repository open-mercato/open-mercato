/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerCompanyProfile, CustomerEntity } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { companyCreateSchema, companyUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  applyEntityIdRestriction,
  consumeAdvancedFilterState,
  findMatchingEntityIdsWithQueryEngine,
  findMatchingEntityIdsBySearchTokensAcrossSources,
  withScopedPayload,
} from '../utils'
import {
  buildCustomFieldFiltersFromQuery,
  extractAllCustomFieldEntries,
  splitCustomFieldPayload,
} from '@open-mercato/shared/lib/crud/custom-fields'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { mergeAdvancedFilters } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
import {
  createCustomersCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import { normalizeCompanyProfilePayload } from './payload'

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
  GET: { requireAuth: true, requireFeatures: ['customers.company.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.company.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.company.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.company.manage'] },
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
      const advancedQuery = { ...query }
      const advancedFilterState = consumeAdvancedFilterState(query)
      const filters: Record<string, any> = { kind: { $eq: 'company' } }
      if (query.id) filters.id = { $eq: query.id }
      if (query.search) {
        const matchingIds = ctx
          ? await findMatchingEntityIdsBySearchTokensAcrossSources({
              ctx,
              query: query.search,
              sources: [
                {
                  entityType: E.customers.customer_entity,
                  fields: [
                    'display_name',
                    'primary_email',
                    'primary_phone',
                    'description',
                    'status',
                    'lifecycle_stage',
                    'source',
                    'next_interaction_name',
                  ],
                },
                {
                  entityType: E.customers.customer_company_profile,
                  fields: [
                    'display_name',
                    'primary_email',
                    'primary_phone',
                    'description',
                    'status',
                    'lifecycle_stage',
                    'source',
                    'legal_name',
                    'brand_name',
                    'domain',
                    'website_url',
                    'industry',
                    'size_bucket',
                    'annual_revenue',
                  ],
                  mapToEntityIds: {
                    table: 'customer_companies',
                    targetColumn: 'entity_id',
                  },
                },
              ],
            })
          : null
        if (matchingIds !== null && matchingIds.length > 0) {
          applyEntityIdRestriction(filters, matchingIds)
        } else {
          const searchPattern = `%${escapeLikePattern(query.search)}%`
          filters.$or = [
            { display_name: { $ilike: searchPattern } },
            { primary_email: { $ilike: searchPattern } },
            { primary_phone: { $ilike: searchPattern } },
            { description: { $ilike: searchPattern } },
            { next_interaction_name: { $ilike: searchPattern } },
          ]
        }
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
      const tagIdsEmpty = parseBooleanToken(query.tagIdsEmpty) === true
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
        filters.primary_email = { $ilike: `${escapeLikePattern(emailStartsWith)}%` }
      } else if (emailContains) {
        filters.primary_email = { $ilike: `%${escapeLikePattern(emailContains)}%` }
      }
      const hasEmail = parseBooleanToken(query.hasEmail)
      if (!email && !emailStartsWith && !emailContains && hasEmail !== null) {
        filters.primary_email = { $exists: hasEmail }
      }
      const hasPhone = parseBooleanToken(query.hasPhone)
      if (hasPhone !== null) {
        filters.primary_phone = { $exists: hasPhone }
      }
      const hasNextInteraction = parseBooleanToken(query.hasNextInteraction)
      if (hasNextInteraction !== null) {
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
      if (ctx && advancedFilterState) {
        const advancedFilters = mergeAdvancedFilters(
          { ...filters },
          advancedQuery as Record<string, unknown>,
        )
        const matchedIds = await findMatchingEntityIdsWithQueryEngine({
          ctx,
          entityId: E.customers.customer_entity,
          filters: advancedFilters,
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
        })
        applyEntityIdRestriction(filters, matchedIds)
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
      commandId: 'customers.company.create',
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
      commandId: 'customers.company.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const normalized = normalizeCompanyProfilePayload(scoped, translate)
        const { base, custom } = splitCustomFieldPayload(normalized)
        const parsed = companyUpdateSchema.parse(base)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.company.delete',
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
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload?.items) ? payload.items : []
      const ids = items
        .map((item: unknown) => (item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string'
          ? (item as Record<string, unknown>).id as string
          : null))
        .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0)
      if (!ids.length) return

      const where: Record<string, unknown> = {
        entity: { $in: ids },
        tenantId: ctx.auth?.tenantId ?? null,
      }
      if (ctx.selectedOrganizationId) {
        where.organizationId = ctx.selectedOrganizationId
      }

      const profiles = await findWithDecryption(
        ctx.container.resolve('em') as any,
        CustomerCompanyProfile,
        where as any,
        { populate: ['entity'] } as any,
        {
          tenantId: ctx.auth?.tenantId ?? null,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
        },
      )

      const profilesByEntityId = new Map<string, CustomerCompanyProfile>()
      for (const profile of profiles) {
        const entityId = typeof (profile as any)?.entity?.id === 'string' ? (profile as any).entity.id : null
        if (entityId) profilesByEntityId.set(entityId, profile)
      }

      payload.items = items.map((item: unknown) => {
        if (!item || typeof item !== 'object') return item
        const record = item as Record<string, unknown>
        const profile = typeof record.id === 'string' ? profilesByEntityId.get(record.id) : undefined
        if (!profile) return item
        return {
          ...record,
          legal_name: profile.legalName ?? null,
          brand_name: profile.brandName ?? null,
          domain: profile.domain ?? null,
          website_url: profile.websiteUrl ?? null,
          industry: profile.industry ?? null,
          size_bucket: profile.sizeBucket ?? null,
          annual_revenue: profile.annualRevenue ?? null,
        }
      })
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
