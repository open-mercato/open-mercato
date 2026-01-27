import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  createWidgetDataService,
  type WidgetDataRequest,
  WidgetDataValidationError,
} from '../../../services/widgetDataService'
import type { AnalyticsRegistry } from '../../../services/analyticsRegistry'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { dashboardsTag, dashboardsErrorSchema } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['analytics.view'] },
}

const aggregateFunctionSchema = z.enum(['count', 'sum', 'avg', 'min', 'max'])
const dateGranularitySchema = z.enum(['day', 'week', 'month', 'quarter', 'year'])
const dateRangePresetSchema = z.enum([
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'last_7_days',
  'last_30_days',
  'last_90_days',
])

const filterOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
])

const widgetDataRequestSchema = z.object({
  entityType: z.string().min(1),
  metric: z.object({
    field: z.string().min(1),
    aggregate: aggregateFunctionSchema,
  }),
  groupBy: z
    .object({
      field: z.string().min(1),
      granularity: dateGranularitySchema.optional(),
      limit: z.number().int().min(1).max(100).optional(),
      resolveLabels: z.boolean().optional(),
    })
    .optional(),
  filters: z
    .array(
      z.object({
        field: z.string().min(1),
        operator: filterOperatorSchema,
        value: z.unknown().optional(),
      }),
    )
    .optional(),
  dateRange: z
    .object({
      field: z.string().min(1),
      preset: dateRangePresetSchema,
    })
    .optional(),
  comparison: z
    .object({
      type: z.enum(['previous_period', 'previous_year']),
    })
    .optional(),
})

const widgetDataItemSchema = z.object({
  groupKey: z.unknown(),
  groupLabel: z.string().optional(),
  value: z.number().nullable(),
})

const widgetDataResponseSchema = z.object({
  value: z.number().nullable(),
  data: z.array(widgetDataItemSchema),
  comparison: z
    .object({
      value: z.number().nullable(),
      change: z.number(),
      direction: z.enum(['up', 'down', 'unchanged']),
    })
    .optional(),
  metadata: z.object({
    fetchedAt: z.string(),
    recordCount: z.number(),
  }),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = widgetDataRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const analyticsRegistry = container.resolve<AnalyticsRegistry>('analyticsRegistry')

  const entityFeatures = analyticsRegistry.getRequiredFeatures(parsed.data.entityType)
  if (entityFeatures && entityFeatures.length > 0) {
    const rbacService = container.resolve<{
      userHasAllFeatures: (
        userId: string,
        features: string[],
        scope: { tenantId: string; organizationId?: string | null },
      ) => Promise<boolean>
    }>('rbacService')
    const hasAccess = await rbacService.userHasAllFeatures(auth.sub, entityFeatures, {
      tenantId: auth.tenantId!,
      organizationId: auth.orgId,
    })
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const em = (container.resolve('em') as EntityManager).fork({
    clear: true,
    freshEventManager: true,
    useContext: true,
  })

  const tenantId = auth.tenantId ?? null
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant context is required' }, { status: 400 })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })

  const organizationIds = (() => {
    if (scope?.selectedId) return [scope.selectedId]
    if (Array.isArray(scope?.filterIds) && scope.filterIds.length > 0) return scope.filterIds
    if (scope?.allowedIds === null) return undefined
    if (auth.orgId) return [auth.orgId]
    return undefined
  })()

  try {
    const cache = container.resolve<CacheStrategy>('cache')
    const service = createWidgetDataService(em, { tenantId, organizationIds }, analyticsRegistry, cache)
    const result = await service.fetchWidgetData(parsed.data as WidgetDataRequest)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[widgets/data] Error:', err)
    if (err instanceof WidgetDataValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 },
    )
  }
}

const widgetDataPostDoc: OpenApiMethodDoc = {
  summary: 'Fetch aggregated data for dashboard widgets',
  description:
    'Executes an aggregation query against the specified entity type and returns the result. Supports date range filtering, grouping, and period-over-period comparison.',
  tags: [dashboardsTag],
  requestBody: {
    contentType: 'application/json',
    schema: widgetDataRequestSchema,
    description: 'Widget data request configuration specifying entity type, metric, filters, and grouping.',
  },
  responses: [
    {
      status: 200,
      description: 'Aggregated data for the widget.',
      schema: widgetDataResponseSchema,
    },
  ],
  errors: [
    { status: 400, description: 'Invalid request payload', schema: dashboardsErrorSchema },
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 403, description: 'Missing analytics.view feature', schema: dashboardsErrorSchema },
    { status: 500, description: 'Internal server error', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Widget data aggregation endpoint',
  methods: {
    POST: widgetDataPostDoc,
  },
}
