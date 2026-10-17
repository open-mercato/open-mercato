import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { xrayAnalyticsQuerySchema, xrayDurationsResponseSchema, xrayProcessPathParamsSchema } from '../../../../data/validators'
import {
  analyticsInputOf,
  filtersOfQuery,
  parseXrayQuery,
  runXrayAnalyticsRoute,
  xrayAnalyticsErrorDocs,
  xrayAnalyticsJson,
  xrayErrorResponse,
  type XrayRouteParams,
} from '../../../../lib/xrayAnalyticsRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

export async function GET(req: Request, context: XrayRouteParams) {
  return runXrayAnalyticsRoute(req, context, 'xray.durations', async (route) => {
    const query = parseXrayQuery(req, xrayAnalyticsQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    if (!query || !filters) return xrayErrorResponse(route.translate, 'invalid_request', 400)
    return xrayAnalyticsJson(await route.analytics.getDurations(analyticsInputOf(route, query, filters)))
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray cycle times',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'Get the cycle times',
      description: 'Cycle times of the cases completed in the window (median with n ≥ 5, p90 with n ≥ 20, low confidence below 30; `sync_run` steps excluded unless `includeSyncRun`) and the ages of the cases still open at the window end, reported separately as right-censored with an age histogram, overall and per organization. Empty cells are an explicit `empty: true` marker; cells below the k / three-actor thresholds are suppressed (`null`), with complementary suppression. Served from precomputed rollups for default windows of one completely projected organization. Organization scope: the selected organization, or every organization the caller may read for `insights.xray.view` and the process\'s required features (tenant-wide only for unrestricted callers); organizations whose X-Ray settings are disabled are excluded. Results carry `n`, `lowConfidence`, `computedThrough`, `incomplete` and suppression markers.',
      query: xrayAnalyticsQuerySchema,
      responses: [{ status: 200, description: 'Process X-Ray cycle times', schema: xrayDurationsResponseSchema }],
      errors: xrayAnalyticsErrorDocs(),
    },
  },
}
