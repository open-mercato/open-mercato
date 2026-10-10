import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  xrayBreakdownQuerySchema,
  xrayBreakdownResponseSchema,
  xrayProcessPathParamsSchema,
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
  return runXrayAnalyticsRoute(req, context, 'xray.breakdown', async (route) => {
    const query = parseXrayQuery(req, xrayBreakdownQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    if (!query || !filters) return xrayErrorResponse(route.translate, 'invalid_request', 400)
    return xrayAnalyticsJson(await route.analytics.getBreakdown({
      ...analyticsInputOf(route, query, filters),
      groupBy: query.groupBy ?? 'org',
    }))
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray breakdown',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'Get a breakdown by organization, role, team or person',
      description: 'Activity counts, cases, actors, cause split and step waits per group. `groupBy=org` (default) is the guard against Simpson\'s paradox; `role` and `team` aggregate actor dimensions. `groupBy=user` is a per-person view: it requires `insights.xray.view_individuals` (wildcard-aware) AND the setting `individualsEnabled` of every organization in scope, writes an `access_logs` row per organization before any data is read or served (fails closed), and still suppresses persons below k cases. Groups below the k / three-actor thresholds are suppressed with complementary suppression.',
      query: xrayBreakdownQuerySchema,
      responses: [{ status: 200, description: 'Breakdown', schema: xrayBreakdownResponseSchema }],
      errors: xrayAnalyticsErrorDocs({
        forbidden: 'Also a per-person breakdown that is not allowed (`individuals_denied`): missing `insights.xray.view_individuals`, the organization setting is off, unknown viewer, or the access log could not be written.',
      }),
    },
  },
}
