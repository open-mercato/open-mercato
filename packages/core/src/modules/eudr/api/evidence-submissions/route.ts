import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { EudrEvidenceSubmission } from '../../data/entities'
import { computeHarvestCutoffWarning } from '../../lib/completeness'
import {
  EUDR_COMMODITIES,
  EUDR_SUBMISSION_STATUSES,
  evidenceSubmissionCreateSchema,
  evidenceSubmissionUpdateSchema,
} from '../../data/validators'
import {
  createEudrCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

type TranslateFn = (key: string, fallback?: string) => string

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  search: z.string().optional(),
  commodity: z.enum(EUDR_COMMODITIES).optional(),
  status: z.enum(EUDR_SUBMISSION_STATUSES).optional(),
  supplierEntityId: z.string().uuid().optional(),
  statementId: z.string().uuid().optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

type EvidenceSubmissionListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.submissions.view'] },
  POST: { requireAuth: true, requireFeatures: ['eudr.submissions.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['eudr.submissions.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['eudr.submissions.manage'] },
}

export const metadata = routeMetadata

const gridFields = [
  'id',
  'supplier_entity_id',
  'supplier_snapshot',
  'commodity',
  'product_mapping_id',
  'statement_id',
  'origin_country',
  'quantity_kg',
  'batch_number',
  'harvest_from',
  'harvest_to',
  'attachment_ids',
  'plot_ids',
  'status',
  'completeness_score',
  'missing_fields',
  'created_at',
  'updated_at',
]

const allFields = [
  ...gridFields,
  'geolocation',
  'producer_name',
  'notes',
]

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function resolveDeleteInput(parsed: unknown, ctx: { request?: Request }, translate: TranslateFn) {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const body = record.body && typeof record.body === 'object' ? record.body as Record<string, unknown> : null
  const query = record.query && typeof record.query === 'object' ? record.query as Record<string, unknown> : null
  const requestId = ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null
  const id = asStringOrNull(body?.id) ?? asStringOrNull(record.id) ?? asStringOrNull(query?.id) ?? requestId
  if (!id) throw new CrudHttpError(400, { error: translate('eudr.errors.submission_required', 'Evidence submission id is required') })
  return { id }
}

function buildFilters(query: EvidenceSubmissionListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.commodity) filters.commodity = { $eq: query.commodity }
  if (query.status) filters.status = { $eq: query.status }
  if (query.supplierEntityId) filters.supplier_entity_id = { $eq: query.supplierEntityId }
  if (query.statementId) filters.statement_id = { $eq: query.statementId }
  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search) {
    const searchPattern = buildIlikeTerm(search)
    filters.$or = [
      { commodity: { $ilike: searchPattern } },
      { status: { $ilike: searchPattern } },
      { origin_country: { $ilike: searchPattern } },
      { batch_number: { $ilike: searchPattern } },
    ]
  }
  return filters
}

