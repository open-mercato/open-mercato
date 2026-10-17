import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  XRAY_ANALYTICS_PAGE_SIZE_DEFAULT,
  XRAY_CASE_STATUS_VALUES,
  xrayCasesQuerySchema,
  xrayCasesResponseSchema,
  xrayProcessPathParamsSchema,
} from '../../../../data/validators'
import { XRAY_ANALYTICS_LIMITS } from '../../../../lib/analytics/types'
import {
  analyticsInputOf,
  filtersOfQuery,
  parseXrayQuery,
  runXrayAnalyticsRoute,
  splitCsv,
  xrayAnalyticsErrorDocs,
  xrayActivityLabelsOf,
  xrayAnalyticsJson,
  xrayErrorResponse,
  type XrayRouteParams,
} from '../../../../lib/xrayAnalyticsRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

type CaseStatus = (typeof XRAY_CASE_STATUS_VALUES)[number]

const VARIANT_HASH_PATTERN = /^[0-9a-f]{64}$/

function isCaseStatus(value: string): value is CaseStatus {
  return (XRAY_CASE_STATUS_VALUES as readonly string[]).includes(value)
}

export async function GET(req: Request, context: XrayRouteParams) {
  return runXrayAnalyticsRoute(req, context, 'xray.cases', async (route) => {
    const query = parseXrayQuery(req, xrayCasesQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    const statuses = query ? splitCsv(query.status) : undefined
    const variantHashes = query ? splitCsv(query.variantHashes) : undefined
    const validHashes = !variantHashes || (variantHashes.length <= XRAY_ANALYTICS_LIMITS.maxRawVariantHashes && variantHashes.every((hash) => VARIANT_HASH_PATTERN.test(hash)))
    if (!query || !filters || (statuses && !statuses.every(isCaseStatus)) || !validHashes) {
      return xrayErrorResponse(route.translate, 'invalid_request', 400)
    }
    const result = await route.analytics.listCases({
      ...analyticsInputOf(route, query, filters),
      pageSize: query.pageSize ?? XRAY_ANALYTICS_PAGE_SIZE_DEFAULT,
      cursor: query.cursor ?? null,
      ...(statuses ? { statuses: statuses.filter(isCaseStatus) } : {}),
      ...(query.variantHash ? { variantHash: query.variantHash } : {}),
      ...(variantHashes ? { variantHashes } : {}),
      ...(query.activityKey ? { activityKey: query.activityKey } : {}),
    })
    const activityLabels = query.activityKey && !result.suppressed ? await xrayActivityLabelsOf(route, [query.activityKey]) : {}
    return xrayAnalyticsJson({ ...result, activityLabels })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray cases',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'List the case ids of the analytics population',
      description: 'Identifiers only (case id and organization id; the caller opens the records through their own module, which applies its own access rules): the cases with a non-voided event in the window, newest activity first, keyset-paginated (`nextCursor`). Optional drill-downs: stored variant hashes (`variantHash` and / or `variantHashes`; cases completed in the window), an activity key, statuses and the event filters (actor filters must pass the k / three-actor rule). A drill-down by activity key or variant hash lists only a cell the map / variants of the same window, filters and viewer show (k cases and three distinct actors, complementary suppression); a hidden or unknown cell answers an empty page with `suppressed: true` and `n: 0`, so its size is never disclosed. `pageSize` is at most 100. `n` is the total of the population. `activityLabels` labels the drilled activity (never a suppressed one).',
      query: xrayCasesQuerySchema,
      responses: [{ status: 200, description: 'Case ids', schema: xrayCasesResponseSchema }],
      errors: xrayAnalyticsErrorDocs(),
    },
  },
}
