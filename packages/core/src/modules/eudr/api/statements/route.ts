import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { E } from '#generated/entities.ids.generated'
import { EudrDueDiligenceStatement, EudrRiskAssessment } from '../../data/entities'
import {
  EUDR_ACTIVITY_TYPES,
  EUDR_ACTOR_ROLES,
  EUDR_COMMODITIES,
  EUDR_RISK_CONCLUSIONS,
  EUDR_RISK_TIERS,
  EUDR_STATEMENT_STATUSES,
  statementCreateSchema,
  statementUpdateSchema,
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
  status: z.enum(EUDR_STATEMENT_STATUSES).optional(),
  orderId: z.string().uuid().optional(),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

type StatementListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.statements.view'] },
  POST: { requireAuth: true, requireFeatures: ['eudr.statements.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['eudr.statements.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['eudr.statements.manage'] },
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

function resolveDeleteInput(parsed: unknown, ctx: { request?: Request }, translate: TranslateFn) {
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const body = record.body && typeof record.body === 'object' ? record.body as Record<string, unknown> : null
  const query = record.query && typeof record.query === 'object' ? record.query as Record<string, unknown> : null
  const requestId = ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null
  const id = asStringOrNull(body?.id) ?? asStringOrNull(record.id) ?? asStringOrNull(query?.id) ?? requestId
  if (!id) throw new CrudHttpError(400, { error: translate('eudr.errors.statement_required', 'Due diligence statement id is required') })
  return { id }
}

export function buildFilters(query: StatementListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.commodity) filters.commodity = { $eq: query.commodity }
  if (query.status) filters.status = { $eq: query.status }
  if (query.orderId) filters.order_id = { $eq: query.orderId }
  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search) {
    const searchPattern = buildIlikeTerm(search)
    filters.$or = [
      { title: { $ilike: searchPattern } },
      { reference_number: { $ilike: searchPattern } },
    ]
  }
  return filters
}

