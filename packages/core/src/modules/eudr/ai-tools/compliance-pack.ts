import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import {
  EudrDueDiligenceStatement,
  EudrEvidenceSubmission,
  EudrMitigationAction,
  EudrProductMapping,
  EudrRiskAssessment,
} from '../data/entities'
import {
  EUDR_COMMODITIES,
  EUDR_STATEMENT_STATUSES,
  EUDR_SUBMISSION_STATUSES,
} from '../data/validators'
import {
  EUDR_APPLICATION_DATES,
  EUDR_HIGH_RISK_COUNTRIES,
  EUDR_LOW_RISK_COUNTRIES,
  getCountryRiskTier,
  suggestCommodityForHsCode,
} from '../lib/reference-data'
import {
  evaluateSubmissionGate,
  type GateAssessmentView,
  type GateSubmissionView,
} from '../lib/statement-lifecycle'
import { assertTenantScope, type EudrAiToolDefinition, type EudrToolContext } from './types'

type Scope = {
  tenantId: string
  organizationId: string
}

type AvgCompletenessRow = {
  avg_completeness: string | number | null
}

type CatalogProductRecord = Record<string, unknown> & {
  id?: unknown
  title?: unknown
  name?: unknown
  sku?: unknown
  hs_code?: unknown
}

type ReadinessGap = {
  submissionId: string
  status: string
  completenessScore: number
  missingFields: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

const overviewInput = z.object({}).passthrough()

const listStatementReadinessInput = z
  .object({
    statementId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .passthrough()

const listEvidenceGapsInput = z
  .object({
    commodity: z.enum(EUDR_COMMODITIES).optional(),
    supplierEntityId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .passthrough()

const checkProductScopeInput = z
  .object({
    productId: z.string().uuid().optional(),
    hsCode: z.string().trim().min(1).max(20).optional(),
  })
  .passthrough()
  .refine((input) => input.productId !== undefined || input.hsCode !== undefined, {
    message: 'Provide productId or hsCode',
  })

const getCountryRiskInput = z
  .object({
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((value) => value.toUpperCase())
      .optional(),
    includeLowList: z.boolean().optional(),
  })
  .passthrough()

function resolveEm(ctx: EudrToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  if (value.length === 0) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
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

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function daysLeft(deadline: string, now: Date): number {
  const deadlineDate = new Date(`${deadline}T00:00:00.000Z`)
  return Math.ceil((deadlineDate.getTime() - now.getTime()) / DAY_MS)
}

function countRowsByStatus<T extends object>(
  em: EntityManager,
  entity: new () => T,
  statuses: readonly string[],
  scope: Scope,
): Promise<Record<string, number>> {
  return Promise.all(
    statuses.map(async (status) => {
      const count = await em.count(entity, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
        status,
      } as FilterQuery<T>)
      return [status, count] as const
    }),
  ).then((entries) => Object.fromEntries(entries))
}

async function fetchAverageCompleteness(em: EntityManager, scope: Scope): Promise<number | null> {
  const rows = await em.getConnection().execute(
    `select avg(completeness_score) as avg_completeness
       from eudr_evidence_submissions
      where tenant_id = ?
        and organization_id = ?
        and deleted_at is null`,
    [scope.tenantId, scope.organizationId],
  ) as AvgCompletenessRow[]
  const value = rows[0]?.avg_completeness ?? null
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function hasConcernAnswers(criteria: Record<string, { answer?: string }>): boolean {
  return Object.values(criteria).some((entry) => entry.answer === 'concern')
}

function buildReadinessGaps(submissions: EudrEvidenceSubmission[]): ReadinessGap[] {
  return submissions
    .filter((submission) => submission.status !== 'verified' || asNumber(submission.completenessScore) !== 100)
    .map((submission) => ({
      submissionId: submission.id,
      status: submission.status,
      completenessScore: asNumber(submission.completenessScore),
      missingFields: stringArray(submission.missingFields),
    }))
}

function riskSummary(assessment: EudrRiskAssessment | null) {
  if (!assessment) return null
  return {
    conclusion: assessment.conclusion,
    overallTier: assessment.overallTier,
    reviewDueAt: toIsoString(assessment.reviewDueAt),
  }
}

async function loadSubmissionsForStatements(
  em: EntityManager,
  statementIds: string[],
  scope: Scope,
): Promise<Map<string, EudrEvidenceSubmission[]>> {
  const byStatement = new Map<string, EudrEvidenceSubmission[]>()
  if (!statementIds.length) return byStatement
  const submissions = await findWithDecryption(
    em,
    EudrEvidenceSubmission,
    {
      statementId: { $in: statementIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<EudrEvidenceSubmission>,
    { orderBy: { createdAt: 'ASC' } },
    scope,
  )
  for (const submission of submissions) {
    if (!submission.statementId) continue
    const existing = byStatement.get(submission.statementId) ?? []
    existing.push(submission)
    byStatement.set(submission.statementId, existing)
  }
  return byStatement
}

async function loadLatestAssessmentsForStatements(
  em: EntityManager,
  statementIds: string[],
  scope: Scope,
): Promise<Map<string, EudrRiskAssessment>> {
  const latestByStatement = new Map<string, EudrRiskAssessment>()
  if (!statementIds.length) return latestByStatement
  const assessments = await findWithDecryption(
    em,
    EudrRiskAssessment,
    {
      statementId: { $in: statementIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<EudrRiskAssessment>,
    { orderBy: { assessedAt: 'DESC', createdAt: 'DESC' } },
    scope,
  )
  for (const assessment of assessments) {
    if (latestByStatement.has(assessment.statementId)) continue
    latestByStatement.set(assessment.statementId, assessment)
  }
  return latestByStatement
}

async function buildGateAssessment(
  em: EntityManager,
  assessment: EudrRiskAssessment | null,
  scope: Scope,
): Promise<GateAssessmentView> {
  if (!assessment) return null
  const completedMitigationCount = await em.count(EudrMitigationAction, {
    riskAssessmentId: assessment.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'completed',
    deletedAt: null,
  })
  return {
    conclusion: assessment.conclusion,
    countryRisks: assessment.countryRisks.map((risk) => ({ country: risk.country, tier: risk.tier })),
    reviewDueAt: assessment.reviewDueAt ?? null,
    hasConcernAnswers: hasConcernAnswers(assessment.criteria),
    hasCompletedMitigation: completedMitigationCount > 0,
  }
}

const GATE_REASON_TEXT: Record<string, string> = {
  referencedStatementsRequired: 'Referenced due diligence statement numbers are required for SME trader statements.',
  noSubmissions: 'No evidence submissions are linked to this statement.',
  submissionsNotReady: 'All linked evidence submissions must be verified and 100% complete.',
  originCountryMissing: 'Every linked evidence submission must include an origin country.',
  riskConclusionMissing: 'A latest negligible-risk assessment is required unless all origin countries are low risk.',
  riskAssessmentStale: 'The latest risk assessment does not cover the current set of origin countries.',
  riskReviewOverdue: 'The latest risk assessment review date is overdue.',
  mitigationIncomplete: 'At least one completed mitigation action is required for concern answers.',
}

function gateReasonKey(reason: string): string {
  return `eudr.gate.${reason}`
}

function gateReasonText(reason: string): string {
  return GATE_REASON_TEXT[reason] ?? reason
}

async function loadCatalogProductById(
  ctx: EudrToolContext,
  productId: string | undefined,
): Promise<{
  id: string
  name: string | null
  sku: string | null
  hsCode: string | null
} | null> {
  if (!productId) return null
  try {
    const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
    const scope = assertTenantScope(ctx)
    const result = await queryEngine.query<CatalogProductRecord>(E.catalog.catalog_product, {
      fields: ['id', 'title', 'name', 'sku', 'hs_code'],
      filters: [
        { field: 'id', op: 'eq', value: productId },
      ],
      page: { page: 1, pageSize: 1 },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    const product = result.items[0]
    if (!product) return null
    const id = readString(product.id)
    if (!id) return null
    return {
      id,
      name: readString(product.title) ?? readString(product.name),
      sku: readString(product.sku),
      hsCode: readString(product.hs_code),
    }
  } catch {
    return null
  }
}

const getComplianceOverviewTool: EudrAiToolDefinition = {
  name: 'eudr.get_compliance_overview',
  displayName: 'Get EUDR compliance overview',
  description:
    'Returns a live EUDR readiness dashboard for the current tenant and organization. Use this when the operator asks for overall compliance status, deadlines, how many mappings/submissions/statements exist, or whether risk reviews are coming due. Fields returned: deadline { date, daysLeft }, mappingsInScope, submissions { total, byStatus, incomplete, avgCompleteness }, statements { total, byStatus, notReady, missingReference }, and riskReviewsDueSoon.',
  inputSchema: overviewInput,
  requiredFeatures: ['eudr.statements.view', 'eudr.mappings.view', 'eudr.submissions.view', 'eudr.risk.view'],
  tags: ['read', 'eudr', 'overview', 'compliance'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    overviewInput.parse(rawInput)
    const scope = assertTenantScope(ctx)
    const em = resolveEm(ctx)
    const now = new Date()
    const reviewWindowEnd = new Date(now.getTime() + 30 * DAY_MS)

    const [
      mappingsInScope,
      submissionsTotal,
      submissionsByStatus,
      avgCompleteness,
      incomplete,
      statementsTotal,
      statementsByStatus,
      notReady,
      missingReference,
      riskReviewsDueSoon,
    ] = await Promise.all([
      em.count(EudrProductMapping, { ...scope, deletedAt: null, isInScope: true }),
      em.count(EudrEvidenceSubmission, { ...scope, deletedAt: null }),
      countRowsByStatus(em, EudrEvidenceSubmission, EUDR_SUBMISSION_STATUSES, scope),
      fetchAverageCompleteness(em, scope),
      em.count(EudrEvidenceSubmission, {
        ...scope,
        deletedAt: null,
        completenessScore: { $lt: 100 },
      } as FilterQuery<EudrEvidenceSubmission>),
      em.count(EudrDueDiligenceStatement, { ...scope, deletedAt: null }),
      countRowsByStatus(em, EudrDueDiligenceStatement, EUDR_STATEMENT_STATUSES, scope),
      em.count(EudrDueDiligenceStatement, { ...scope, deletedAt: null, status: 'draft' }),
      em.count(EudrDueDiligenceStatement, {
        ...scope,
        deletedAt: null,
        status: { $in: ['submitted', 'available'] },
        referenceNumber: null,
      } as FilterQuery<EudrDueDiligenceStatement>),
      em.count(EudrRiskAssessment, {
        ...scope,
        deletedAt: null,
        reviewDueAt: { $gte: now, $lte: reviewWindowEnd },
      } as FilterQuery<EudrRiskAssessment>),
    ])

    return {
      deadline: {
        date: EUDR_APPLICATION_DATES.largeAndMedium,
        daysLeft: daysLeft(EUDR_APPLICATION_DATES.largeAndMedium, now),
      },
      mappingsInScope,
      submissions: {
        total: submissionsTotal,
        byStatus: submissionsByStatus,
        avgCompleteness,
        incomplete,
      },
      statements: {
        total: statementsTotal,
        byStatus: statementsByStatus,
        notReady,
        missingReference,
      },
      riskReviewsDueSoon,
    }
  },
}

const listStatementReadinessTool: EudrAiToolDefinition = {
  name: 'eudr.list_statement_readiness',
  displayName: 'List EUDR statement readiness',
  description:
    'Checks due diligence statement export/submission readiness for one statement or the most recent non-archived statements. Use this when the operator asks whether statements are ready to submit/export, why a draft cannot move forward, what evidence is blocking a statement, or what the latest risk result says. Fields returned per item: id, title, status, commodity, readiness { ready, submissionCount, verifiedCount, completeCount, gaps [{ submissionId, status, completenessScore, missingFields }] }, latestRisk { conclusion, overallTier, reviewDueAt } or null, gateReasons as eudr.gate.* keys, and gateReasonsPlainText.',
  inputSchema: listStatementReadinessInput,
  requiredFeatures: ['eudr.statements.view', 'eudr.submissions.view', 'eudr.risk.view'],
  tags: ['read', 'eudr', 'statements', 'readiness'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const input = listStatementReadinessInput.parse(rawInput)
    const scope = assertTenantScope(ctx)
    const em = resolveEm(ctx)
    const statementWhere: FilterQuery<EudrDueDiligenceStatement> = input.statementId
      ? {
          id: input.statementId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        }
      : {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
          status: { $ne: 'archived' },
        }
    const statements = await em.find(EudrDueDiligenceStatement, statementWhere, {
      orderBy: { updatedAt: 'DESC', createdAt: 'DESC' },
      limit: input.statementId ? 1 : input.limit,
    })
    const statementIds = statements.map((statement) => statement.id)
    const submissionsByStatement = await loadSubmissionsForStatements(em, statementIds, scope)
    const latestRiskByStatement = await loadLatestAssessmentsForStatements(em, statementIds, scope)

    const items = await Promise.all(
      statements.map(async (statement) => {
        const submissions = submissionsByStatement.get(statement.id) ?? []
        const latestAssessment = latestRiskByStatement.get(statement.id) ?? null
        const readinessGaps = buildReadinessGaps(submissions)
        const gateSubmissions: GateSubmissionView[] = submissions.map((submission) => ({
          status: submission.status,
          completenessScore: asNumber(submission.completenessScore),
          originCountry: submission.originCountry ?? null,
        }))
        const gate = evaluateSubmissionGate({
          actorRole: statement.actorRole ?? null,
          referencedStatementsCount: Array.isArray(statement.referencedStatements)
            ? statement.referencedStatements.length
            : 0,
          submissions: gateSubmissions,
          latestAssessment: await buildGateAssessment(em, latestAssessment, scope),
        })

        return {
          id: statement.id,
          title: statement.title,
          status: statement.status,
          commodity: statement.commodity,
          readiness: {
            ready: submissions.length > 0 && readinessGaps.length === 0,
            submissionCount: submissions.length,
            verifiedCount: submissions.filter((submission) => submission.status === 'verified').length,
            completeCount: submissions.filter((submission) => asNumber(submission.completenessScore) === 100).length,
            gaps: readinessGaps,
          },
          latestRisk: riskSummary(latestAssessment),
          gateReasons: gate.reasons.map(gateReasonKey),
          gateReasonsPlainText: gate.reasons.map(gateReasonText),
        }
      }),
    )

    return {
      items,
      count: items.length,
    }
  },
}

const listEvidenceGapsTool: EudrAiToolDefinition = {
  name: 'eudr.list_evidence_gaps',
  displayName: 'List EUDR evidence gaps',
  description:
    'Lists incomplete EUDR evidence submissions for the current tenant and organization. Use this when the operator asks what supplier evidence is missing, which submissions are incomplete, which origin countries increase risk, or where to focus cleanup. Fields returned per item: id, supplier, commodity, status, completenessScore, missingFields, originCountry, and countryRiskTier.',
  inputSchema: listEvidenceGapsInput,
  requiredFeatures: ['eudr.submissions.view'],
  tags: ['read', 'eudr', 'submissions', 'gaps'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const input = listEvidenceGapsInput.parse(rawInput)
    const scope = assertTenantScope(ctx)
    const em = resolveEm(ctx)
    const where: FilterQuery<EudrEvidenceSubmission> = {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      completenessScore: { $lt: 100 },
    }
    if (input.commodity) where.commodity = input.commodity
    if (input.supplierEntityId) where.supplierEntityId = input.supplierEntityId

    const submissions = await findWithDecryption(
      em,
      EudrEvidenceSubmission,
      where,
      { orderBy: { completenessScore: 'ASC', updatedAt: 'DESC' }, limit: input.limit },
      scope,
    )

    return {
      items: submissions.map((submission) => ({
        id: submission.id,
        supplier: submission.supplierSnapshot?.displayName ?? null,
        commodity: submission.commodity,
        status: submission.status,
        completenessScore: asNumber(submission.completenessScore),
        missingFields: stringArray(submission.missingFields),
        originCountry: submission.originCountry ?? null,
        countryRiskTier: getCountryRiskTier(submission.originCountry ?? null),
      })),
      count: submissions.length,
      limit: input.limit,
    }
  },
}

const checkProductScopeTool: EudrAiToolDefinition = {
  name: 'eudr.check_product_scope',
  displayName: 'Check EUDR product scope',
  description:
    'Checks whether a product or HS code appears in EUDR Annex I scope. Use this when the operator asks if a product needs EUDR mapping, wants a commodity suggestion from an HS code, or needs to compare existing mappings against catalog HS data. Fields returned: existingMappings [{ id, commodity, isInScope, hsCode }], catalogProduct { id, name, sku, hsCode } or null, suggestedCommodity, and inAnnexScope.',
  inputSchema: checkProductScopeInput,
  requiredFeatures: ['eudr.mappings.view'],
  tags: ['read', 'eudr', 'mappings', 'scope'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const input = checkProductScopeInput.parse(rawInput)
    const scope = assertTenantScope(ctx)
    const em = resolveEm(ctx)
    const catalogProduct = await loadCatalogProductById(ctx, input.productId)
    const existingMappings = input.productId
      ? await em.find(EudrProductMapping, {
          productId: input.productId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        } as FilterQuery<EudrProductMapping>, {
          orderBy: { createdAt: 'DESC' },
          limit: 50,
        })
      : []
    const effectiveHsCode = input.hsCode ?? catalogProduct?.hsCode ?? null
    const suggestedCommodity = suggestCommodityForHsCode(effectiveHsCode)

    return {
      existingMappings: existingMappings.map((mapping) => ({
        id: mapping.id,
        commodity: mapping.commodity,
        isInScope: mapping.isInScope,
        hsCode: mapping.hsCode ?? null,
      })),
      catalogProduct,
      suggestedCommodity,
      inAnnexScope: suggestedCommodity !== null,
    }
  },
}

const getCountryRiskTool: EudrAiToolDefinition = {
  name: 'eudr.get_country_risk',
  displayName: 'Get EUDR country risk',
  description:
    'Returns the current EUDR country-risk tier from the module reference data. Use this when the operator asks whether a specific origin country is low, standard, high, or unknown risk, or when they need the compact high-risk list. With country, returns { country, tier }. Without country, returns { high, lowCount, note } and only includes the low-risk list when includeLowList is true.',
  inputSchema: getCountryRiskInput,
  requiredFeatures: ['eudr.submissions.view'],
  tags: ['read', 'eudr', 'country-risk', 'reference-data'],
  isMutation: false,
  handler: async (rawInput, ctx) => {
    const input = getCountryRiskInput.parse(rawInput)
    assertTenantScope(ctx)
    if (input.country) {
      return {
        country: input.country,
        tier: getCountryRiskTier(input.country),
      }
    }
    return {
      high: [...EUDR_HIGH_RISK_COUNTRIES],
      lowCount: EUDR_LOW_RISK_COUNTRIES.length,
      ...(input.includeLowList === true ? { low: [...EUDR_LOW_RISK_COUNTRIES] } : {}),
      note: 'Unlisted countries are standard risk.',
    }
  },
}

export const eudrComplianceAiTools: EudrAiToolDefinition[] = [
  getComplianceOverviewTool,
  listStatementReadinessTool,
  listEvidenceGapsTool,
  checkProductScopeTool,
  getCountryRiskTool,
]

export default eudrComplianceAiTools
