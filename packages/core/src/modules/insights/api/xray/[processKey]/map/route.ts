import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { xrayMapResponseSchema, xrayAnalyticsQuerySchema, xrayProcessPathParamsSchema } from '../../../../data/validators'
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
import { XRAY_MAP_END, XRAY_MAP_START } from '../../../../lib/analytics/types'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

export async function GET(req: Request, context: XrayRouteParams) {
  return runXrayAnalyticsRoute(req, context, 'xray.map', async (route) => {
    const query = parseXrayQuery(req, xrayAnalyticsQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    if (!query || !filters) return xrayErrorResponse(route.translate, 'invalid_request', 400)
    const result = await route.analytics.getProcessMap(analyticsInputOf(route, query, filters))
    const activityLabels = await xrayActivityLabelsOf(route, [XRAY_MAP_START, XRAY_MAP_END, ...result.nodes.map((node) => node.activityKey)])
    return xrayAnalyticsJson({ ...result, activityLabels })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray process map',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'Get the process map',
      description: 'Directly-follows graph of the process in the window: nodes (activities) and edges (transitions) with raw and collapsed counts, cases and cause split (human, automated, legacy). Debounce and corrections collapse at query time. Cells below k cases or three distinct actors are suppressed, with complementary suppression; totals are sums over visible cells. `activityLabels` holds human-readable labels of the visible nodes (and the start / end markers) only: an edge endpoint without a node is a suppressed step and stays unlabelled. Served from precomputed rollups for default windows of one completely projected organization. Organization scope: the selected organization, or every organization the caller may read for `insights.xray.view` and the process\'s required features (tenant-wide only for unrestricted callers); organizations whose X-Ray settings are disabled are excluded. Results carry `n`, `lowConfidence`, `computedThrough`, `incomplete` and suppression markers.',
      query: xrayAnalyticsQuerySchema,
      responses: [{ status: 200, description: 'Process X-Ray process map', schema: xrayMapResponseSchema }],
      errors: xrayAnalyticsErrorDocs(),
    },
  },
}
