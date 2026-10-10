import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  XRAY_VARIANTS_LIMIT_DEFAULT,
  xrayProcessPathParamsSchema,
  xrayVariantsQuerySchema,
  xrayVariantsResponseSchema,
} from '../../../../data/validators'
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
  return runXrayAnalyticsRoute(req, context, 'xray.variants', async (route) => {
    const query = parseXrayQuery(req, xrayVariantsQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    if (!query || !filters) return xrayErrorResponse(route.translate, 'invalid_request', 400)
    return xrayAnalyticsJson(await route.analytics.getVariants({
      ...analyticsInputOf(route, query, filters),
      limit: query.limit ?? XRAY_VARIANTS_LIMIT_DEFAULT,
    }))
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray variants',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'Get the variants',
      description: 'Collapsed activity sequences of the cases completed in the window (complete traces only), most frequent first, with share and cycle time (n guards). Each item lists the stored variant hashes of its cases for the case drill-down (`/cases?variantHash=`). Variants below k cases or three distinct actors are suppressed, with complementary suppression. Organization scope as for every X-Ray analytics route (disabled organizations excluded). Results carry `n`, `lowConfidence`, `computedThrough` and `incomplete`.',
      query: xrayVariantsQuerySchema,
      responses: [{ status: 200, description: 'Variants', schema: xrayVariantsResponseSchema }],
      errors: xrayAnalyticsErrorDocs(),
    },
  },
}
