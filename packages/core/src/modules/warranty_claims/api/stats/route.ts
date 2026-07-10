import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type SelectQueryBuilder } from 'kysely'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveEffectiveWarrantyClaimSettings } from '../../lib/settings'

type NumericAggregateValue = string | number | bigint | null

type WarrantyClaimsStatsTable = {
  id: string
  organization_id: string
  tenant_id: string
  status: string
  deleted_at: Date | null
  sla_due_at: Date | null
  sla_paused_at: Date | null
  assignee_user_id: string | null
  submitted_at: Date | null
  resolved_at: Date | null
  total_approved_amount: string | number | null
  total_recovered_amount: string | number | null
  currency_code: string | null
}

type WarrantyClaimsStatsDb = {
  warranty_claims: WarrantyClaimsStatsTable
}

type StatsRouteContext = {
  tenantId: string
  organizationIds: string[]
  userId: string | null
  em: EntityManager
}

const querySchema = z.object({}).strict()

const OPEN_STATUSES = [
  'submitted',
  'in_review',
  'info_requested',
  'approved',
  'awaiting_return',
  'received',
  'inspecting',
]

const OVERDUE_EXCLUDED_STATUSES = ['resolved', 'closed', 'rejected', 'cancelled', 'draft']
const RESOLUTION_STATUSES = ['resolved', 'closed']
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

const recoveredByCurrencySchema = z.object({
  currencyCode: z.string().nullable(),
  total: z.number(),
})

const resultSchema = z.object({
  openByStatus: z.record(z.string(), z.number().int().nonnegative()),
  overdue: z.number().int().nonnegative(),
  slaAtRisk: z.number().int().nonnegative(),
  assignedToMe: z.number().int().nonnegative(),
  resolvedLast30d: z.number().int().nonnegative(),
  avgResolutionDays: z.number().nullable(),
  approvalRatePct: z.number().nullable(),
  recoveredLast30dByCurrency: z.array(recoveredByCurrencySchema),
  slaAtRiskThresholdPct: z.number().int().min(1).max(100),
})

const responseSchema = z.object({
  ok: z.literal(true),
  result: resultSchema,
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['warranty_claims.claim.view'] },
}

