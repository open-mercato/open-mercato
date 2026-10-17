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
  withXrayIndividualsAccess,
  xrayAnalyticsErrorDocs,
  xrayAnalyticsJson,
  xrayErrorResponse,
  type XrayRouteParams,
} from '../../../../lib/xrayAnalyticsRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

/**
 * Breakdown of one process by organization, role, team or person. A per-person breakdown
 * (`groupBy=user`) reads only the organizations of the caller's scope where they hold
 * `insights.xray.view_individuals` together with the view features: a scope without a selected
 * organization is narrowed to them, never widened (`withXrayIndividualsAccess`); 403
 * `individuals_denied` when none remains or the feature-check organization (the selected one,
 * else the caller's own) lacks it. The analytics facade then applies the per-organization
 * `individualsEnabled` gate, the access log and k-anonymity to that narrowed scope.
 */
export async function GET(req: Request, context: XrayRouteParams) {
  return runXrayAnalyticsRoute(req, context, 'xray.breakdown', async (route) => {
    const query = parseXrayQuery(req, xrayBreakdownQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    if (!query || !filters) return xrayErrorResponse(route.translate, 'invalid_request', 400)
    const groupBy = query.groupBy ?? 'org'
    const scoped = groupBy === 'user' ? await withXrayIndividualsAccess(req, route) : route
    return xrayAnalyticsJson(await route.analytics.getBreakdown({
      ...analyticsInputOf(scoped, query, filters),
      groupBy,
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
      description: 'Activity counts, cases, actors, cause split and step waits per group. `groupBy=org` (default) is the guard against Simpson\'s paradox; `role` and `team` aggregate actor dimensions. `groupBy=user` is a per-person view: it requires `insights.xray.view_individuals` (wildcard-aware) at the feature-check organization (the selected one, else the caller\'s own) and reads only the organizations of the caller\'s scope where they hold it together with the view features. A scope without a selected organization is narrowed to those organizations, never widened (`organizationIds` in the response lists the organizations read); when none remains, or the selected organization lacks the feature, the answer is 403 `individuals_denied`. Every organization read must have the setting `individualsEnabled` on; an `access_logs` row is written per organization before any data is read or served (fails closed), and persons below k cases are still suppressed. Groups below the k / three-actor thresholds are suppressed with complementary suppression.',
      query: xrayBreakdownQuerySchema,
      responses: [{ status: 200, description: 'Breakdown', schema: xrayBreakdownResponseSchema }],
      errors: xrayAnalyticsErrorDocs({
        forbidden: 'Also a per-person breakdown that is not allowed (`individuals_denied`): `insights.xray.view_individuals` missing at the selected (or own) organization or in every organization of the scope, the organization setting is off, unknown viewer, or the access log could not be written.',
      }),
    },
  },
}
