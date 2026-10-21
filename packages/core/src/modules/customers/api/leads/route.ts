import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerLead } from '../../data/entities'
import { leadCreateSchema, leadUpdateSchema } from '../../data/validators'
import { E } from '#generated/entities.ids.generated'
import { parseScopedCommandInput } from '../utils'
import { areLeadsEnabled } from '../../commands/settings'
import {
  createCustomersCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const leadListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    pipelineId: z.string().uuid().optional(),
    stageId: z.string().uuid().optional(),
    outcome: z.enum(['open', 'won', 'lost']).optional(),
    ownerUserId: z.string().uuid().optional(),
    source: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type LeadListQuery = z.infer<typeof leadListQuerySchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.leads.view'] },
  POST: { requireAuth: true, requireFeatures: ['customers.leads.create'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.leads.update'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.leads.update'] },
}

export const metadata = routeMetadata

function leadScope(ctx: CrudCtx): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: 'Organization and tenant context required' })
  }
  return { tenantId, organizationId }
}

async function requireLeadsEnabled(ctx: CrudCtx): Promise<void> {
  const em = ctx.container.resolve('em') as EntityManager
  const enabled = await areLeadsEnabled(em, leadScope(ctx))
  if (!enabled) {
    throw new CrudHttpError(403, { error: 'The lead capability is disabled for this tenant.' })
  }
}

function buildFilters(query: LeadListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.pipelineId) filters.pipeline_id = { $eq: query.pipelineId }
  if (query.stageId) filters.stage_id = { $eq: query.stageId }
  if (query.outcome) filters.outcome = { $eq: query.outcome }
  if (query.ownerUserId) filters.owner_user_id = { $eq: query.ownerUserId }
  if (query.source) filters.source = { $eq: query.source }
  if (query.search && query.search.trim().length) {
    const term = `%${escapeLikePattern(query.search.trim())}%`
    filters.$or = [
      { display_name: { $ilike: term } },
      { primary_email: { $ilike: term } },
      { primary_phone: { $ilike: term } },
      { vat_id: { $ilike: term } },
    ]
  }
  return filters
}

const crud = makeCrudRoute({
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
    schema: leadListQuerySchema,
    entityId: E.customers.customer_lead,
    fields: [
      'id',
      'pipeline_id',
      'stage_id',
      'outcome',
      'lost_reason_id',
      'display_name',
      'owner_user_id',
      'source',
      'source_channel',
      'primary_email',
      'primary_phone',
      'vat_id',
      'spam_score',
      'qualification_notes',
      'person_data',
      'company_data',
      'deal_data',
      'created_person_id',
      'created_company_id',
      'created_deal_id',
      'linked_person_id',
      'linked_company_id',
      'linked_deal_id',
      'converted_at',
      'conversion_locked_at',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      displayName: 'display_name',
      outcome: 'outcome',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => buildFilters(query as LeadListQuery),
    transformItem: (item: Record<string, unknown>) => ({
      id: item.id,
      pipelineId: item.pipeline_id ?? null,
      stageId: item.stage_id ?? null,
      outcome: item.outcome ?? 'open',
      lostReasonId: item.lost_reason_id ?? null,
      displayName: item.display_name ?? null,
      ownerUserId: item.owner_user_id ?? null,
      source: item.source ?? null,
      sourceChannel: item.source_channel ?? null,
      primaryEmail: item.primary_email ?? null,
      primaryPhone: item.primary_phone ?? null,
      vatId: item.vat_id ?? null,
      spamScore: item.spam_score ?? null,
      qualificationNotes: item.qualification_notes ?? null,
      personData: item.person_data ?? null,
      companyData: item.company_data ?? null,
      dealData: item.deal_data ?? null,
      createdPersonId: item.created_person_id ?? null,
      createdCompanyId: item.created_company_id ?? null,
      createdDealId: item.created_deal_id ?? null,
      linkedPersonId: item.linked_person_id ?? null,
      linkedCompanyId: item.linked_company_id ?? null,
      linkedDealId: item.linked_deal_id ?? null,
      convertedAt: item.converted_at ?? null,
      conversionLockedAt: item.conversion_locked_at ?? null,
      organizationId: item.organization_id ?? null,
      tenantId: item.tenant_id ?? null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
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
  hooks: {
    beforeList: async (_query, ctx) => {
      await requireLeadsEnabled(ctx)
    },
    beforeCreate: async (_input, ctx) => {
      await requireLeadsEnabled(ctx)
    },
    beforeUpdate: async (_input, ctx) => {
      await requireLeadsEnabled(ctx)
    },
    beforeDelete: async (_id, ctx) => {
      await requireLeadsEnabled(ctx)
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const leadItemSchema = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid().nullable().optional(),
  stageId: z.string().uuid().nullable().optional(),
  outcome: z.string().nullable().optional(),
  lostReasonId: z.string().uuid().nullable().optional(),
  displayName: z.string().nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  source: z.string().nullable().optional(),
  sourceChannel: z.string().nullable().optional(),
  primaryEmail: z.string().nullable().optional(),
  primaryPhone: z.string().nullable().optional(),
  vatId: z.string().nullable().optional(),
  spamScore: z.string().nullable().optional(),
  qualificationNotes: z.string().nullable().optional(),
  personData: z.record(z.string(), z.unknown()).nullable().optional(),
  companyData: z.record(z.string(), z.unknown()).nullable().optional(),
  dealData: z.record(z.string(), z.unknown()).nullable().optional(),
  createdPersonId: z.string().uuid().nullable().optional(),
  createdCompanyId: z.string().uuid().nullable().optional(),
  createdDealId: z.string().uuid().nullable().optional(),
  linkedPersonId: z.string().uuid().nullable().optional(),
  linkedCompanyId: z.string().uuid().nullable().optional(),
  linkedDealId: z.string().uuid().nullable().optional(),
  convertedAt: z.string().nullable().optional(),
  conversionLockedAt: z.string().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const openApi = createCustomersCrudOpenApi({
  resourceName: 'Lead',
  querySchema: leadListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(leadItemSchema),
  create: { schema: leadCreateSchema, description: 'Create a lead' },
  update: { schema: leadUpdateSchema, responseSchema: defaultOkResponseSchema, description: 'Update a lead' },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Delete a lead',
  },
})
