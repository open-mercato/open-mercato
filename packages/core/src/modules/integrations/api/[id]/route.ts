import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getBundle, getBundleIntegrations, getIntegration } from '@open-mercato/shared/modules/integrations/types'
import { CredentialsEncryptionUnavailableError, type CredentialsService } from '../../lib/credentials-service'
import type { IntegrationStateService } from '../../lib/state-service'
import type { IntegrationLogService } from '../../lib/log-service'
import { deriveIntegrationHealthStatus, getEffectiveHealthCheckConfig } from '../../lib/health-service'
import type { OAuthGrantReadStatus } from '../../lib/oauth/descriptor'
import type { IntegrationOAuthGrantService } from '../../lib/oauth/grant-service'
import { integrationDetailResponseSchema } from '../openapi'
import {
  finalizeIntegrationsReadResponse,
  integrationApiRoutePaths,
  runIntegrationsReadBeforeInterceptors,
} from '../umes-read'
import { organizationScopeRequiredResponse, resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'

const idParamsSchema = z.object({ id: z.string().min(1) })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.view'] },
}

const errorResponseSchema = z.object({ error: z.string(), code: z.string().optional() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Integrations',
  summary: 'Get integration detail',
  methods: {
    GET: {
      summary: 'Get integration detail',
      description:
        'Returns the integration definition (including detailPage.connectTabId), its state, credentials presence, health, analytics and oauthGrant: the status of the tenant-level OAuth grant of the active organization, or null without a live grant.',
      responses: [{ status: 200, description: 'Integration detail', schema: integrationDetailResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid integration id, or the organization scope cannot be resolved', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Integration not found', schema: errorResponseSchema },
      ],
    },
  },
}

const OAUTH_GRANT_READ_FAILED_CODE = 'integrations.oauth_inspect_failed'

async function readOAuthGrantSummary(
  container: AppContainer,
  integrationId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<{ status: OAuthGrantReadStatus } | null> {
  try {
    const grantService = container.resolve<IntegrationOAuthGrantService>('integrationOAuthGrantService')
    const status = await grantService.readGrantStatus(integrationId, scope)
    return status ? { status } : null
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'integrations',
      code: OAUTH_GRANT_READ_FAILED_CODE,
      attributes: { integrationId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    })
    return { status: 'unavailable' }
  }
}

export async function GET(req: Request, ctx: { params?: Promise<{ id?: string }> | { id?: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) {
    return organizationScopeRequiredResponse()
  }

  const rawParams = (ctx.params && typeof (ctx.params as Promise<unknown>).then === 'function')
    ? await (ctx.params as Promise<{ id?: string }>)
    : (ctx.params as { id?: string } | undefined)

  const parsedParams = idParamsSchema.safeParse(rawParams)
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 })
  }

  const integration = getIntegration(parsedParams.data.id)
  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const beforeInterceptors = await runIntegrationsReadBeforeInterceptors({
    routePath: integrationApiRoutePaths.detail,
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
  const scope = { organizationId: organizationId, tenantId: auth.tenantId }

  const [credentials, credentialsUpdatedAt, state, analyticsMap, oauthGrant] = await Promise.all([
    credentialsService.resolve(integration.id, scope).catch((err) => {
      if (err instanceof CredentialsEncryptionUnavailableError) return null
      throw err
    }),
    credentialsService.resolveUpdatedAt(integration.id, scope).catch((err) => {
      if (err instanceof CredentialsEncryptionUnavailableError) return null
      throw err
    }),
    stateService.resolveState(integration.id, scope),
    logService.aggregateAnalytics([integration.id], scope, 30),
    readOAuthGrantSummary(container, integration.id, scope),
  ])

  const hasCredentials = credentials != null && Object.keys(credentials).length > 0
  const healthConfig = getEffectiveHealthCheckConfig(integration.id)
  const hasHealthCheck = Boolean(healthConfig?.service)
  const healthStatus = deriveIntegrationHealthStatus({
    hasHealthCheck,
    hasCredentials,
    lastHealthStatus: state.lastHealthStatus,
    lastHealthCheckedAt: state.lastHealthCheckedAt,
  })

  const analytics = analyticsMap.get(integration.id) ?? {
    lastActivityAt: null,
    totalCount: 0,
    errorCount: 0,
    errorRate: 0,
    dailyCounts: Array.from({ length: 30 }, () => 0),
  }

  const bundle = integration.bundleId ? getBundle(integration.bundleId) : undefined
  const bundleIntegrations = integration.bundleId
    ? await Promise.all(
      getBundleIntegrations(integration.bundleId).map(async (item) => {
        const resolvedState = await stateService.resolveState(item.id, scope)
        return {
          ...item,
          isEnabled: resolvedState.isEnabled,
          state: {
            isEnabled: resolvedState.isEnabled,
            apiVersion: resolvedState.apiVersion,
            reauthRequired: resolvedState.reauthRequired,
            lastHealthStatus: resolvedState.lastHealthStatus,
            lastHealthCheckedAt: resolvedState.lastHealthCheckedAt?.toISOString() ?? null,
            lastHealthLatencyMs: resolvedState.lastHealthLatencyMs,
            enabledAt: resolvedState.enabledAt?.toISOString() ?? null,
            updatedAt: resolvedState.updatedAt?.toISOString() ?? null,
          },
        }
      }),
    )
    : []

  return finalizeIntegrationsReadResponse({
    routePath: integrationApiRoutePaths.detail,
    request: req,
    auth,
    container,
    interceptorRequest: beforeInterceptors.request,
    beforeMetadata: beforeInterceptors.metadataByInterceptor,
    enrich: {
      targetEntity: 'integrations.integration',
      recordKeys: ['integration'],
      listKeys: ['bundleIntegrations'],
    },
    body: {
      integration,
      bundle,
      bundleIntegrations,
      state: {
        isEnabled: state.isEnabled,
        apiVersion: state.apiVersion,
        reauthRequired: state.reauthRequired,
        lastHealthStatus: state.lastHealthStatus,
        lastHealthCheckedAt: state.lastHealthCheckedAt?.toISOString() ?? null,
        lastHealthLatencyMs: state.lastHealthLatencyMs,
        enabledAt: state.enabledAt?.toISOString() ?? null,
        updatedAt: state.updatedAt?.toISOString() ?? null,
      },
      hasCredentials,
      credentialsUpdatedAt: credentialsUpdatedAt?.toISOString() ?? null,
      healthStatus,
      analytics,
      oauthGrant,
    },
  })
}
