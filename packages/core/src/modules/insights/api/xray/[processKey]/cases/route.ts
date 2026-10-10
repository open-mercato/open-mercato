import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  XRAY_ANALYTICS_PAGE_SIZE_DEFAULT,
  XRAY_CASE_STATUS_VALUES,
  xrayCasesQuerySchema,
  xrayCasesResponseSchema,
  xrayProcessPathParamsSchema,
} from '../../../../data/validators'
import {
  analyticsInputOf,
  filtersOfQuery,
  parseXrayQuery,
  runXrayAnalyticsRoute,
  splitCsv,
  xrayAnalyticsErrorDocs,
  xrayAnalyticsJson,
  xrayErrorResponse,
  type XrayRouteParams,
} from '../../../../lib/xrayAnalyticsRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

type CaseStatus = (typeof XRAY_CASE_STATUS_VALUES)[number]

function isCaseStatus(value: string): value is CaseStatus {
  return (XRAY_CASE_STATUS_VALUES as readonly string[]).includes(value)
}

export async function GET(req: Request, context: XrayRouteParams) {
  return runXrayAnalyticsRoute(req, context, 'xray.cases', async (route) => {
    const query = parseXrayQuery(req, xrayCasesQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    const statuses = query ? splitCsv(query.status) : undefined
    if (!query || !filters || (statuses && !statuses.every(isCaseStatus))) {
      return xrayErrorResponse(route.translate, 'invalid_request', 400)
    }
    return xrayAnalyticsJson(await route.analytics.listCases({
      ...analyticsInputOf(route, query, filters),
      pageSize: query.pageSize ?? XRAY_ANALYTICS_PAGE_SIZE_DEFAULT,
      cursor: query.cursor ?? null,
      ...(statuses ? { statuses: statuses.filter(isCaseStatus) } : {}),
      ...(query.variantHash ? { variantHash: query.variantHash } : {}),
      ...(query.activityKey ? { activityKey: query.activityKey } : {}),
    }))
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray cases',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'List the case ids of the analytics population',
      description: 'Identifiers only (case id and organization id; the caller opens the records through their own module, which applies its own access rules): the cases with a non-voided event in the window, newest activity first, keyset-paginated (`nextCursor`). Optional drill-downs: a stored variant hash (cases completed in the window), an activity key, statuses and the event filters (actor filters must pass the k / three-actor rule). `pageSize` is at most 100. `n` is the total of the population.',
      query: xrayCasesQuerySchema,
      responses: [{ status: 200, description: 'Case ids', schema: xrayCasesResponseSchema }],
      errors: xrayAnalyticsErrorDocs(),
    },
  },
}
