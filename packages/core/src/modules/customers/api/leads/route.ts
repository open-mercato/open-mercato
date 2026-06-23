import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerLead } from '../../data/entities'
import { leadCreateSchema, leadUpdateSchema } from '../../data/validators'
import { E } from '#generated/entities.ids.generated'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { consumeAdvancedFilterState } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
import {
  applyEntityIdRestriction,
  findMatchingEntityIdsWithQueryEngine,
  findMatchingEntityIdsBySearchTokensAcrossSources,
  parseScopedCommandInput,
} from '../utils'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { mergeAdvancedFilters } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
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
    status: z.string().optional(),
    source: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.leads.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.leads.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.leads.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.leads.manage'] },
}

export const metadata = routeMetadata

type LeadListQuery = z.infer<typeof listSchema>

const crud = makeCrudRoute<unknown, unknown, LeadListQuery>({
  metadata: routeMetadata,
  orm: {
    entity: CustomerLead,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.customers.customer_lead,
  },
  list: {
    schema: listSchema,
    entityId: E.customers.customer_lead,
    fields: [
      'id',
      'title',
      'description',
      'status',
      'source',
      'estimated_value_amount',
      'estimated_value_currency',
      'company_name',
      'company_vat_id',
      'contact_first_name',
      'contact_last_name',
      'contact_phone',
      'contact_email',
      'created_deal_id',
      'created_person_entity_id',
      'created_company_entity_id',
      'converted_at',
      'converted_by_user_id',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      title: 'title',
      status: 'status',
    },
    buildFilters: async (query, ctx) => {
      const advancedQuery = { ...query }
      const advancedFilterState = consumeAdvancedFilterState(query)
      const filters: Record<string, unknown> = {}
      if (query.search) {
        const matchingIds = ctx
          ? await findMatchingEntityIdsBySearchTokensAcrossSources({
              ctx,
              query: query.search,
              sources: [
                {
                  entityType: E.customers.customer_lead,
                  fields: [
                    'title',
                    'description',
                    'source',
                    'company_name',
                    'company_vat_id',
                    'contact_first_name',
                    'contact_last_name',
                    'contact_phone',
                    'contact_email',
                  ],
                },
              ],
            })
          : null
        if (matchingIds !== null && matchingIds.length > 0) {
          applyEntityIdRestriction(filters, matchingIds)
        } else {
          const searchPattern = `%${escapeLikePattern(query.search)}%`
          filters.$or = [
            { title: { $ilike: searchPattern } },
            { description: { $ilike: searchPattern } },
            { company_name: { $ilike: searchPattern } },
            { contact_first_name: { $ilike: searchPattern } },
            { contact_last_name: { $ilike: searchPattern } },
            { contact_email: { $ilike: searchPattern } },
          ]
        }
      }
      if (query.status) {
        filters.status = { $eq: query.status }
      }
      if (query.source) {
        filters.source = { $eq: query.source }
      }
      if (ctx && advancedFilterState) {
        const advancedFilters = mergeAdvancedFilters(
          { ...filters },
          advancedQuery as Record<string, unknown>,
        )
        const matchedIds = await findMatchingEntityIdsWithQueryEngine({
          ctx,
          entityId: E.customers.customer_lead,
          filters: advancedFilters,
        })
        applyEntityIdRestriction(filters, matchedIds)
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'customers.leads.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(leadCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.leadId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'customers.leads.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(leadUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'customers.leads.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) throw new CrudHttpError(400, { error: translate('customers.errors.lead_required', 'Lead id is required') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const leadListItemSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    estimated_value_amount: z.number().nullable().optional(),
    estimated_value_currency: z.string().nullable().optional(),
    company_name: z.string().nullable().optional(),
    company_vat_id: z.string().nullable().optional(),
    contact_first_name: z.string().nullable().optional(),
    contact_last_name: z.string().nullable().optional(),
    contact_phone: z.string().nullable().optional(),
    contact_email: z.string().nullable().optional(),
    created_deal_id: z.string().uuid().nullable().optional(),
    created_person_entity_id: z.string().uuid().nullable().optional(),
    created_company_entity_id: z.string().uuid().nullable().optional(),
    converted_at: z.string().nullable().optional(),
    converted_by_user_id: z.string().uuid().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid().nullable().optional(),
  })
  .passthrough()

const leadCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
})

export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Lead',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(leadListItemSchema),
  create: {
    schema: leadCreateSchema,
    responseSchema: leadCreateResponseSchema,
    description: 'Creates a new customer lead.',
  },
  update: {
    schema: leadUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an existing customer lead.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a lead by id.',
  },
})
