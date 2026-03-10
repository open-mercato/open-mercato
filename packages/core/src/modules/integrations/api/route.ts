import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../lib/credentials-service'
import type { IntegrationStateService } from '../lib/state-service'
import { getAllBundles, getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import { buildIntegrationsCrudOpenApi, createPagedListResponseSchema, integrationInfoSchema } from './openapi'

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
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const stateService = container.resolve('integrationStateService') as IntegrationStateService

  const rows = await Promise.all(
    getAllIntegrations().map(async (integration) => {
      const [resolvedCredentials, state] = await Promise.all([
        credentialsService.resolve(integration.id, { organizationId: auth.orgId as string, tenantId: auth.tenantId as string }),
        stateService.get(integration.id, { organizationId: auth.orgId as string, tenantId: auth.tenantId as string }),
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
        isEnabled: state?.isEnabled ?? true,
        apiVersion: state?.apiVersion ?? null,
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

  return NextResponse.json({
    items: rows,
    bundles,
    total: rows.length,
    page: 1,
    pageSize: 100,
    totalPages: 1,
  })
}