function transformEvidenceSubmissionItem(item: unknown) {
  if (!item || typeof item !== 'object') return item
  const record = item as Record<string, unknown>
  const harvestFrom = toIsoString(record.harvest_from)
  const harvestTo = toIsoString(record.harvest_to)
  const cutoffWarning = computeHarvestCutoffWarning(harvestFrom, harvestTo)
  return {
    id: record.id,
    supplierEntityId: record.supplier_entity_id ?? null,
    supplierSnapshot: record.supplier_snapshot ?? null,
    commodity: record.commodity ?? null,
    productMappingId: record.product_mapping_id ?? null,
    statementId: record.statement_id ?? null,
    originCountry: record.origin_country ?? null,
    geolocation: record.geolocation ?? null,
    quantityKg: record.quantity_kg ?? null,
    batchNumber: record.batch_number ?? null,
    harvestFrom,
    harvestTo,
    producerName: record.producer_name ?? null,
    attachmentIds: stringArray(record.attachment_ids),
    plotIds: stringArray(record.plot_ids),
    status: record.status ?? null,
    completenessScore: asNumber(record.completeness_score),
    missingFields: stringArray(record.missing_fields),
    warnings: cutoffWarning ? [cutoffWarning] : [],
    notes: record.notes ?? null,
    createdAt: toIsoString(record.created_at),
    updatedAt: toIsoString(record.updated_at),
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EudrEvidenceSubmission,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.eudr.eudr_evidence_submission },
  list: {
    schema: listSchema,
    entityId: E.eudr.eudr_evidence_submission,
    fields: (query) => (typeof query.id === 'string' && query.id.length ? allFields : gridFields),
    sortFieldMap: {
      created_at: 'created_at',
      createdAt: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
      commodity: 'commodity',
      status: 'status',
      supplierEntityId: 'supplier_entity_id',
      completenessScore: 'completeness_score',
      originCountry: 'origin_country',
      quantityKg: 'quantity_kg',
      batchNumber: 'batch_number',
    },
    buildFilters,
    transformItem: transformEvidenceSubmissionItem,
  },
  actions: {
    create: {
      commandId: 'eudr.evidence_submissions.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = evidenceSubmissionCreateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => ({ id: result?.entityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'eudr.evidence_submissions.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = evidenceSubmissionUpdateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => {
        const updatedAt = result?.updatedAt
        return {
          ok: true,
          updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : (typeof updatedAt === 'string' ? updatedAt : null),
        }
      },
    },
    delete: {
      commandId: 'eudr.evidence_submissions.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return resolveDeleteInput(parsed, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      if (typeof ctx.query.id !== 'string' || ctx.query.id.length === 0) return
      const items = Array.isArray(payload?.items) ? payload.items : []
      if (!items.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const decryptionScope = {
        tenantId: ctx.auth?.tenantId ?? null,
        organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      }
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const submissionId = asStringOrNull(record.id)
        if (!submissionId) continue
        const where: FilterQuery<EudrEvidenceSubmission> = {
          id: submissionId,
          deletedAt: null,
        }
        if (decryptionScope.tenantId) where.tenantId = decryptionScope.tenantId
        if (decryptionScope.organizationId) where.organizationId = decryptionScope.organizationId
        const decrypted = await findOneWithDecryption(
          em,
          EudrEvidenceSubmission,
          where,
          {},
          decryptionScope,
        )
        if (!decrypted) continue
        record.producerName = decrypted.producerName ?? null
        record.notes = decrypted.notes ?? null
      }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const evidenceSubmissionListItemSchema = z.object({
  id: z.string().uuid(),
  supplierEntityId: z.string().uuid().nullable().optional(),
  supplierSnapshot: z.object({
    displayName: z.string().nullable().optional(),
  }).nullable().optional(),
  commodity: z.enum(EUDR_COMMODITIES).nullable().optional(),
  productMappingId: z.string().uuid().nullable().optional(),
  statementId: z.string().uuid().nullable().optional(),
  originCountry: z.string().nullable().optional(),
  geolocation: z.unknown().nullable().optional(),
  quantityKg: z.union([z.string(), z.number()]).nullable().optional(),
  batchNumber: z.string().nullable().optional(),
  harvestFrom: z.string().nullable().optional(),
  harvestTo: z.string().nullable().optional(),
  producerName: z.string().nullable().optional(),
  attachmentIds: z.array(z.string().uuid()).optional(),
  plotIds: z.array(z.string().uuid()).optional(),
  status: z.enum(EUDR_SUBMISSION_STATUSES).nullable().optional(),
  completenessScore: z.number(),
  missingFields: z.array(z.string()),
  warnings: z.array(z.string()),
  notes: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createEudrCrudOpenApi({
  resourceName: 'Evidence submission',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(evidenceSubmissionListItemSchema),
  create: {
    schema: evidenceSubmissionCreateSchema,
    description: 'Creates an EUDR supplier evidence submission for the scoped organization.',
  },
  update: {
    schema: evidenceSubmissionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an EUDR supplier evidence submission.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an EUDR supplier evidence submission by id. Request body or query may provide the identifier.',
  },
})
