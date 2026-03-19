import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import type { IntegrationStateService } from '../../integrations/lib/state-service'
import { getDataSyncAdapter } from '../lib/adapter-registry'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['data_sync.view'] },
}

export const openApi = {
  tags: ['DataSync'],
  summary: 'List data sync integration options',
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const credentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const stateService = container.resolve('integrationStateService') as IntegrationStateService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  const items = await Promise.all(
    getAllIntegrations()
      .filter((integration) => integration.hub === 'data_sync' && integration.providerKey)
      .map(async (integration) => {
        const adapter = getDataSyncAdapter(integration.providerKey as string)
        if (!adapter) return null

        const [credentials, state] = await Promise.all([
          credentialsService.resolve(integration.id, scope),
          stateService.resolveState(integration.id, scope),
        ])

        return {
          integrationId: integration.id,
          title: integration.title,
          description: integration.description ?? null,
          providerKey: integration.providerKey ?? null,
          direction: adapter.direction,
          supportedEntities: adapter.supportedEntities,
          hasCredentials: Boolean(credentials),
          isEnabled: state.isEnabled,
          settingsPath: `/backend/integrations/${encodeURIComponent(integration.id)}`,
        }
      }),
  )

  return NextResponse.json({
    items: items.filter((item): item is NonNullable<typeof item> => Boolean(item)),
  })
}
