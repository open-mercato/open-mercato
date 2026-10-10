import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  xrayConformanceQuerySchema,
  xrayConformanceResponseSchema,
  xrayProcessPathParamsSchema,
} from '../../../../data/validators'
import { sequenceModel } from '../../../../lib/analytics/conformance'
import type { ConformanceResult } from '../../../../lib/analytics/types'
import { resolveXrayConformanceModels } from '../../../../lib/xrayConformanceModels'
import {
  analyticsInputOf,
  filtersOfQuery,
  parseXrayQuery,
  runXrayAnalyticsRoute,
  xrayAnalyticsErrorDocs,
  xrayAnalyticsJson,
  xrayActivityLabelsOf,
  xrayErrorResponse,
  type XrayAnalyticsRouteContext,
  type XrayRouteParams,
} from '../../../../lib/xrayAnalyticsRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

function sequenceOf(value: string | undefined): string[] | null {
  if (value === undefined) return null
  const keys = value.split(',').map((key) => key.trim()).filter((key) => key.length > 0)
  return keys.length > 0 ? keys : null
}

/** Labels of the activity keys a conformance result discloses (deviation endpoints and unmapped activities). */
async function conformanceJson(route: XrayAnalyticsRouteContext, result: ConformanceResult) {
  const keys = result.status === 'ok'
    ? [
      ...result.models.flatMap((model) => model.deviations.flatMap((deviation) => [deviation.from, deviation.to])),
      ...result.unmappedActivities.map((entry) => entry.activityKey),
    ]
    : []
  const activityLabels = await xrayActivityLabelsOf(route, keys.filter((key): key is string => typeof key === 'string'))
  return xrayAnalyticsJson({ ...result, activityLabels })
}

export async function GET(req: Request, context: XrayRouteParams) {
  return runXrayAnalyticsRoute(req, context, 'xray.conformance', async (route) => {
    const query = parseXrayQuery(req, xrayConformanceQuerySchema)
    const filters = query ? filtersOfQuery(query) : null
    if (!query || !filters) return xrayErrorResponse(route.translate, 'invalid_request', 400)
    const input = analyticsInputOf(route, query, filters)
    const sequence = sequenceOf(query.sequence)
    if (sequence) {
      return conformanceJson(route, await route.analytics.getConformance({ ...input, models: [sequenceModel(sequence)] }))
    }
    const resolved = await resolveXrayConformanceModels(route.container, route.access)
    if (!resolved.ok) return xrayErrorResponse(route.translate, resolved.code, 422)
    return conformanceJson(route, await route.analytics.getConformance({
      ...input,
      models: resolved.models,
      organizationModelKeys: resolved.organizationModelKeys,
    }))
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray conformance',
  pathParams: xrayProcessPathParamsSchema,
  methods: {
    GET: {
      summary: 'Compare completed cases with the designed process',
      description: 'Compares the cases completed in the window with a designed model: the ad-hoc `sequence` of activity keys, or each organization\'s configured conformance workflow (`conformanceWorkflowId` read through the workflows module, scoped to the tenant and the organization, projected onto the organization\'s `activityStepMap`; cases of organizations without one are counted as unresolved). Below 60 % mapped steps the comparison is refused (`status: refused`, `insufficient_coverage`). Fitness, conforming cases and transition counts are withheld unless both the conforming and the deviating cases pass the k / three-actor rule; deviations and unmapped activities are suppressed cells like any other.',
      query: xrayConformanceQuerySchema,
      responses: [{ status: 200, description: 'Conformance (or a refusal with its reason)', schema: xrayConformanceResponseSchema }],
      errors: xrayAnalyticsErrorDocs({
        unprocessable: 'Also: no designed model (`conformance_model_missing`), the workflows module is unavailable (`workflows_unavailable`) or more than 20 organization models in scope (`too_many_models`).',
      }),
    },
  },
}
