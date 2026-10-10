import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { xrayBottlenecksResponseSchema, xrayAnalyticsQuerySchema, xrayProcessPathParamsSchema } from '../../../../data/validators'
import {
  analyticsInputOf,
  filtersOfQuery,
  parseXrayQuery,
  runXrayAnalyticsRoute,
  xrayAnalyticsErrorDocs,
  xrayAnalyticsJson,
  xrayActivityLabelsOf,
  xrayErrorResponse,
  type XrayRouteParams,
} from '../../../../lib/xrayAnalyticsRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

export async function GET(req: Request, context: XrayRouteParams) {
  return runXrayAnalyticsRoute(req, context, 'xray.bottlenecks', async (route) => {
    const query = parseXrayQuery(req, xrayAnalyticsQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    if (!query || !filters) return xrayErrorResponse(route.translate, 'invalid_request', 400)
    const result = await route.analytics.getBottlenecks(analyticsInputOf(route, query, filters))
    const activityLabels = await xrayActivityLabelsOf(route, result.items.flatMap((item) => [item.from, item.to]))
    return xrayAnalyticsJson({ ...result, activityLabels })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray bottlenecks',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'Get the bottlenecks',
      description: 'Transitions ranked by their waiting time (median, p90 with the n guards; `sync_run` steps excluded unless `includeSyncRun`). Cells below the k / three-actor thresholds are suppressed. Organization scope: the selected organization, or every organization the caller may read for `insights.xray.view` and the process\'s required features (tenant-wide only for unrestricted callers); organizations whose X-Ray settings are disabled are excluded. Results carry `n`, `lowConfidence`, `computedThrough`, `incomplete` and suppression markers.',
      query: xrayAnalyticsQuerySchema,
      responses: [{ status: 200, description: 'Process X-Ray bottlenecks', schema: xrayBottlenecksResponseSchema }],
      errors: xrayAnalyticsErrorDocs(),
    },
  },
}
