import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { dashboardsErrorSchema, dashboardsTag } from '../openapi'
import { computeInsights, type InsightsScope } from '../../lib/insights'
import type { AnalyticsRegistry } from '../../services/analyticsRegistry'
import { createWidgetDataService, WidgetDataValidationError } from '../../services/widgetDataService'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

const isoDateSchema = z.string().regex(ISO_DATE_PATTERN).refine((value) => isoDateToUtcMs(value) !== null, {
  message: 'Invalid ISO date',
})

export const insightsQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    compare: z.enum(['previous_period', 'previous_year', 'none']).default('previous_period'),
  })
  .superRefine((query, ctx) => {
    const from = isoDateToUtcMs(query.from)
    const to = isoDateToUtcMs(query.to)
    if (from === null || to === null) return
    if (from > to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'Date range start must be before end' })
      return
    }
    const daysInclusive = Math.floor((to - from) / DAY_MS) + 1
    if (daysInclusive > 366) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Date range must not exceed 366 days' })
    }
  })

const insightMetricSchema = z.object({
  key: z.enum(['revenue', 'orders', 'aov', 'new_customers']),
  label: z.string(),
  value: z.number(),
  previousValue: z.number().nullable(),
  deltaPct: z.number().nullable(),
})

const insightsResponseSchema = z.object({
  metrics: z.array(insightMetricSchema),
  digest: z
    .object({
      bullets: z.array(z.string()).max(5),
      generatedAt: z.string(),
    })
    .nullable(),
  aiAvailable: z.boolean(),
  cached: z.boolean(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['dashboards.insights.view'] },
}

type RbacFeatureService = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string; organizationId?: string | null },
  ) => Promise<boolean>
}

function isoDateToUtcMs(value: string): number | null {
  if (!ISO_DATE_PATTERN.test(value)) return null
  const [yearPart, monthPart, dayPart] = value.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

function resolveOrganizationIds(scope: Awaited<ReturnType<typeof resolveOrganizationScopeForRequest>>, authOrgId?: string | null): string[] | undefined {
  if (scope?.selectedId) return [scope.selectedId]
  if (Array.isArray(scope?.filterIds) && scope.filterIds.length > 0) return scope.filterIds
  if (scope?.allowedIds === null) return undefined
  if (authOrgId) return [authOrgId]
  return undefined
}

function buildInsightsScope(tenantId: string, organizationIds: string[] | undefined): InsightsScope {
  return {
    tenantId,
    organizationIds,
    effectiveOrgScope: organizationIds && organizationIds.length > 0 ? [...new Set(organizationIds)].sort((a, b) => a.localeCompare(b)) : 'all',
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = insightsQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const tenantId = auth.tenantId ?? null
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant context is required' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const analyticsRegistry = container.resolve<AnalyticsRegistry>('analyticsRegistry')
  const rbacService = container.resolve<RbacFeatureService>('rbacService')
  const em = (container.resolve('em') as EntityManager).fork({
    clear: true,
    freshEventManager: true,
    useContext: true,
  })

  const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationIds = resolveOrganizationIds(orgScope, auth.orgId)
  const cache = container.resolve<CacheStrategy>('cache')
  const widgetDataService = createWidgetDataService(em, { tenantId, organizationIds }, analyticsRegistry, cache)

  try {
    const result = await computeInsights(
      {
        widgetDataService,
        analyticsRegistry,
        checkFeatures: (features) => {
          if (features.length === 0) return Promise.resolve(true)
          return rbacService.userHasAllFeatures(String(auth.sub ?? ''), features, {
            tenantId,
            organizationId: auth.orgId ?? null,
          })
        },
        cache,
      },
      buildInsightsScope(tenantId, organizationIds),
      parsed.data,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[dashboards/insights] Error:', err)
    if (err instanceof WidgetDataValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 },
    )
  }
}

const insightsGetDoc: OpenApiMethodDoc = {
  summary: 'Fetch deterministic dashboard KPI insights',
  description:
    'Returns KPI deltas for the active dashboard date range and, when an AI provider is configured, a validated narrative digest grounded only in those metrics.',
  tags: [dashboardsTag],
  query: insightsQuerySchema,
  responses: [
    {
      status: 200,
      description: 'Dashboard insights response.',
      schema: insightsResponseSchema,
    },
  ],
  errors: [
    { status: 400, description: 'Invalid query parameters', schema: dashboardsErrorSchema },
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 403, description: 'Missing dashboards.insights.view feature', schema: dashboardsErrorSchema },
    { status: 500, description: 'Internal server error', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Dashboard insights endpoint',
  methods: {
    GET: insightsGetDoc,
  },
}
