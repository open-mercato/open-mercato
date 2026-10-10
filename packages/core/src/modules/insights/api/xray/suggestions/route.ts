import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  XRAY_SUGGESTIONS_PAGE_SIZE_DEFAULT,
  xrayAnalyticsErrorSchema,
  xraySuggestionsQuerySchema,
  xraySuggestionsResponseSchema,
} from '../../../data/validators'
import { getProcessRegistry } from '../../../lib/process/registry'
import { createXrayDatabase } from '../../../lib/projection/runtime'
import { listSuggestions, type SuggestionVisibility } from '../../../lib/suggestions/store'
import { scopeRequestView } from '../../../lib/routeHelpers'
import { resolveXrayAnalyticsAccess, xrayProcessFeatures } from '../../../lib/xrayAnalyticsAccess'
import { parseXrayQuery, xrayAnalyticsFailure, xrayAnalyticsJson, xrayErrorResponse } from '../../../lib/xrayAnalyticsRoutes'
import { toSuggestionView } from '../../../lib/xraySuggestionRoutes'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['insights.xray.view'] },
}

/**
 * Lists the automation suggestions the caller may see: per registered process (optionally one),
 * the organizations where the caller holds `insights.xray.view` and the process's
 * `requiredFeatures` (resolved like the analytics routes); organizations whose settings disable
 * X-Ray are never listed. An unknown or invisible process lists nothing. No actor data exists in
 * a suggestion. Best first (confidence, support), `pageSize` ≤ 100.
 */
export async function GET(req: Request) {
  let translate: TranslateFn | null = null
  try {
    translate = (await resolveTranslations()).t
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.sub) return xrayErrorResponse(translate, 'unauthorized', 401)
    const query = parseXrayQuery(req, xraySuggestionsQuerySchema)
    if (!query) return xrayErrorResponse(translate, 'invalid_request', 400)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? XRAY_SUGGESTIONS_PAGE_SIZE_DEFAULT
    const registry = getProcessRegistry()
    const processes = registry.ready
      ? registry.processes.filter((process) => query.processKey === undefined || process.processKey === query.processKey)
      : []
    const container = (await createRequestContainer()) as AwilixContainer
    const visibility: SuggestionVisibility[] = []
    let tenantId: string | null = null
    for (const process of processes) {
      const access = await resolveXrayAnalyticsAccess({ container, auth, request: scopeRequestView(req), requiredFeatures: xrayProcessFeatures(process) })
      if (!access) return xrayErrorResponse(translate, 'tenant_required', 403)
      tenantId = access.tenantId
      if (access.visible) visibility.push({ processKey: process.processKey, organizationIds: access.organizationIds })
    }
    const empty = { items: [], total: 0, page, pageSize, totalPages: 0 }
    if (!tenantId || visibility.length === 0) return xrayAnalyticsJson(empty)
    const em = (container.resolve('em') as EntityManager).fork()
    const result = await listSuggestions(createXrayDatabase(em), { tenantId, visibility, status: query.status, page, pageSize })
    const labels = new Map(processes.map((process) => [process.processKey, process]))
    return xrayAnalyticsJson({
      items: result.items.map((item) => toSuggestionView(item, labels.get(item.processKey) ?? null)),
      total: result.total,
      page,
      pageSize,
      totalPages: Math.ceil(result.total / pageSize),
    })
  } catch (error) {
    return xrayAnalyticsFailure(error, translate, 'xray.suggestions.list')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Insights',
  summary: 'Process X-Ray automation suggestions',
  methods: {
    GET: {
      summary: 'List automation suggestions',
      description: 'Mined automation suggestions ("after trigger A, optionally under one condition, users manually set field B to value V within W") of the processes and organizations the caller may see (`insights.xray.view` plus each process\'s declared features, resolved per organization like the analytics routes). Thresholds over the last 30 days: support ≥ 20 (per-organization `suggestionMinSupport`, minimum 5), Wilson lower bound of the confidence ≥ 0.6, lift ≥ 2, ≥ 2 distinct actors, ≥ k supporting cases; only manual (`cause_kind = user`) changes count, corrections and debounced intermediate values are collapsed first. No actor identity is stored or returned. Suggestions are recomputed daily by a background job (or on demand through `POST …/suggestions/mine`).',
      query: xraySuggestionsQuerySchema,
      responses: [{ status: 200, description: 'A page of suggestions', schema: xraySuggestionsResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query (`invalid_request`)', schema: xrayAnalyticsErrorSchema },
        { status: 401, description: 'Authentication required', schema: xrayAnalyticsErrorSchema },
        { status: 403, description: 'Missing `insights.xray.view` or no resolved tenant (`tenant_required`)', schema: xrayAnalyticsErrorSchema },
      ],
    },
  },
}
