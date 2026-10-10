import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { xrayMapResponseSchema, xrayAnalyticsQuerySchema, xrayProcessPathParamsSchema } from '../../../../data/validators'
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
  return runXrayAnalyticsRoute(req, context, 'xray.map', async (route) => {
    const query = parseXrayQuery(req, xrayAnalyticsQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    if (!query || !filters) return xrayErrorResponse(route.translate, 'invalid_request', 400)
    return xrayAnalyticsJson(await route.analytics.getProcessMap(analyticsInputOf(route, query, filters)))
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray process map',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'Get the process map',
      description: 'Directly-follows graph of the process in the window: nodes (activities) and edges (transitions) with raw and collapsed counts, cases and cause split (human, automated, legacy). Debounce and corrections collapse at query time. Cells below k cases or three distinct actors are suppressed, with complementary suppression; totals are sums over visible cells. Served from precomputed rollups for default windows of one completely projected organization. Organization scope: the selected organization, or every organization the caller may read for `insights.xray.view` and the process\'s required features (tenant-wide only for unrestricted callers); organizations whose X-Ray settings are disabled are excluded. Results carry `n`, `lowConfidence`, `computedThrough`, `incomplete` and suppression markers.',
      query: xrayAnalyticsQuerySchema,
      responses: [{ status: 200, description: 'Process X-Ray process map', schema: xrayMapResponseSchema }],
      errors: xrayAnalyticsErrorDocs(),
    },
  },
}
