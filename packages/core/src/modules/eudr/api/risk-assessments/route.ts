import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { EudrDueDiligenceStatement, EudrRiskAssessment } from '../../data/entities'
import {
  EUDR_RISK_CONCLUSIONS,
  EUDR_RISK_TIERS,
  riskAssessmentCreateSchema,
  riskAssessmentUpdateSchema,
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
  statementId: z.string().uuid().optional(),
  conclusion: z.enum(EUDR_RISK_CONCLUSIONS).optional(),
  overallTier: z.enum(EUDR_RISK_TIERS).optional(),
  reviewDueBefore: z.coerce.date().optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

type RiskAssessmentListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.risk.view'] },
  POST: { requireAuth: true, requireFeatures: ['eudr.risk.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['eudr.risk.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['eudr.risk.manage'] },
}

export const metadata = routeMetadata

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string' || value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

function resolveDeleteInput(parsed: unknown, ctx: { request?: Request }, translate: TranslateFn) {
  const record = parsed && typeof parsed === 'object' ? asRecord(parsed) : {}
  const body = record.body && typeof record.body === 'object' ? asRecord(record.body) : null
  const query = record.query && typeof record.query === 'object' ? asRecord(record.query) : null
  const requestId = ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null
  const id = asStringOrNull(body?.id) ?? asStringOrNull(record.id) ?? asStringOrNull(query?.id) ?? requestId
  if (!id) {
    throw new CrudHttpError(400, { error: translate('eudr.errors.risk_assessment_required', 'Risk assessment id is required') })
  }
  return { id }
}

function buildFilters(query: RiskAssessmentListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.statementId) filters.statement_id = { $eq: query.statementId }
  if (query.conclusion) filters.conclusion = { $eq: query.conclusion }
  if (query.overallTier) filters.overall_tier = { $eq: query.overallTier }
  if (query.reviewDueBefore) filters.review_due_at = { $lte: query.reviewDueBefore }
  return filters
}

function transformRiskAssessmentItem(item: unknown) {
  if (!item || typeof item !== 'object') return item
  const record = item as Record<string, unknown>
  return {
    id: record.id,
    statementId: record.statement_id ?? null,
    statementTitle: null,
    countryRisks: Array.isArray(record.country_risks) ? record.country_risks : [],
    overallTier: record.overall_tier ?? null,
    criteria: record.criteria ?? {},
    conclusion: record.conclusion ?? null,
    isSimplified: typeof record.is_simplified === 'boolean' ? record.is_simplified : false,
    assessedAt: toIsoString(record.assessed_at),
    assessedByName: record.assessed_by_name ?? null,
    reviewDueAt: toIsoString(record.review_due_at),
    notes: record.notes ?? null,
    createdAt: toIsoString(record.created_at),
    updatedAt: toIsoString(record.updated_at),
  }
}

async function attachStatementTitles(
  em: EntityManager,
  items: unknown[],
  scope: { tenantId: string; organizationIds: string[] },
): Promise<void> {
  const statementIds = [...new Set(
    items
      .map((item) => (item && typeof item === 'object' ? asStringOrNull((item as Record<string, unknown>).statementId) : null))
      .filter((id): id is string => id !== null),
  )]
  if (!statementIds.length) return
  const where: FilterQuery<EudrDueDiligenceStatement> = {
    id: { $in: statementIds },
    deletedAt: null,
    tenantId: scope.tenantId,
    organizationId: { $in: scope.organizationIds },
  }
  const statements = await em.find(EudrDueDiligenceStatement, where, { fields: ['id', 'title'] })
  const titleById = new Map(statements.map((statement) => [statement.id, statement.title]))
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const statementId = asStringOrNull(record.statementId)
    record.statementTitle = statementId ? (titleById.get(statementId) ?? null) : null
  }
}

const listFields = [
  'id',
  'statement_id',
  'country_risks',
  'overall_tier',
  'criteria',
  'conclusion',
  'is_simplified',
  'assessed_at',
  'assessed_by_name',
  'review_due_at',
  'created_at',
  'updated_at',
]

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EudrRiskAssessment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.eudr.eudr_risk_assessment },
  list: {
    schema: listSchema,
    entityId: E.eudr.eudr_risk_assessment,
    fields: listFields,
    sortFieldMap: {
      created_at: 'created_at',
      createdAt: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
      assessed_at: 'assessed_at',
      assessedAt: 'assessed_at',
      review_due_at: 'review_due_at',
      reviewDueAt: 'review_due_at',
      overall_tier: 'overall_tier',
      overallTier: 'overall_tier',
      conclusion: 'conclusion',
    },
    buildFilters,
    transformItem: transformRiskAssessmentItem,
  },
  actions: {
    create: {
      commandId: 'eudr.risk_assessments.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = riskAssessmentCreateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => ({ id: result?.entityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'eudr.risk_assessments.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = riskAssessmentUpdateSchema.parse(base)
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
      commandId: 'eudr.risk_assessments.delete',
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
      const items: unknown[] = Array.isArray(payload?.items) ? payload.items : []
      if (!items.length) return
      const tenantId = ctx.auth?.tenantId ?? null
      const organizationIds = ctx.organizationIds ?? (ctx.selectedOrganizationId
        ? [ctx.selectedOrganizationId]
        : (ctx.auth?.orgId ? [ctx.auth.orgId] : null))
      if (tenantId && organizationIds?.length) {
        const em = ctx.container.resolve('em') as EntityManager
        await attachStatementTitles(em, items, { tenantId, organizationIds })
      }
      const detailRead = (typeof ctx.query.id === 'string' && ctx.query.id.length > 0)
        || (typeof ctx.query.ids === 'string' && ctx.query.ids.length > 0)
      if (!detailRead) return
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      if (!tenantId || !organizationId) return
      const ids = items
        .map((item) => (item && typeof item === 'object' ? asStringOrNull((item as Record<string, unknown>).id) : null))
        .filter((id): id is string => id !== null)
      if (!ids.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const where: FilterQuery<EudrRiskAssessment> = {
        id: { $in: ids },
        deletedAt: null,
        tenantId,
        organizationId,
      }
      const decrypted = await findWithDecryption(
        em,
        EudrRiskAssessment,
        where,
        {},
        { tenantId, organizationId },
      )
      const byId = new Map(decrypted.map((assessment) => [assessment.id, assessment]))
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const id = asStringOrNull(record.id)
        const assessment = id ? byId.get(id) : null
        if (!assessment) continue
        record.notes = assessment.notes ?? null
      }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const riskAssessmentListItemSchema = z.object({
  id: z.string().uuid(),
  statementId: z.string().uuid().nullable().optional(),
  statementTitle: z.string().nullable().optional(),
  countryRisks: z.array(z.object({
    country: z.string(),
    tier: z.string(),
  })),
  overallTier: z.enum(EUDR_RISK_TIERS).nullable().optional(),
  criteria: z.record(z.string(), z.unknown()),
  conclusion: z.enum(EUDR_RISK_CONCLUSIONS).nullable().optional(),
  isSimplified: z.boolean(),
  assessedAt: z.string().nullable().optional(),
  assessedByName: z.string().nullable().optional(),
  reviewDueAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createEudrCrudOpenApi({
  resourceName: 'Risk assessment',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(riskAssessmentListItemSchema),
  create: {
    schema: riskAssessmentCreateSchema,
    description: 'Creates an EUDR risk assessment for the scoped organization.',
  },
  update: {
    schema: riskAssessmentUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an EUDR risk assessment.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an EUDR risk assessment by id. Request body or query may provide the identifier.',
  },
})
