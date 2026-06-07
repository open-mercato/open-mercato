import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  createWidgetDataService,
  type WidgetDataRequest,
  WidgetDataValidationError,
} from '../../../../services/widgetDataService'
import { runWidgetDataBatch } from '../../../../lib/widgetDataBatch'
import type { AnalyticsRegistry } from '../../../../services/analyticsRegistry'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { dashboardsTag, dashboardsErrorSchema } from '../../../openapi'
import { widgetDataRequestSchema, widgetDataResponseSchema } from '../schema'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['analytics.view'] },
}

const MAX_BATCH_SIZE = 50

const widgetDataBatchRequestSchema = z.object({
  requests: z
    .array(
      z.object({
        id: z.string().min(1),
        request: widgetDataRequestSchema,
      }),
    )
    .min(1)
    .max(MAX_BATCH_SIZE),
})

const widgetDataBatchResponseSchema = z.object({
  results: z.array(
    z.discriminatedUnion('ok', [
      z.object({
        id: z.string(),
        ok: z.literal(true),
        data: widgetDataResponseSchema,
      }),
      z.object({
        id: z.string(),
        ok: z.literal(false),
        error: z.string(),
      }),
    ]),
  ),
})

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = widgetDataBatchRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request payload', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const tenantId = auth.tenantId ?? null
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant context is required' }, { status: 400 })
  }

  // Build the per-request DI/RBAC/org-scope stack exactly once for the whole
  // batch instead of once per widget (see issue #2273).
  const container = await createRequestContainer()
  const analyticsRegistry = container.resolve<AnalyticsRegistry>('analyticsRegistry')

  const em = (container.resolve('em') as EntityManager).fork({
    clear: true,
    freshEventManager: true,
    useContext: true,
  })

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })

  const organizationIds = (() => {
    if (scope?.selectedId) return [scope.selectedId]
    if (Array.isArray(scope?.filterIds) && scope.filterIds.length > 0) return scope.filterIds
    if (scope?.allowedIds === null) return undefined
    if (auth.orgId) return [auth.orgId]
    return undefined
  })()

  const cache = container.resolve<CacheStrategy>('cache')
  const service = createWidgetDataService(em, { tenantId, organizationIds }, analyticsRegistry, cache)

  const rbacService = container.resolve<{
    userHasAllFeatures: (
      userId: string,
      features: string[],
      scope: { tenantId: string; organizationId?: string | null },
    ) => Promise<boolean>
  }>('rbacService')

  try {
    const results = await runWidgetDataBatch(parsed.data.requests as Array<{ id: string; request: WidgetDataRequest }>, {
      getRequiredFeatures: (entityType) => analyticsRegistry.getRequiredFeatures(entityType),
      checkFeatures: (features) => {
        if (features.length === 0) return Promise.resolve(true)
        return rbacService.userHasAllFeatures(auth.sub, features, {
          tenantId,
          organizationId: auth.orgId,
        })
      },
      fetchOne: (request) => service.fetchWidgetData(request),
      describeError: (error) =>
        error instanceof WidgetDataValidationError
          ? error.message
          : 'An error occurred while processing your request',
    })
    return NextResponse.json({ results })
  } catch (err) {
    console.error('[widgets/data/batch] Error:', err)
    return NextResponse.json(
      { error: 'An error occurred while processing your request' },
      { status: 500 },
    )
  }
}

const widgetDataBatchPostDoc: OpenApiMethodDoc = {
  summary: 'Fetch aggregated data for multiple dashboard widgets in one request',
  description:
    'Resolves a batch of widget data requests with a single authentication, RBAC, organization-scope, and database-context setup. Each request is keyed by an opaque widget id and resolved independently, so a failure in one widget does not fail the batch.',
  tags: [dashboardsTag],
  requestBody: {
    contentType: 'application/json',
    schema: widgetDataBatchRequestSchema,
    description: 'A list of id-keyed widget data requests to resolve together.',
  },
  responses: [
    {
      status: 200,
      description: 'Per-widget aggregation results keyed by request id.',
      schema: widgetDataBatchResponseSchema,
    },
  ],
  errors: [
    { status: 400, description: 'Invalid request payload', schema: dashboardsErrorSchema },
    { status: 401, description: 'Authentication required', schema: dashboardsErrorSchema },
    { status: 500, description: 'Internal server error', schema: dashboardsErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: dashboardsTag,
  summary: 'Batch widget data aggregation endpoint',
  methods: {
    POST: widgetDataBatchPostDoc,
  },
}
