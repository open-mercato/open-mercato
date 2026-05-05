import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  CustomerDealPersonLink,
  CustomerEntity,
  CustomerPersonCompanyLink,
  CustomerPersonProfile,
} from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { personCreateSchema, personUpdateSchema } from '../../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  applyEntityIdExclusion,
  applyEntityIdRestriction,
  consumeAdvancedFilterState,
  findMatchingEntityIdsWithQueryEngine,
  findMatchingEntityIdsBySearchTokensAcrossSources,
  withScopedPayload,
} from '../utils'
import { buildCustomFieldFiltersFromQuery, extractAllCustomFieldEntries, splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { mergeAdvancedFilters } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
import {
  createCustomersCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import {
  filterActivePersonCompanyLinks,
  withActiveCustomerPersonCompanyLinkFilter,
} from '../../lib/personCompanyLinkTable'
import { normalizeProfilePayload } from './payload'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    email: z.string().optional(),
    emailStartsWith: z.string().optional(),
    emailContains: z.string().optional(),
    status: z.string().optional(),
    lifecycleStage: z.string().optional(),
    source: z.string().optional(),
    hasEmail: z.string().optional(),
    hasPhone: z.string().optional(),
    hasNextInteraction: z.string().optional(),
    createdFrom: z.string().optional(),
    createdTo: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    id: z.string().uuid().optional(),
    tagIds: z.string().optional(),
    tagIdsEmpty: z.string().optional(),
    excludeIds: z.string().optional(),
    excludeLinkedCompanyId: z.string().uuid().optional(),
    excludeLinkedDealId: z.string().uuid().optional(),
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
  enrichers: { entityId: 'customers.person' },
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
    buildFilters: async (query, ctx) => {
      const advancedQuery = { ...query }
      const advancedFilterState = consumeAdvancedFilterState(query)
      const filters: Record<string, unknown> = { kind: { $eq: 'person' } }
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
                  entityType: E.customers.customer_person_profile,
                  fields: [
                    'display_name',
                    'primary_email',
                    'primary_phone',
                    'status',
                    'lifecycle_stage',
                    'source',
                    'first_name',
                    'last_name',
                    'preferred_name',
                    'job_title',
                    'department',
                    'seniority',
                    'timezone',
                    'linked_in_url',
                    'twitter_url',
                  ],
                  mapToEntityIds: {
                    table: 'customer_people',
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
      const excludedIds = new Set<string>()
      const excludeIdsRaw = typeof query.excludeIds === 'string' ? query.excludeIds : ''
      excludeIdsRaw
        .split(',')
        .map((value: string) => value.trim())
        .filter((value: string) => value.length > 0)
        .forEach((value: string) => excludedIds.add(value))
      if (ctx && query.excludeLinkedCompanyId) {
        try {
          const em = ctx.container.resolve('em') as EntityManager
          const decryptionScope = {
            tenantId: ctx.auth?.tenantId ?? null,
            organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
          }
          const linkWhere = await withActiveCustomerPersonCompanyLinkFilter(
            em,
            { company: query.excludeLinkedCompanyId },
            'customers.people.GET',
          )
          const links = filterActivePersonCompanyLinks(
            await findWithDecryption(
              em,
              CustomerPersonCompanyLink,
              linkWhere,
              { populate: ['person'] },
              decryptionScope,
            ),
          )
          links.forEach((link) => {
            const personId = link.person?.id
            if (typeof personId === 'string' && personId.length > 0) excludedIds.add(personId)
          })
        } catch (err) {
          console.warn('[customers.people.list] exclusion lookup failed; falling back to base result set', err)
        }
      }
      if (ctx && query.excludeLinkedDealId) {
        try {
          const em = ctx.container.resolve('em') as EntityManager
          const decryptionScope = {
            tenantId: ctx.auth?.tenantId ?? null,
            organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
          }
          const links = await findWithDecryption(
            em,
            CustomerDealPersonLink,
            {
              deal: query.excludeLinkedDealId,
            },
            { populate: ['person'] },
            decryptionScope,
          )
          links.forEach((link) => {
            const personId = link.person?.id
            if (typeof personId === 'string' && personId.length > 0) excludedIds.add(personId)
          })
        } catch (err) {
          console.warn('[customers.people.list] exclusion lookup failed; falling back to base result set', err)
        }
      }
      applyEntityIdExclusion(filters, Array.from(excludedIds))
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
          const em = ctx.container.resolve('em') as EntityManager
          const cfFilters = await buildCustomFieldFiltersFromQuery({
            entityIds: [E.customers.customer_entity, E.customers.customer_person_profile],
            query,
            em,
            tenantId: ctx.auth?.tenantId ?? null,
          })
          Object.assign(filters, cfFilters)
        } catch (err) {
          console.warn('[customers.people.list] custom field filter resolution failed; falling back to base filters', err)
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
              entityId: E.customers.customer_person_profile,
              table: 'customer_people',
              alias: 'person_profile',
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
        entityId: E.customers.customer_person_profile,
        table: 'customer_people',
        alias: 'person_profile',
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
    transformItem: (item) => {
      if (!item || typeof item !== 'object') return item
      const record = item as Record<string, unknown>
      const normalized: Record<string, unknown> = { ...record }
      delete normalized.kind
      const cfEntries = extractAllCustomFieldEntries(record)
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
      commandId: 'customers.people.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = personCreateSchema.parse(base)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
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
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const normalized = normalizeProfilePayload(scoped, translate)
        const { base, custom } = splitCustomFieldPayload(normalized)
        const parsed = personUpdateSchema.parse(base)
        return Object.keys(custom).length ? { ...parsed, customFields: custom } : parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.people.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.person_required', 'Person id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload?.items) ? payload.items : []
      const ids = items
        .map((item: unknown) => (
          item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string'
            ? (item as Record<string, unknown>).id as string
            : null
        ))
        .filter((id: string | null): id is string => typeof id === 'string' && id.length > 0)
      if (!ids.length) return

      const em = ctx.container.resolve('em') as EntityManager
      const decryptionScope = {
        tenantId: ctx.auth?.tenantId ?? null,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      }
      const entities = await findWithDecryption(
        em,
        CustomerEntity,
        {
          id: { $in: ids },
          deletedAt: null,
          kind: 'person',
        } as FilterQuery<CustomerEntity>,
        undefined,
        decryptionScope,
      )
      const entitiesById = new Map<string, CustomerEntity>()
      for (const entity of entities) {
        entitiesById.set(entity.id, entity)
      }

      const where: Record<string, unknown> = {
        entity: { $in: ids },
        tenantId: ctx.auth?.tenantId ?? null,
      }
      if (ctx.selectedOrganizationId) {
        where.organizationId = ctx.selectedOrganizationId
      }

      const profiles = await findWithDecryption(
        em,
        CustomerPersonProfile,
        where as FilterQuery<CustomerPersonProfile>,
        { populate: ['entity', 'company'] },
        decryptionScope,
      )

      const profilesByEntityId = new Map<string, CustomerPersonProfile>()
      for (const profile of profiles) {
        const profileEntity = (profile as { entity?: { id?: unknown } }).entity
        const entityId = typeof profileEntity?.id === 'string' ? profileEntity.id : null
        if (entityId) profilesByEntityId.set(entityId, profile)
      }

      payload.items = items.map((item: unknown) => {
        if (!item || typeof item !== 'object') return item
        const record = item as Record<string, unknown>
        const entity = typeof record.id === 'string' ? entitiesById.get(record.id) : undefined
        const profile = typeof record.id === 'string' ? profilesByEntityId.get(record.id) : undefined
        if (!entity && !profile) return item
        return {
          ...record,
          display_name: entity?.displayName ?? record.display_name ?? null,
          description: entity?.description ?? record.description ?? null,
          owner_user_id: entity?.ownerUserId ?? record.owner_user_id ?? null,
          primary_email: entity?.primaryEmail ?? record.primary_email ?? null,
          primary_phone: entity?.primaryPhone ?? record.primary_phone ?? null,
          status: entity?.status ?? record.status ?? null,
          lifecycle_stage: entity?.lifecycleStage ?? record.lifecycle_stage ?? null,
          source: entity?.source ?? record.source ?? null,
          next_interaction_at: entity?.nextInteractionAt ? entity.nextInteractionAt.toISOString() : record.next_interaction_at ?? null,
          next_interaction_name: entity?.nextInteractionName ?? record.next_interaction_name ?? null,
          next_interaction_ref_id: entity?.nextInteractionRefId ?? record.next_interaction_ref_id ?? null,
          next_interaction_icon: entity?.nextInteractionIcon ?? record.next_interaction_icon ?? null,
          next_interaction_color: entity?.nextInteractionColor ?? record.next_interaction_color ?? null,
          first_name: profile?.firstName ?? null,
          last_name: profile?.lastName ?? null,
          preferred_name: profile?.preferredName ?? null,
          job_title: profile?.jobTitle ?? null,
          department: profile?.department ?? null,
          seniority: profile?.seniority ?? null,
          timezone: profile?.timezone ?? null,
          linked_in_url: profile?.linkedInUrl ?? null,
          twitter_url: profile?.twitterUrl ?? null,
          company_entity_id:
            profile?.company && typeof profile.company === 'object'
              ? profile.company.id
              : profile?.company ?? null,
        }
      })
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const personListItemSchema = z.object({
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

const personCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  personId: z.string().uuid().nullable(),
})

export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Person',
  pluralName: 'People',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(personListItemSchema),
  create: {
    schema: personCreateSchema,
    responseSchema: personCreateResponseSchema,
    description: 'Creates a person contact using scoped organization and tenant identifiers.',
  },
  update: {
    schema: personUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates contact details or custom fields for a person.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a person by id. Request body or query may provide the identifier.',
  },
})