function transformStatementItem(item: unknown) {
  if (!item || typeof item !== 'object') return item
  const record = item as Record<string, unknown>
  return {
    id: record.id,
    title: record.title ?? null,
    commodity: record.commodity ?? null,
    referenceNumber: record.reference_number ?? null,
    verificationNumber: record.verification_number ?? null,
    status: record.status ?? null,
    activityType: record.activity_type ?? null,
    actorRole: record.actor_role ?? null,
    referencedStatements: Array.isArray(record.referenced_statements) ? record.referenced_statements : [],
    quantityKg: record.quantity_kg ?? null,
    supplementaryUnit: record.supplementary_unit ?? null,
    supplementaryQuantity: record.supplementary_quantity ?? null,
    orderId: record.order_id ?? null,
    submittedAt: toIsoString(record.submitted_at),
    referenceIssuedAt: toIsoString(record.reference_issued_at),
    orderSnapshot: record.order_snapshot ?? null,
    notes: record.notes ?? null,
    createdAt: toIsoString(record.created_at),
    updatedAt: toIsoString(record.updated_at),
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: EudrDueDiligenceStatement,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.eudr.eudr_due_diligence_statement },
  list: {
    schema: listSchema,
    entityId: E.eudr.eudr_due_diligence_statement,
    fields: [
      'id',
      'title',
      'commodity',
      'reference_number',
      'verification_number',
      'status',
      'activity_type',
      'actor_role',
      'referenced_statements',
      'quantity_kg',
      'supplementary_unit',
      'supplementary_quantity',
      'order_id',
      'submitted_at',
      'reference_issued_at',
      'order_snapshot',
      'notes',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      created_at: 'created_at',
      createdAt: 'created_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
      commodity: 'commodity',
      title: 'title',
      status: 'status',
      activityType: 'activity_type',
      activity_type: 'activity_type',
      referenceNumber: 'reference_number',
      quantityKg: 'quantity_kg',
    },
    buildFilters,
    transformItem: transformStatementItem,
  },
  actions: {
    create: {
      commandId: 'eudr.statements.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = statementCreateSchema.parse(base)
        const input = { ...parsed, tenantId: scoped.tenantId, organizationId: scoped.organizationId }
        return Object.keys(custom).length ? { ...input, customFields: custom } : input
      },
      response: ({ result }) => ({ id: result?.entityId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'eudr.statements.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        const parsed = statementUpdateSchema.parse(base)
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
      commandId: 'eudr.statements.delete',
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
      for (const item of items) {
        if (item && typeof item === 'object') delete (item as Record<string, unknown>).latestRisk
      }
      const tenantId = ctx.auth?.tenantId ?? null
      const userId = ctx.auth?.sub ?? null
      const organizationIds = ctx.organizationIds ?? (ctx.selectedOrganizationId
        ? [ctx.selectedOrganizationId]
        : (ctx.auth?.orgId ? [ctx.auth.orgId] : null))
      if (!tenantId || !userId || !organizationIds?.length) return
      try {
        const rbacService = ctx.container.resolve('rbacService') as RbacService
        const canViewRisk = await rbacService.userHasAllFeatures(userId, ['eudr.risk.view'], {
          tenantId,
          organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? organizationIds[0],
        })
        if (!canViewRisk) return
      } catch {
        return
      }
      const statementIds = items
        .map((item) => (item && typeof item === 'object' ? asStringOrNull((item as Record<string, unknown>).id) : null))
        .filter((id): id is string => id !== null)
      if (!statementIds.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const where: FilterQuery<EudrRiskAssessment> = {
        statementId: { $in: statementIds },
        deletedAt: null,
        tenantId,
        organizationId: { $in: organizationIds },
      }
      const assessments = await em.find(EudrRiskAssessment, where, {
        fields: ['id', 'statementId', 'conclusion', 'overallTier', 'reviewDueAt', 'assessedAt', 'createdAt'],
        orderBy: { assessedAt: 'DESC', createdAt: 'DESC' },
      })
      const latestByStatementId = new Map<string, Pick<EudrRiskAssessment, 'id' | 'statementId' | 'conclusion' | 'overallTier' | 'reviewDueAt' | 'assessedAt' | 'createdAt'>>()
      for (const assessment of assessments) {
        if (latestByStatementId.has(assessment.statementId)) continue
        latestByStatementId.set(assessment.statementId, assessment)
      }
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const id = asStringOrNull(record.id)
        const latest = id ? latestByStatementId.get(id) : null
        record.latestRisk = latest
          ? {
              conclusion: latest.conclusion,
              overallTier: latest.overallTier,
              reviewDueAt: toIsoString(latest.reviewDueAt),
            }
          : null
      }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const statementListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable().optional(),
  commodity: z.enum(EUDR_COMMODITIES).nullable().optional(),
  referenceNumber: z.string().nullable().optional(),
  verificationNumber: z.string().nullable().optional(),
  status: z.enum(EUDR_STATEMENT_STATUSES).nullable().optional(),
  activityType: z.enum(EUDR_ACTIVITY_TYPES).nullable().optional(),
  actorRole: z.enum(EUDR_ACTOR_ROLES).nullable().optional(),
  referencedStatements: z.array(z.object({
    referenceNumber: z.string(),
    verificationNumber: z.string().nullable().optional(),
  })).optional(),
  quantityKg: z.union([z.string(), z.number()]).nullable().optional(),
  supplementaryUnit: z.string().nullable().optional(),
  supplementaryQuantity: z.union([z.string(), z.number()]).nullable().optional(),
  orderId: z.string().uuid().nullable().optional(),
  submittedAt: z.string().nullable().optional(),
  referenceIssuedAt: z.string().nullable().optional(),
  orderSnapshot: z.object({
    orderNumber: z.string().nullable().optional(),
  }).nullable().optional(),
  notes: z.string().nullable().optional(),
  latestRisk: z.object({
    conclusion: z.enum(EUDR_RISK_CONCLUSIONS),
    overallTier: z.enum(EUDR_RISK_TIERS),
    reviewDueAt: z.string().nullable(),
  }).nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createEudrCrudOpenApi({
  resourceName: 'Due diligence statement',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(statementListItemSchema),
  create: {
    schema: statementCreateSchema,
    description: 'Creates an EUDR due diligence statement for the scoped organization.',
  },
  update: {
    schema: statementUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an EUDR due diligence statement.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an EUDR due diligence statement by id. Request body or query may provide the identifier.',
  },
})