function parseNumeric(value: NumericAggregateValue | undefined): number {
  if (value === undefined || value === null) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function applyOrganizationScope<O>(
  query: SelectQueryBuilder<WarrantyClaimsStatsDb, 'warranty_claims', O>,
  organizationIds: string[],
): SelectQueryBuilder<WarrantyClaimsStatsDb, 'warranty_claims', O> {
  if (organizationIds.length === 1) {
    return query.where('organization_id', '=', organizationIds[0])
  }
  return query.where('organization_id', 'in', organizationIds)
}

function baseClaimsQuery<O>(
  query: SelectQueryBuilder<WarrantyClaimsStatsDb, 'warranty_claims', O>,
  context: StatsRouteContext,
): SelectQueryBuilder<WarrantyClaimsStatsDb, 'warranty_claims', O> {
  return applyOrganizationScope(
    query
      .where('tenant_id', '=', context.tenantId)
      .where('deleted_at', 'is', null),
    context.organizationIds,
  )
}

async function resolveStatsContext(req: Request): Promise<StatsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('warranty_claims.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationIds = Array.isArray(scope?.filterIds) && scope.filterIds.length > 0
    ? scope.filterIds
    : auth.orgId
      ? [auth.orgId]
      : []
  if (organizationIds.length === 0) {
    throw new CrudHttpError(400, { error: translate('warranty_claims.errors.organization_required', 'Organization context is required') })
  }
  return {
    tenantId: auth.tenantId,
    organizationIds,
    userId: typeof auth.sub === 'string' ? auth.sub : null,
    em: (container.resolve('em') as EntityManager).fork(),
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    querySchema.parse(Object.fromEntries(url.searchParams))
    const context = await resolveStatsContext(req)
    const db = context.em.getKysely<WarrantyClaimsStatsDb>()
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS)
    const effectiveSettings = await resolveEffectiveWarrantyClaimSettings(context.em, {
      tenantId: context.tenantId,
      organizationId: context.organizationIds[0] ?? null,
    })

    const openRows = await baseClaimsQuery(
      db
        .selectFrom('warranty_claims')
        .select(['status', sql<NumericAggregateValue>`count(*)`.as('count')])
        .where('status', 'in', OPEN_STATUSES)
        .groupBy('status'),
      context,
    ).execute()
    const openByStatus: Record<string, number> = Object.fromEntries(OPEN_STATUSES.map((status) => [status, 0]))
    for (const row of openRows) {
      openByStatus[row.status] = Math.trunc(parseNumeric(row.count))
    }

    const overdueRow = await baseClaimsQuery(
      db
        .selectFrom('warranty_claims')
        .select(sql<NumericAggregateValue>`count(*)`.as('count'))
        .where('sla_due_at', '<', now)
        .where('sla_paused_at', 'is', null)
        .where('status', 'not in', OVERDUE_EXCLUDED_STATUSES),
      context,
    ).executeTakeFirst()
    const overdue = Math.trunc(parseNumeric(overdueRow?.count))

    const atRiskRow = await baseClaimsQuery(
      db
        .selectFrom('warranty_claims')
        .select(sql<NumericAggregateValue>`count(*)`.as('count'))
        .where('sla_due_at', '>', now)
        .where('sla_paused_at', 'is', null)
        .where('status', 'not in', OVERDUE_EXCLUDED_STATUSES)
        .where('submitted_at', 'is not', null)
        .where(sql<boolean>`sla_due_at > submitted_at`)
        .where(sql<boolean>`extract(epoch from (${now}::timestamptz - submitted_at)) * 100 >= extract(epoch from (sla_due_at - submitted_at)) * ${effectiveSettings.slaAtRiskThresholdPct}`),
      context,
    ).executeTakeFirst()
    const slaAtRisk = Math.trunc(parseNumeric(atRiskRow?.count))

    let assignedToMe = 0
    if (context.userId) {
      const assignedRow = await baseClaimsQuery(
        db
          .selectFrom('warranty_claims')
          .select(sql<NumericAggregateValue>`count(*)`.as('count'))
          .where('status', 'in', OPEN_STATUSES)
          .where('assignee_user_id', '=', context.userId),
        context,
      ).executeTakeFirst()
      assignedToMe = Math.trunc(parseNumeric(assignedRow?.count))
    }

    const resolvedRow = await baseClaimsQuery(
      db
        .selectFrom('warranty_claims')
        .select(sql<NumericAggregateValue>`count(*)`.as('count'))
        .where('resolved_at', '>=', thirtyDaysAgo),
      context,
    ).executeTakeFirst()
    const resolvedLast30d = Math.trunc(parseNumeric(resolvedRow?.count))

    const avgRow = await baseClaimsQuery(
      db
        .selectFrom('warranty_claims')
        .select(sql<NumericAggregateValue>`avg(extract(epoch from (resolved_at - submitted_at)) / 86400.0)`.as('avgDays'))
        .where('resolved_at', '>=', thirtyDaysAgo)
        .where('submitted_at', 'is not', null),
      context,
    ).executeTakeFirst()
    const avgValue = avgRow?.avgDays
    const avgResolutionDays = avgValue === undefined || avgValue === null
      ? null
      : Number(parseNumeric(avgValue).toFixed(1))

    const approvalRow = await baseClaimsQuery(
      db
        .selectFrom('warranty_claims')
        .select([
          sql<NumericAggregateValue>`count(*)`.as('total'),
          sql<NumericAggregateValue>`count(*) filter (where total_approved_amount > 0)`.as('approved'),
        ])
        .where('status', 'in', RESOLUTION_STATUSES)
        .where('resolved_at', '>=', thirtyDaysAgo),
      context,
    ).executeTakeFirst()
    const approvalTotal = parseNumeric(approvalRow?.total)
    const approvalApproved = parseNumeric(approvalRow?.approved)
    const approvalRatePct = approvalTotal > 0 ? Math.round((approvalApproved / approvalTotal) * 100) : null

    const recoveredRows = await baseClaimsQuery(
      db
        .selectFrom('warranty_claims')
        .select([
          'currency_code as currencyCode',
          sql<NumericAggregateValue>`coalesce(sum(total_recovered_amount), 0)`.as('total'),
        ])
        .where('status', 'in', RESOLUTION_STATUSES)
        .where('resolved_at', '>=', thirtyDaysAgo)
        .where('total_recovered_amount', '>', 0)
        .groupBy('currency_code'),
      context,
    ).execute()
    const recoveredLast30dByCurrency = recoveredRows.map((row) => ({
      currencyCode: row.currencyCode ?? null,
      total: Number(parseNumeric(row.total).toFixed(2)),
    }))

    return NextResponse.json({
      ok: true,
      result: {
        openByStatus,
        overdue,
        slaAtRisk,
        assignedToMe,
        resolvedLast30d,
        avgResolutionDays,
        approvalRatePct,
        recoveredLast30dByCurrency,
        slaAtRiskThresholdPct: effectiveSettings.slaAtRiskThresholdPct,
      },
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    console.error('warranty_claims.stats.get failed', err)
    return NextResponse.json({ error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims',
  summary: 'Warranty claim statistics',
  methods: {
    GET: {
      summary: 'Get warranty claim queue and resolution statistics',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Warranty claim statistics',
          schema: responseSchema,
        },
      ],
    },
  },
}
