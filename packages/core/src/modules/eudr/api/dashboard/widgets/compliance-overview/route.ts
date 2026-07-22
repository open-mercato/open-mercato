import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  EudrDueDiligenceStatement,
  EudrEvidenceSubmission,
  EudrPlot,
  EudrProductMapping,
  EudrRiskAssessment,
} from '../../../../data/entities'
import { EUDR_APPLICATION_DATES } from '../../../../lib/reference-data'
import { EUDR_AMEND_WINDOW_MS, isAmendWindowOpen } from '../../../../lib/statement-lifecycle'
import {
  EUDR_STATEMENT_STATUSES,
  EUDR_SUBMISSION_STATUSES,
} from '../../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.statements.view'] },
}

const logger = createLogger('eudr').child({ component: 'api/dashboard/widgets/compliance-overview' })

type RequestContext = {
  em: EntityManager
  tenantId: string
  organizationId: string
  hasFeature: (feature: string) => Promise<boolean>
}

type AvgCompletenessRow = {
  avg_completeness: string | number | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const QUEUE_LIMIT = 5
const NON_TERMINAL_SUBMISSION_STATUSES = ['draft', 'submitted'] as const

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('eudr.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('eudr.errors.organization_required', 'Organization context is required'),
    })
  }

  let rbacService: RbacService | null
  try {
    rbacService = container.resolve('rbacService') as RbacService
  } catch {
    rbacService = null
  }
  const userId = auth.sub ?? null
  const tenantId = auth.tenantId

  return {
    em: container.resolve('em') as EntityManager,
    tenantId,
    organizationId,
    hasFeature: async (feature: string) => {
      if (!rbacService || !userId) return false
      try {
        return await rbacService.userHasAllFeatures(userId, [feature], { tenantId, organizationId })
      } catch {
        return false
      }
    },
  }
}

