import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ChampionLead } from '../../../data/entities'
import {
  championLeadCreateSchema,
  championLeadListQuerySchema,
  championLeadUpdateSchema,
  type ChampionLeadCreateInput,
  type ChampionLeadListQuery,
  type ChampionLeadUpdateInput,
} from '../../../data/validators'
import { normalizeEmail, normalizeName, normalizePhoneE164ish } from '../../../lib/normalization'
import {
  championCrmCreatedSchema,
  championCrmOkSchema,
  createChampionCrmCrudOpenApi,
  createPagedListResponseSchema,
} from '../../openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['champion_crm.read'] },
  POST: { requireAuth: true, requireFeatures: ['champion_crm.leads.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['champion_crm.leads.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['champion_crm.leads.manage'] },
}

type LeadListRow = {
  id: string
  source: string | null
  source_external_id: string | null
  api_idempotency_key: string | null
  form_type: string | null
  message: string | null
  investment_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  email_normalized: string | null
  phone_e164: string | null
  name_raw: string | null
  tech_status: string
  qualification_status: string
  disqualification_reason: string | null
  contact_id: string | null
  deal_id: string | null
  owner_user_id: string | null
  qualified_at: Date | string | null
  qualification_status_changed_at: Date | string | null
  qualification_history: Array<Record<string, unknown>> | null
  disqualified_at: Date | string | null
  last_attempt_at: Date | string | null
  submitted_at: Date | string | null
  received_at: Date | string | null
  next_followup_at: Date | string | null
  organization_id: string
  tenant_id: string
  created_at: Date | string
  updated_at: Date | string
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function mapLeadRow(item: LeadListRow) {
  return {
    id: item.id,
    source: item.source ?? null,
    sourceExternalId: item.source_external_id ?? null,
    apiIdempotencyKey: item.api_idempotency_key ?? null,
    formType: item.form_type ?? null,
    message: item.message ?? null,
    investmentId: item.investment_id ?? null,
    utmSource: item.utm_source ?? null,
    utmMedium: item.utm_medium ?? null,
    utmCampaign: item.utm_campaign ?? null,
    emailNormalized: item.email_normalized ?? null,
    phoneE164: item.phone_e164 ?? null,
    nameRaw: item.name_raw ?? null,
    techStatus: item.tech_status,
    qualificationStatus: item.qualification_status,
    disqualificationReason: item.disqualification_reason ?? null,
    contactId: item.contact_id ?? null,
    dealId: item.deal_id ?? null,
    ownerUserId: item.owner_user_id ?? null,
    qualifiedAt: toIso(item.qualified_at),
    qualificationStatusChangedAt: toIso(item.qualification_status_changed_at),
    qualificationHistory: item.qualification_history ?? [],
    disqualifiedAt: toIso(item.disqualified_at),
    lastAttemptAt: toIso(item.last_attempt_at),
    submittedAt: toIso(item.submitted_at),
    receivedAt: toIso(item.received_at),
    nextFollowupAt: toIso(item.next_followup_at),
    organizationId: item.organization_id,
    tenantId: item.tenant_id,
    createdAt: toIso(item.created_at),
    updatedAt: toIso(item.updated_at),
  }
}

function cleanOptional(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function mapCreateInput(input: ChampionLeadCreateInput) {
  return {
    ...(input.id ? { id: input.id } : {}),
    source: cleanOptional(input.source),
    sourceExternalId: cleanOptional(input.sourceExternalId),
    sourcePayload: input.sourcePayload ?? {},
    apiIdempotencyKey: cleanOptional(input.apiIdempotencyKey),
    formType: cleanOptional(input.formType),
    message: cleanOptional(input.message),
    investmentId: input.investmentId ?? null,
    utmSource: cleanOptional(input.utmSource),
    utmMedium: cleanOptional(input.utmMedium),
    utmCampaign: cleanOptional(input.utmCampaign),
    utmTerm: cleanOptional(input.utmTerm),
    utmContent: cleanOptional(input.utmContent),
    emailNormalized: normalizeEmail(input.emailNormalized ?? input.email),
    phoneE164: normalizePhoneE164ish(input.phoneE164 ?? input.phone),
    nameRaw: normalizeName(input.nameRaw ?? input.name),
    techStatus: input.techStatus ?? 'new',
    qualificationStatus: input.qualificationStatus ?? 'do_kwalifikacji',
    disqualificationReason: cleanOptional(input.disqualificationReason),
    contactId: input.contactId ?? null,
    dealId: input.dealId ?? null,
    ownerUserId: input.ownerUserId ?? null,
    qualifiedAt: toDateOrNull(input.qualifiedAt),
    qualificationStatusChangedAt: toDateOrNull(input.qualificationStatusChangedAt),
    qualificationHistory: input.qualificationHistory ?? [],
    disqualifiedAt: toDateOrNull(input.disqualifiedAt),
    lastAttemptAt: toDateOrNull(input.lastAttemptAt),
    submittedAt: toDateOrNull(input.submittedAt),
    receivedAt: toDateOrNull(input.receivedAt),
    nextFollowupAt: toDateOrNull(input.nextFollowupAt),
  }
}

function applyLeadUpdate(entity: ChampionLead, input: ChampionLeadUpdateInput) {
  if ('source' in input) entity.source = cleanOptional(input.source)
  if ('sourceExternalId' in input) entity.sourceExternalId = cleanOptional(input.sourceExternalId)
  if ('sourcePayload' in input && input.sourcePayload) entity.sourcePayload = input.sourcePayload
  if ('apiIdempotencyKey' in input) entity.apiIdempotencyKey = cleanOptional(input.apiIdempotencyKey)
  if ('formType' in input) entity.formType = cleanOptional(input.formType)
  if ('message' in input) entity.message = cleanOptional(input.message)
  if ('investmentId' in input) entity.investmentId = input.investmentId ?? null
  if ('utmSource' in input) entity.utmSource = cleanOptional(input.utmSource)
  if ('utmMedium' in input) entity.utmMedium = cleanOptional(input.utmMedium)
  if ('utmCampaign' in input) entity.utmCampaign = cleanOptional(input.utmCampaign)
  if ('utmTerm' in input) entity.utmTerm = cleanOptional(input.utmTerm)
  if ('utmContent' in input) entity.utmContent = cleanOptional(input.utmContent)
  if ('emailNormalized' in input || 'email' in input) entity.emailNormalized = normalizeEmail(input.emailNormalized ?? input.email)
  if ('phoneE164' in input || 'phone' in input) entity.phoneE164 = normalizePhoneE164ish(input.phoneE164 ?? input.phone)
  if ('nameRaw' in input || 'name' in input) entity.nameRaw = normalizeName(input.nameRaw ?? input.name)
  if ('techStatus' in input && input.techStatus) entity.techStatus = input.techStatus
  if ('qualificationStatus' in input && input.qualificationStatus) entity.qualificationStatus = input.qualificationStatus
  if ('disqualificationReason' in input) entity.disqualificationReason = cleanOptional(input.disqualificationReason)
  if ('contactId' in input) entity.contactId = input.contactId ?? null
  if ('dealId' in input) entity.dealId = input.dealId ?? null
  if ('ownerUserId' in input) entity.ownerUserId = input.ownerUserId ?? null
  if ('qualifiedAt' in input) entity.qualifiedAt = toDateOrNull(input.qualifiedAt)
  if ('qualificationStatusChangedAt' in input) entity.qualificationStatusChangedAt = toDateOrNull(input.qualificationStatusChangedAt)
  if ('qualificationHistory' in input && input.qualificationHistory) entity.qualificationHistory = input.qualificationHistory
  if ('disqualifiedAt' in input) entity.disqualifiedAt = toDateOrNull(input.disqualifiedAt)
  if ('lastAttemptAt' in input) entity.lastAttemptAt = toDateOrNull(input.lastAttemptAt)
  if ('submittedAt' in input) entity.submittedAt = toDateOrNull(input.submittedAt)
  if ('receivedAt' in input) entity.receivedAt = toDateOrNull(input.receivedAt)
  if ('nextFollowupAt' in input) entity.nextFollowupAt = toDateOrNull(input.nextFollowupAt)
  entity.updatedAt = new Date()
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ChampionLead,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: { module: 'champion_crm', entity: 'lead', persistent: true },
  indexer: { entityType: 'champion_crm:lead' },
  list: {
    schema: championLeadListQuerySchema,
    entityId: 'champion_crm:lead',
    fields: [
      'id',
      'source',
      'source_external_id',
      'api_idempotency_key',
      'form_type',
      'message',
      'investment_id',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'email_normalized',
      'phone_e164',
      'name_raw',
      'tech_status',
      'qualification_status',
      'disqualification_reason',
      'contact_id',
      'deal_id',
      'owner_user_id',
      'qualified_at',
      'qualification_status_changed_at',
      'qualification_history',
      'disqualified_at',
      'last_attempt_at',
      'submitted_at',
      'received_at',
      'next_followup_at',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      source: 'source',
      techStatus: 'tech_status',
      qualificationStatus: 'qualification_status',
    },
    buildFilters: (query: ChampionLeadListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.source) filters.source = { $eq: query.source }
      if (query.techStatus) filters.tech_status = { $eq: query.techStatus }
      if (query.qualificationStatus) filters.qualification_status = { $eq: query.qualificationStatus }
      if (query.contactId) filters.contact_id = { $eq: query.contactId }
      if (query.search) {
        const pattern = `%${query.search.replace(/[%_]/g, '\\$&')}%`
        filters.$or = [
          { name_raw: { $ilike: pattern } },
          { email_normalized: { $ilike: pattern } },
          { phone_e164: { $ilike: pattern } },
          { source: { $ilike: pattern } },
        ]
      }
      return filters
    },
    transformItem: mapLeadRow,
    allowCsv: true,
    csv: {
      headers: ['id', 'name', 'email', 'phone', 'source', 'tech_status', 'qualification_status', 'created_at'],
      row: (item) => [
        item.id,
        item.nameRaw ?? '',
        item.emailNormalized ?? '',
        item.phoneE164 ?? '',
        item.source ?? '',
        item.techStatus,
        item.qualificationStatus,
        item.createdAt ?? '',
      ],
      filename: 'champion-crm-leads.csv',
    },
  },
  create: {
    schema: championLeadCreateSchema,
    mapToEntity: mapCreateInput,
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: championLeadUpdateSchema,
    getId: (input: ChampionLeadUpdateInput) => input.id,
    applyToEntity: (entity, input) => {
      applyLeadUpdate(entity, input)
    },
    response: () => ({ ok: true }),
  },
})

const leadListItemSchema = z.object({
  id: z.string().uuid(),
  source: z.string().nullable(),
  emailNormalized: z.string().nullable(),
  phoneE164: z.string().nullable(),
  nameRaw: z.string().nullable(),
  techStatus: z.string(),
  qualificationStatus: z.string(),
  contactId: z.string().uuid().nullable(),
  createdAt: z.string().nullable(),
}).passthrough()

export const openApi: OpenApiRouteDoc = createChampionCrmCrudOpenApi({
  resourceName: 'Champion Lead',
  pluralName: 'Champion Leads',
  querySchema: championLeadListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(leadListItemSchema),
  create: {
    schema: championLeadCreateSchema,
    description: 'Creates a Champion CRM lead.',
    responseSchema: championCrmCreatedSchema,
  },
  update: {
    schema: championLeadUpdateSchema,
    description: 'Updates a Champion CRM lead.',
    responseSchema: championCrmOkSchema,
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    description: 'Soft-deletes a Champion CRM lead.',
    responseSchema: championCrmOkSchema,
  },
})
