import type { AwilixContainer } from 'awilix'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { xrayProcessesQuerySchema, xrayProcessesResponseSchema } from '../../../data/validators'
import { createXrayAnalyticsFromContainer, type ProcessSummaryResult } from '../../../lib/analytics/index'
import { compareCodeUnits, getProcessRegistry } from '../../../lib/process/registry'
import { scopeRequestView } from '../../../lib/routeHelpers'
import { resolveXrayAnalyticsAccess, xrayProcessFeatures, type XrayAnalyticsAccess } from '../../../lib/xrayAnalyticsAccess'
import {
  parseXrayQuery,
  windowOfQuery,
  xrayAnalyticsErrorDocs,
  xrayAnalyticsFailure,
  xrayAnalyticsJson,
  xrayErrorResponse,
} from '../../../lib/xrayAnalyticsRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

export async function GET(req: Request) {
  const { t: translate } = await resolveTranslations()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.sub) return xrayErrorResponse(translate, 'unauthorized', 401)
    const query = parseXrayQuery(req, xrayProcessesQuerySchema)
    if (!query) return xrayErrorResponse(translate, 'invalid_request', 400)
    const container = (await createRequestContainer()) as AwilixContainer
    const registry = getProcessRegistry()
    const processes = registry.ready ? registry.processes : []
    const accessByFeatures = new Map<string, Promise<XrayAnalyticsAccess | null>>()
    const accessFor = (features: string[]): Promise<XrayAnalyticsAccess | null> => {
      const key = features.join('\u0000')
      const cached = accessByFeatures.get(key)
      if (cached) return cached
      const pending = resolveXrayAnalyticsAccess({ container, auth, request: scopeRequestView(req), requiredFeatures: features })
      accessByFeatures.set(key, pending)
      return pending
    }
    const analytics = createXrayAnalyticsFromContainer(container)
    const items: Array<ProcessSummaryResult & { labelKey: string; moduleId: string; resourceKind: string }> = []
    let tenantResolved = processes.length === 0
    for (const process of processes) {
      const access = await accessFor(xrayProcessFeatures(process))
      if (access) tenantResolved = true
      if (!access || !access.visible) continue
      const summary = await analytics.getSummary({
        scope: { tenantId: access.tenantId, organizationIds: access.organizationIds },
        processKey: process.processKey,
        window: windowOfQuery(query),
        ...(query.timeZone ? { timeZone: query.timeZone } : {}),
        viewer: access.viewer,
      })
      items.push({ ...summary, labelKey: process.labelKey, moduleId: process.moduleId, resourceKind: process.resourceKind })
    }
    if (!tenantResolved) return xrayErrorResponse(translate, 'tenant_required', 403)
    const incomplete = items.some((item) => item.incomplete)
    const positions = items.map((item) => item.computedThrough).filter((value): value is string => value !== null).sort(compareCodeUnits)
    return xrayAnalyticsJson({
      items,
      n: items.reduce((total, item) => total + item.n, 0),
      computedThrough: incomplete || positions.length === 0 ? null : positions[0],
      incomplete,
    })
  } catch (error) {
    return xrayAnalyticsFailure(error, translate, 'xray.processes')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray processes',
  methods: {
    GET: {
      summary: 'List the Process X-Ray processes the caller may analyse',
      description: 'Registered processes for which the caller holds `insights.xray.view` and the process\'s declared `requiredFeatures` (wildcard-aware RBAC, organization scope resolved for those features: the selected organization, or the organizations where the caller holds them, tenant-wide only for unrestricted callers; organizations whose X-Ray settings are disabled are excluded). Each item carries headline counts for the window: `n` (cases with activity, always returned) and `openCases` (withheld below k), plus `computedThrough` and `incomplete`.',
      query: xrayProcessesQuerySchema,
      responses: [{ status: 200, description: 'Visible processes with headline counts', schema: xrayProcessesResponseSchema }],
      errors: xrayAnalyticsErrorDocs().filter((doc) => doc.status !== 404),
    },
  },
}
