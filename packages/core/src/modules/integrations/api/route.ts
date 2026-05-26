import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../lib/credentials-service'
import type { IntegrationStateService } from '../lib/state-service'
import type { IntegrationLogService } from '../lib/log-service'
import { deriveIntegrationHealthStatus, getEffectiveHealthCheckConfig } from '../lib/health-service'
import type { IntegrationHealthDisplayStatus } from '../lib/health-service'
import { getAllBundles, getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import { listIntegrationsQuerySchema } from '../data/validators'
import { buildIntegrationsCrudOpenApi, integrationsListResponseSchema } from './openapi'
import {
  finalizeIntegrationsReadResponse,
  integrationApiRoutePaths,
  runIntegrationsReadBeforeInterceptors,
} from './umes-read'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.view'] },
}

export const openApi = buildIntegrationsCrudOpenApi({
  resourceName: 'Integration',
  pluralName: 'Integrations',
  listResponseSchema: integrationsListResponseSchema,
  querySchema: listIntegrationsQuerySchema,
})

const HEALTH_SORT_RANK: Record<IntegrationHealthDisplayStatus, number> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
  unconfigured: 3,
}

function matchesSearchQuery(
  integration: { title: string; description?: string; tags?: string[] },
  queryNormalized: string,
): boolean {
  if (!queryNormalized) return true
  if (integration.title.toLowerCase().includes(queryNormalized)) return true
  if (integration.description?.toLowerCase().includes(queryNormalized)) return true
  const tags = integration.tags ?? []
  return tags.some((tag) => tag.toLowerCase().includes(queryNormalized))
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsedQuery = listIntegrationsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsedQuery.error.flatten() }, { status: 400 })
  }
  const query = parsedQuery.data

  const container = await createRequestContainer()
  const beforeInterceptors = await runIntegrationsReadBeforeInterceptors({
    routePath: integrationApiRoutePaths.list,
    request: req,
    auth,
    container,
  })
  if (!beforeInterceptors.ok) {
    return NextResponse.json(beforeInterceptors.body, { status: beforeInterceptors.statusCode })
  }
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const stateService = container.resolve('integrationStateService') as IntegrationStateService
  const logService = container.resolve('integrationLogService') as IntegrationLogService

  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId as string }
  const searchNeedle = query.q?.trim().toLowerCase() ?? ''

  type ListRow = {
    id: string
    title: string
    description: string | null
    category: string | null
    tags: string[]
    hub: string | null
    providerKey: string | null
    bundleId: string | null
    author: string | null
    company: string | null
    version: string | null
    hasCredentials: boolean
    isEnabled: boolean
    apiVersion: string | null
    healthStatus: IntegrationHealthDisplayStatus
    lastHealthCheckedAt: string | null
    lastHealthLatencyMs: number | null
    enabledAt: string | null
    sortEnabledAtMs: number
    sortTitle: string
    sortCategory: string
  }

  const baseRows: ListRow[] = await Promise.all(
    getAllIntegrations().map(async (integration) => {
      const [resolvedCredentials, state] = await Promise.all([
        credentialsService.resolve(integration.id, scope),
        stateService.resolveState(integration.id, scope),
      ])

      const hasCredentials =
        resolvedCredentials != null && Object.keys(resolvedCredentials).length > 0
      const healthConfig = getEffectiveHealthCheckConfig(integration.id)
      const hasHealthCheck = Boolean(healthConfig?.service)
      const healthStatus = deriveIntegrationHealthStatus({
        hasHealthCheck,
        hasCredentials,
        lastHealthStatus: state.lastHealthStatus,
        lastHealthCheckedAt: state.lastHealthCheckedAt,
      })

      const enabledAtMs = state.enabledAt?.getTime() ?? 0

      return {
        id: integration.id,
        title: integration.title,
        description: integration.description ?? null,
        category: integration.category ?? null,
        tags: integration.tags ?? [],
        hub: integration.hub ?? null,
        providerKey: integration.providerKey ?? null,
        bundleId: integration.bundleId ?? null,
        author: integration.author ?? null,
        company: integration.company ?? null,
        version: integration.version ?? null,
        hasCredentials,
        isEnabled: state.isEnabled,
        apiVersion: state.apiVersion,
        healthStatus,
        lastHealthCheckedAt: state.lastHealthCheckedAt?.toISOString() ?? null,
        lastHealthLatencyMs: state.lastHealthLatencyMs,
        enabledAt: state.enabledAt?.toISOString() ?? null,
        sortEnabledAtMs: enabledAtMs,
        sortTitle: integration.title.toLowerCase(),
        sortCategory: (integration.category ?? '').toLowerCase(),
      }
    }),
  )

  let filtered = baseRows.filter((row) => matchesSearchQuery(
    { title: row.title, description: row.description ?? undefined, tags: row.tags },
    searchNeedle,
  ))

  if (query.category) {
    filtered = filtered.filter((row) => row.category === query.category)
  }
  if (query.bundleId) {
    filtered = filtered.filter((row) => row.bundleId === query.bundleId)
  }
  if (query.isEnabled !== undefined) {
    filtered = filtered.filter((row) => row.isEnabled === query.isEnabled)
  }
  if (query.healthStatus) {
    filtered = filtered.filter((row) => row.healthStatus === query.healthStatus)
  }

  const sortKey = query.sort ?? 'title'
  const orderSign = query.order === 'desc' ? -1 : 1

  const sorted = [...filtered].sort((rowA, rowB) => {
    let cmp = 0
    if (sortKey === 'title') {
      cmp = rowA.sortTitle.localeCompare(rowB.sortTitle)
    } else if (sortKey === 'category') {
      cmp = rowA.sortCategory.localeCompare(rowB.sortCategory)
      if (cmp === 0) cmp = rowA.sortTitle.localeCompare(rowB.sortTitle)
    } else if (sortKey === 'enabledAt') {
      cmp = rowA.sortEnabledAtMs - rowB.sortEnabledAtMs
      if (cmp === 0) cmp = rowA.sortTitle.localeCompare(rowB.sortTitle)
    } else if (sortKey === 'healthStatus') {
      cmp = HEALTH_SORT_RANK[rowA.healthStatus] - HEALTH_SORT_RANK[rowB.healthStatus]
      if (cmp === 0) cmp = rowA.sortTitle.localeCompare(rowB.sortTitle)
    }
    return cmp * orderSign
  })

  const total = sorted.length
  const pageSize = query.pageSize
  const page = query.page
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1)
  const safePage = Math.min(page, totalPages)
  const offset = (safePage - 1) * pageSize
  const pageSlice = sorted.slice(offset, offset + pageSize)

  const analyticsMap = await logService.aggregateAnalytics(
    pageSlice.map((row) => row.id),
    scope,
    30,
  )

  const items = pageSlice.map((row) => {
    const analytics = analyticsMap.get(row.id)
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: row.tags,
      hub: row.hub,
      providerKey: row.providerKey,
      bundleId: row.bundleId,
      author: row.author,
      company: row.company,
      version: row.version,
      hasCredentials: row.hasCredentials,
      isEnabled: row.isEnabled,
      apiVersion: row.apiVersion,
      healthStatus: row.healthStatus,
      lastHealthCheckedAt: row.lastHealthCheckedAt,
      lastHealthLatencyMs: row.lastHealthLatencyMs,
      enabledAt: row.enabledAt,
      analytics: analytics ?? {
        lastActivityAt: null,
        totalCount: 0,
        errorCount: 0,
        errorRate: 0,
        dailyCounts: Array.from({ length: 30 }, () => 0),
      },
    }
  })

  const bundles = getAllBundles().map((bundle) => {
    const bundleIntegrations = filtered.filter((row) => row.bundleId === bundle.id)
    const enabledCount = bundleIntegrations.reduce((count, integration) => count + (integration.isEnabled ? 1 : 0), 0)

    return {
      id: bundle.id,
      title: bundle.title,
      description: bundle.description,
      icon: bundle.icon ?? null,
      integrationCount: bundleIntegrations.length,
      enabledCount,
    }
  })

  return finalizeIntegrationsReadResponse({
    routePath: integrationApiRoutePaths.list,
    request: req,
    auth,
    container,
    interceptorRequest: beforeInterceptors.request,
    beforeMetadata: beforeInterceptors.metadataByInterceptor,
    enrich: {
      targetEntity: 'integrations.integration',
      listKeys: ['items'],
    },
    body: {
      items,
      bundles,
      total,
      page: safePage,
      pageSize,
      totalPages,
    },
  })
}
