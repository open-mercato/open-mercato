import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../lib/credentials-service'
import type { IntegrationStateService } from '../lib/state-service'
import { getAllBundles, getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import { buildIntegrationsCrudOpenApi, createPagedListResponseSchema, integrationInfoSchema } from './openapi'
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
  listResponseSchema: createPagedListResponseSchema(integrationInfoSchema),
  querySchema: undefined,
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const rows = await Promise.all(
    getAllIntegrations().map(async (integration) => {
      const [resolvedCredentials, state] = await Promise.all([
        credentialsService.resolve(integration.id, { organizationId: auth.orgId as string, tenantId: auth.tenantId as string }),
        stateService.resolveState(integration.id, { organizationId: auth.orgId as string, tenantId: auth.tenantId as string }),
      ])

      return {
        id: integration.id,
        title: integration.title,
        description: integration.description ?? null,
        category: integration.category ?? null,
        hub: integration.hub ?? null,
        providerKey: integration.providerKey ?? null,
        bundleId: integration.bundleId ?? null,
        author: integration.author ?? null,
        company: integration.company ?? null,
        version: integration.version ?? null,
        hasCredentials: Boolean(resolvedCredentials),
        isEnabled: state.isEnabled,
        apiVersion: state.apiVersion,
      }
    }),
  )

  const bundles = getAllBundles().map((bundle) => {
    const bundleIntegrations = rows.filter((row) => row.bundleId === bundle.id)
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
    items: rows,
    bundles,
    total: rows.length,
    page: 1,
    pageSize: 100,
    totalPages: 1,
    },
  })
}
