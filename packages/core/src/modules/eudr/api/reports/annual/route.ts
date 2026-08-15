import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  accumulateSupplementaryQuantities,
  annualReportSchema,
  buildAnnualReportCsv,
  type AnnualReport,
} from '../../../lib/annual-report'
import { getCountryRiskTier } from '../../../lib/reference-data'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.statements.view'] },
}

const logger = createLogger('eudr').child({ route: 'reports/annual' })
const INCLUDED_STATUSES = ['submitted', 'available', 'withdrawn', 'archived'] as const

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  format: z.enum(['json', 'csv']).default('json'),
})

type AnnualReportDatabase = {
  eudr_due_diligence_statements: {
    id: string
    tenant_id: string
    organization_id: string
    submitted_at: Date | null
    status: string
    commodity: string
    quantity_kg: string | number | null
    supplementary_unit: string | null
    supplementary_quantity: string | number | null
    deleted_at: Date | null
  }
  eudr_evidence_submissions: {
    statement_id: string | null
    tenant_id: string
    organization_id: string
    origin_country: string | null
    deleted_at: Date | null
  }
  eudr_risk_assessments: {
    id: string
    statement_id: string
    tenant_id: string
    organization_id: string
    conclusion: string
    is_simplified: boolean
    assessed_at: Date
    created_at: Date
    deleted_at: Date | null
  }
  eudr_mitigation_actions: {
    risk_assessment_id: string
    tenant_id: string
    organization_id: string
    status: string
    deleted_at: Date | null
  }
}

type ReportScope = {
  tenantId: string
  organizationIds: string[] | null
}

type RequestContext = ReportScope & {
  db: Kysely<AnnualReportDatabase>
  hasFeature: (feature: string) => Promise<boolean>
}

type StatusCountRow = { status: string; count: unknown }
type CommodityAggregateRow = {
  commodity: string
  count: unknown
  quantity_kg: unknown
}
type SupplementaryAggregateRow = {
  commodity: string
  unit: string | null
  quantity: unknown
}
type CountryAggregateRow = { country: string | null; submission_count: unknown }
type RiskAggregateRow = {
  assessments: unknown
  negligible: unknown
  non_negligible: unknown
  simplified: unknown
}
type MitigationAggregateRow = { total: unknown; completed: unknown }

async function resolveRequestContext(request: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  const { translate } = await resolveTranslations()

  if (!auth?.tenantId) {
    throw new CrudHttpError(401, {
      error: translate('eudr.errors.unauthorized', 'Unauthorized'),
    })
  }

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const organizationIds = Array.isArray(organizationScope.filterIds)
    ? organizationScope.filterIds
    : null
  const featureOrganizationId = organizationScope.selectedId ?? auth.orgId ?? null
  const tenantId = auth.tenantId
  const userId = auth.sub ?? null
  const em = container.resolve('em') as EntityManager

  let rbacService: RbacService | null
  try {
    rbacService = container.resolve('rbacService') as RbacService
  } catch {
    rbacService = null
  }

  return {
    db: em.getKysely<AnnualReportDatabase>(),
    tenantId,
    organizationIds,
    hasFeature: async (feature: string) => {
      if (!rbacService || !userId) return false
      try {
        return await rbacService.userHasAllFeatures(userId, [feature], {
          tenantId,
          organizationId: featureOrganizationId,
        })
      } catch {
        return false
      }
    },
  }
}

function buildStatementBucket(
  db: Kysely<AnnualReportDatabase>,
  scope: ReportScope,
  start: Date,
  end: Date,
) {
  let query = db
    .selectFrom('eudr_due_diligence_statements')
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
    .where('submitted_at', '>=', start)
    .where('submitted_at', '<', end)
    .where('status', 'in', [...INCLUDED_STATUSES])

  if (Array.isArray(scope.organizationIds)) {
    query = query.where('organization_id', 'in', scope.organizationIds)
  }
  return query
}