function countRowsByStatus<T extends object>(
  em: EntityManager,
  entity: new () => T,
  statuses: readonly string[],
  scope: { tenantId: string; organizationId: string },
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

async function fetchAverageCompleteness(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<number | null> {
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

function daysLeft(deadline: string, now: Date): number {
  const deadlineDate = new Date(`${deadline}T00:00:00.000Z`)
  return Math.ceil((deadlineDate.getTime() - now.getTime()) / DAY_MS)
}

type QueueScope = { tenantId: string; organizationId: string }

type IncompleteSubmissionQueueItem = { id: string; label: string | null; completeness: number; url: string }
type ReviewDueQueueItem = { id: string; label: string | null; dueAt: string; url: string }
type AmendWindowQueueItem = { id: string; label: string; expiresAt: string; url: string }
type PlotWarningQueueItem = { id: string; label: string; warnings: string[]; url: string }

type ComplianceQueues = {
  incompleteSubmissions?: IncompleteSubmissionQueueItem[]
  reviewsDue?: ReviewDueQueueItem[]
  amendWindow?: AmendWindowQueueItem[]
  plotsWithWarnings?: PlotWarningQueueItem[]
}

function readSupplierDisplayName(snapshot: { displayName?: string | null } | null | undefined): string | null {
  const displayName = snapshot?.displayName?.trim()
  return displayName && displayName.length > 0 ? displayName : null
}

async function fetchIncompleteSubmissionsQueue(
  em: EntityManager,
  scope: QueueScope,
): Promise<IncompleteSubmissionQueueItem[]> {
  const submissions = await em.find(EudrEvidenceSubmission, {
    ...scope,
    deletedAt: null,
    status: { $in: [...NON_TERMINAL_SUBMISSION_STATUSES] },
    completenessScore: { $lt: 100 },
  } as FilterQuery<EudrEvidenceSubmission>, {
    fields: ['id', 'supplierSnapshot', 'batchNumber', 'completenessScore'],
    orderBy: { completenessScore: 'asc' },
    limit: QUEUE_LIMIT,
  })
  return submissions.map((submission) => {
    const batchNumber = typeof submission.batchNumber === 'string' && submission.batchNumber.trim().length > 0
      ? submission.batchNumber.trim()
      : null
    return {
      id: submission.id,
      label: readSupplierDisplayName(submission.supplierSnapshot) ?? batchNumber,
      completeness: submission.completenessScore,
      url: `/backend/eudr/evidence-submissions/${submission.id}`,
    }
  })
}

async function fetchReviewsDueQueue(
  em: EntityManager,
  scope: QueueScope,
  now: Date,
): Promise<ReviewDueQueueItem[]> {
  const reviewWindowEnd = new Date(now.getTime() + 30 * DAY_MS)
  const assessments = await em.find(EudrRiskAssessment, {
    ...scope,
    deletedAt: null,
    reviewDueAt: { $ne: null, $lte: reviewWindowEnd },
  } as FilterQuery<EudrRiskAssessment>, {
    fields: ['id', 'statementId', 'conclusion', 'reviewDueAt'],
    orderBy: { reviewDueAt: 'asc' },
    limit: QUEUE_LIMIT,
  })
  const statementIds = [...new Set(assessments.map((assessment) => assessment.statementId))]
  const statements = statementIds.length > 0
    ? await em.find(EudrDueDiligenceStatement, {
        ...scope,
        deletedAt: null,
        id: { $in: statementIds },
      } as FilterQuery<EudrDueDiligenceStatement>, { fields: ['id', 'title'] })
    : []
  const statementTitleById = new Map(statements.map((statement) => [statement.id, statement.title]))
  return assessments.flatMap((assessment) => {
    const dueAt = assessment.reviewDueAt
    if (!dueAt) return []
    const statementTitle = statementTitleById.get(assessment.statementId) ?? null
    return [{
      id: assessment.id,
      label: statementTitle,
      dueAt: dueAt.toISOString(),
      url: statementTitle !== null
        ? `/backend/eudr/statements/${assessment.statementId}`
        : `/backend/eudr/risk-assessments/${assessment.id}`,
    }]
  })
}

async function fetchAmendWindowQueue(
  em: EntityManager,
  scope: QueueScope,
  now: Date,
): Promise<AmendWindowQueueItem[]> {
  const windowStart = new Date(now.getTime() - EUDR_AMEND_WINDOW_MS)
  const statements = await em.find(EudrDueDiligenceStatement, {
    ...scope,
    deletedAt: null,
    status: 'available',
    referenceIssuedAt: { $ne: null, $gte: windowStart },
  } as FilterQuery<EudrDueDiligenceStatement>, {
    fields: ['id', 'title', 'referenceIssuedAt'],
    orderBy: { referenceIssuedAt: 'asc' },
    limit: QUEUE_LIMIT,
  })
  return statements.flatMap((statement) => {
    const issuedAt = statement.referenceIssuedAt
    if (!issuedAt || !isAmendWindowOpen(issuedAt, now)) return []
    return [{
      id: statement.id,
      label: statement.title,
      expiresAt: new Date(issuedAt.getTime() + EUDR_AMEND_WINDOW_MS).toISOString(),
      url: `/backend/eudr/statements/${statement.id}`,
    }]
  })
}

type PlotWarningRow = { id: string; name: string; validation_warnings: unknown }

async function fetchPlotsWithWarningsQueue(
  em: EntityManager,
  scope: QueueScope,
): Promise<PlotWarningQueueItem[]> {
  const rows = await em.getConnection().execute(
    `select id, name, validation_warnings
       from eudr_plots
      where tenant_id = ?
        and organization_id = ?
        and deleted_at is null
        and is_active = true
        and jsonb_array_length(validation_warnings) > 0
      order by name asc
      limit ${QUEUE_LIMIT}`,
    [scope.tenantId, scope.organizationId],
  ) as PlotWarningRow[]
  return rows.map((row) => ({
    id: row.id,
    label: row.name,
    warnings: Array.isArray(row.validation_warnings)
      ? row.validation_warnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
    url: `/backend/eudr/plots/${row.id}`,
  }))
}

type PlotCountsRow = { with_warnings: number | string | null }

async function fetchPlotCounts(
  em: EntityManager,
  scope: QueueScope,
): Promise<{ active: number; withWarnings: number }> {
  const [active, rows] = await Promise.all([
    em.count(EudrPlot, { ...scope, deletedAt: null, isActive: true }),
    em.getConnection().execute(
      `select count(*)::int as with_warnings
         from eudr_plots
        where tenant_id = ?
          and organization_id = ?
          and deleted_at is null
          and is_active = true
          and jsonb_array_length(validation_warnings) > 0`,
      [scope.tenantId, scope.organizationId],
    ) as Promise<PlotCountsRow[]>,
  ])
  const rawWithWarnings = rows[0]?.with_warnings ?? 0
  const withWarnings = typeof rawWithWarnings === 'number' ? rawWithWarnings : Number(rawWithWarnings)
  return { active, withWarnings: Number.isFinite(withWarnings) ? withWarnings : 0 }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
    const now = new Date()
    const reviewWindowEnd = new Date(now.getTime() + 30 * DAY_MS)

    const [
      canViewMappingsRollup,
      canViewSubmissionsQueue,
      canViewRiskQueue,
      canViewStatementsQueue,
      canViewPlotsQueue,
    ] = await Promise.all([
      ctx.hasFeature('eudr.mappings.view'),
      ctx.hasFeature('eudr.submissions.view'),
      ctx.hasFeature('eudr.risk.view'),
      ctx.hasFeature('eudr.statements.view'),
      ctx.hasFeature('eudr.plots.view'),
    ])

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
      incompleteSubmissionsQueue,
      reviewsDueQueue,
      amendWindowQueue,
      plotsWithWarningsQueue,
      plotCounts,
    ] = await Promise.all([
      canViewMappingsRollup
        ? ctx.em.count(EudrProductMapping, { ...scope, deletedAt: null, isInScope: true })
        : Promise.resolve(null),
      canViewSubmissionsQueue
        ? ctx.em.count(EudrEvidenceSubmission, { ...scope, deletedAt: null })
        : Promise.resolve(null),
      canViewSubmissionsQueue
        ? countRowsByStatus(ctx.em, EudrEvidenceSubmission, EUDR_SUBMISSION_STATUSES, scope)
        : Promise.resolve(null),
      canViewSubmissionsQueue ? fetchAverageCompleteness(ctx.em, scope) : Promise.resolve(null),
      canViewSubmissionsQueue
        ? ctx.em.count(EudrEvidenceSubmission, { ...scope, deletedAt: null, completenessScore: { $lt: 100 } } as FilterQuery<EudrEvidenceSubmission>)
        : Promise.resolve(null),
      ctx.em.count(EudrDueDiligenceStatement, { ...scope, deletedAt: null }),
      countRowsByStatus(ctx.em, EudrDueDiligenceStatement, EUDR_STATEMENT_STATUSES, scope),
      ctx.em.count(EudrDueDiligenceStatement, { ...scope, deletedAt: null, status: 'draft' }),
      ctx.em.count(EudrDueDiligenceStatement, {
        ...scope,
        deletedAt: null,
        status: { $in: ['submitted', 'available'] },
        referenceNumber: null,
      } as FilterQuery<EudrDueDiligenceStatement>),
      canViewRiskQueue
        ? ctx.em.count(EudrRiskAssessment, {
            ...scope,
            deletedAt: null,
            reviewDueAt: { $gte: now, $lte: reviewWindowEnd },
          } as FilterQuery<EudrRiskAssessment>)
        : Promise.resolve(null),
      canViewSubmissionsQueue ? fetchIncompleteSubmissionsQueue(ctx.em, scope) : Promise.resolve(null),
      canViewRiskQueue ? fetchReviewsDueQueue(ctx.em, scope, now) : Promise.resolve(null),
      canViewStatementsQueue ? fetchAmendWindowQueue(ctx.em, scope, now) : Promise.resolve(null),
      canViewPlotsQueue ? fetchPlotsWithWarningsQueue(ctx.em, scope) : Promise.resolve(null),
      canViewPlotsQueue ? fetchPlotCounts(ctx.em, scope) : Promise.resolve(null),
    ])

    const queues: ComplianceQueues = {}
    if (incompleteSubmissionsQueue !== null) queues.incompleteSubmissions = incompleteSubmissionsQueue
    if (reviewsDueQueue !== null) queues.reviewsDue = reviewsDueQueue
    if (amendWindowQueue !== null) queues.amendWindow = amendWindowQueue
    if (plotsWithWarningsQueue !== null) queues.plotsWithWarnings = plotsWithWarningsQueue

    return Response.json({
      deadline: {
        date: EUDR_APPLICATION_DATES.largeAndMedium,
        daysLeft: daysLeft(EUDR_APPLICATION_DATES.largeAndMedium, now),
      },
      ...(mappingsInScope !== null ? { mappingsInScope } : {}),
      ...(submissionsTotal !== null && submissionsByStatus !== null && incomplete !== null
        ? {
            submissions: {
              total: submissionsTotal,
              byStatus: submissionsByStatus,
              avgCompleteness,
              incomplete,
            },
          }
        : {}),
      statements: {
        total: statementsTotal,
        byStatus: statementsByStatus,
        notReady,
        missingReference,
      },
      ...(riskReviewsDueSoon !== null ? { riskReviewsDueSoon } : {}),
      ...(plotCounts !== null ? { plots: plotCounts } : {}),
      queues,
    })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return Response.json(error.body, { status: error.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('Compliance overview loading failed', { err: error })
    return Response.json(
      { error: translate('eudr.errors.compliance_overview_failed', 'Failed to load EUDR compliance overview') },
      { status: 500 },
    )
  }
}

const responseSchema = z.object({
  deadline: z.object({
    date: z.literal(EUDR_APPLICATION_DATES.largeAndMedium),
    daysLeft: z.number(),
  }),
  mappingsInScope: z.number().optional(),
  submissions: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
    avgCompleteness: z.number().nullable(),
    incomplete: z.number(),
  }).optional(),
  statements: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
    notReady: z.number(),
    missingReference: z.number(),
  }),
  riskReviewsDueSoon: z.number().optional(),
  plots: z.object({
    active: z.number(),
    withWarnings: z.number(),
  }).optional(),
  queues: z.object({
    incompleteSubmissions: z.array(z.object({
      id: z.string(),
      label: z.string().nullable(),
      completeness: z.number(),
      url: z.string(),
    })).optional(),
    reviewsDue: z.array(z.object({
      id: z.string(),
      label: z.string().nullable(),
      dueAt: z.string(),
      url: z.string(),
    })).optional(),
    amendWindow: z.array(z.object({
      id: z.string(),
      label: z.string(),
      expiresAt: z.string(),
      url: z.string(),
    })).optional(),
    plotsWithWarnings: z.array(z.object({
      id: z.string(),
      label: z.string(),
      warnings: z.array(z.string()),
      url: z.string(),
    })).optional(),
  }),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'EUDR compliance overview widget',
  methods: {
    GET: {
      summary: 'Compliance overview',
      responses: [
        { status: 200, description: 'EUDR compliance overview metrics', schema: responseSchema },
        { status: 400, description: 'Invalid organization context', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 500, description: 'Compliance overview loading failed', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