function buildLatestAssessments(
  db: Kysely<AnnualReportDatabase>,
  scope: ReportScope,
  start: Date,
  end: Date,
) {
  let query = db
    .selectFrom('eudr_risk_assessments')
    .distinctOn('statement_id')
    .select(['id', 'statement_id', 'conclusion', 'is_simplified'])
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
    .where('statement_id', 'in', buildStatementBucket(db, scope, start, end).select('id'))
    .orderBy('statement_id', 'asc')
    .orderBy('assessed_at', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')

  if (Array.isArray(scope.organizationIds)) {
    query = query.where('organization_id', 'in', scope.organizationIds)
  }
  return query
}

function normalizeCount(value: unknown): number {
  const count = Number(value ?? 0)
  return Number.isFinite(count) && count >= 0 ? count : 0
}

function normalizeQuantity(value: unknown): string {
  const quantity = typeof value === 'bigint'
    ? value.toString()
    : (typeof value === 'string' || typeof value === 'number' ? value : null)
  return accumulateSupplementaryQuantities([{ unit: 'KG', quantity }])[0]?.quantity ?? '0.000'
}

async function fetchStatementAggregates(
  db: Kysely<AnnualReportDatabase>,
  scope: ReportScope,
  start: Date,
  end: Date,
): Promise<AnnualReport['statements']> {
  const [rawStatusRows, rawCommodityRows, rawSupplementaryRows] = await Promise.all([
    buildStatementBucket(db, scope, start, end)
      .select(['status', sql<string>`count(*)`.as('count')])
      .groupBy('status')
      .orderBy('status', 'asc')
      .execute(),
    buildStatementBucket(db, scope, start, end)
      .select([
        'commodity',
        sql<string>`count(*)`.as('count'),
        sql<string>`coalesce(sum(quantity_kg), 0)`.as('quantity_kg'),
      ])
      .groupBy('commodity')
      .orderBy('commodity', 'asc')
      .execute(),
    buildStatementBucket(db, scope, start, end)
      .select([
        'commodity',
        'supplementary_unit as unit',
        sql<string>`coalesce(sum(supplementary_quantity), 0)`.as('quantity'),
      ])
      .where('supplementary_unit', 'is not', null)
      .where(sql<boolean>`trim(supplementary_unit) != ''`)
      .groupBy(['commodity', 'supplementary_unit'])
      .orderBy('commodity', 'asc')
      .orderBy('supplementary_unit', 'asc')
      .execute(),
  ])

  const statusRows = rawStatusRows as StatusCountRow[]
  const commodityRows = rawCommodityRows as CommodityAggregateRow[]
  const supplementaryRows = rawSupplementaryRows as SupplementaryAggregateRow[]
  const byStatus = Object.fromEntries(
    statusRows.map((row) => [row.status, normalizeCount(row.count)]),
  )
  const supplementaryByCommodity = new Map<string, SupplementaryAggregateRow[]>()
  for (const row of supplementaryRows) {
    const rows = supplementaryByCommodity.get(row.commodity) ?? []
    rows.push(row)
    supplementaryByCommodity.set(row.commodity, rows)
  }

  return {
    total: Object.values(byStatus).reduce((total, count) => total + count, 0),
    byStatus,
    byCommodity: commodityRows.map((row) => ({
      commodity: row.commodity,
      count: normalizeCount(row.count),
      quantityKg: normalizeQuantity(row.quantity_kg),
      supplementaryQuantities: accumulateSupplementaryQuantities(
        (supplementaryByCommodity.get(row.commodity) ?? []).map((supplementary) => ({
          unit: supplementary.unit,
          quantity: typeof supplementary.quantity === 'bigint'
            ? supplementary.quantity.toString()
            : (typeof supplementary.quantity === 'string' || typeof supplementary.quantity === 'number'
                ? supplementary.quantity
                : null),
        })),
      ),
    })),
  }
}

async function fetchCountryAggregates(
  db: Kysely<AnnualReportDatabase>,
  scope: ReportScope,
  start: Date,
  end: Date,
): Promise<NonNullable<AnnualReport['countries']>> {
  let query = db
    .selectFrom('eudr_evidence_submissions')
    .select([
      'origin_country as country',
      sql<string>`count(*)`.as('submission_count'),
    ])
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
    .where('origin_country', 'is not', null)
    .where(sql<boolean>`trim(origin_country) != ''`)
    .where('statement_id', 'in', buildStatementBucket(db, scope, start, end).select('id'))
    .groupBy('origin_country')
    .orderBy('origin_country', 'asc')

  if (Array.isArray(scope.organizationIds)) {
    query = query.where('organization_id', 'in', scope.organizationIds)
  }

  const rows = await query.execute() as CountryAggregateRow[]
  return rows.flatMap((row) => {
    const country = row.country?.trim().toUpperCase() ?? ''
    if (country.length === 0) return []
    return [{
      country,
      tier: getCountryRiskTier(country),
      submissionCount: normalizeCount(row.submission_count),
    }]
  })
}

async function fetchRiskAggregates(
  db: Kysely<AnnualReportDatabase>,
  scope: ReportScope,
  start: Date,
  end: Date,
): Promise<{
  risk: NonNullable<AnnualReport['risk']>
  mitigation: NonNullable<AnnualReport['mitigation']>
}> {
  const latestAssessments = buildLatestAssessments(db, scope, start, end)
  const latestAssessmentIds = db
    .selectFrom(latestAssessments.as('latest_assessment'))
    .select('latest_assessment.id')

  let mitigationQuery = db
    .selectFrom('eudr_mitigation_actions')
    .select([
      sql<string>`count(*)`.as('total'),
      sql<string>`count(*) filter (where status = 'completed')`.as('completed'),
    ])
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
    .where('risk_assessment_id', 'in', latestAssessmentIds)

  if (Array.isArray(scope.organizationIds)) {
    mitigationQuery = mitigationQuery.where('organization_id', 'in', scope.organizationIds)
  }

  const [rawRisk, rawMitigation] = await Promise.all([
    db
      .selectFrom(latestAssessments.as('latest_assessment'))
      .select([
        sql<string>`count(*)`.as('assessments'),
        sql<string>`count(*) filter (where conclusion = 'negligible')`.as('negligible'),
        sql<string>`count(*) filter (where conclusion = 'non_negligible')`.as('non_negligible'),
        sql<string>`count(*) filter (where is_simplified = true)`.as('simplified'),
      ])
      .executeTakeFirst(),
    mitigationQuery.executeTakeFirst(),
  ])
  const riskRow = (rawRisk ?? {}) as Partial<RiskAggregateRow>
  const mitigationRow = (rawMitigation ?? {}) as Partial<MitigationAggregateRow>

  return {
    risk: {
      assessments: normalizeCount(riskRow.assessments),
      negligible: normalizeCount(riskRow.negligible),
      nonNegligible: normalizeCount(riskRow.non_negligible),
      simplified: normalizeCount(riskRow.simplified),
    },
    mitigation: {
      total: normalizeCount(mitigationRow.total),
      completed: normalizeCount(mitigationRow.completed),
    },
  }
}

export async function GET(request: Request) {
  const parsedQuery = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()))
  if (!parsedQuery.success) {
    const { translate } = await resolveTranslations()
    return Response.json({
      error: translate('eudr.errors.invalid_query', 'Invalid query'),
      details: parsedQuery.error.flatten(),
    }, { status: 400 })
  }

  try {
    const context = await resolveRequestContext(request)
    const scope: ReportScope = {
      tenantId: context.tenantId,
      organizationIds: context.organizationIds,
    }
    const start = new Date(Date.UTC(parsedQuery.data.year, 0, 1))
    const end = new Date(Date.UTC(parsedQuery.data.year + 1, 0, 1))
    const [canViewCountries, canViewRisk] = await Promise.all([
      context.hasFeature('eudr.submissions.view'),
      context.hasFeature('eudr.risk.view'),
    ])

    const [statements, countries, riskBlocks] = await Promise.all([
      fetchStatementAggregates(context.db, scope, start, end),
      canViewCountries
        ? fetchCountryAggregates(context.db, scope, start, end)
        : Promise.resolve(null),
      canViewRisk
        ? fetchRiskAggregates(context.db, scope, start, end)
        : Promise.resolve(null),
    ])

    const report = annualReportSchema.parse({
      year: parsedQuery.data.year,
      generatedAt: new Date().toISOString(),
      statements,
      ...(countries !== null ? { countries } : {}),
      ...(riskBlocks !== null ? riskBlocks : {}),
    })

    if (parsedQuery.data.format === 'csv') {
      const serialized = buildAnnualReportCsv(report)
      return new Response(serialized.content, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="eudr-annual-report-${report.year}.csv"`,
        },
      })
    }

    return Response.json(report)
  } catch (error) {
    if (isCrudHttpError(error)) {
      return Response.json(error.body, { status: error.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('Annual report generation failed', { err: error })
    return Response.json(
      { error: translate('eudr.errors.annual_report_failed', 'Failed to generate EUDR annual report') },
      { status: 500 },
    )
  }
}

const errorSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'Generate an annual EUDR due diligence report',
  methods: {
    GET: {
      summary: 'Generate an annual EUDR due diligence report',
      description: 'Returns aggregate-only annual statement metrics. Country, risk, and mitigation blocks are omitted unless the caller holds their corresponding view features. Use format=csv for a statement-derived commodity export.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Annual EUDR due diligence report (JSON by default; with format=csv the same endpoint streams a statement-derived commodity table as text/csv)',
          schema: annualReportSchema,
        },
        { status: 400, description: 'Invalid report query', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
        { status: 500, description: 'Annual report generation failed', schema: errorSchema },
      ],
    },
  },
}
