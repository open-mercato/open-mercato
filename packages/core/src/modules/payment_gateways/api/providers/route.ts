import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAllIntegrations } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '../../../integrations/lib/credentials-service'
import type { IntegrationStateService } from '../../../integrations/lib/state-service'
import { paymentGatewaysTag } from '../openapi'

export const metadata = {
  path: '/payment_gateways/providers',
  GET: { requireAuth: true, requireFeatures: ['payment_gateways.view'] },
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
      .filter((integration) => integration.hub === 'payment_gateways' && integration.providerKey)
      .map(async (integration) => {
        const [credentials, state] = await Promise.all([
          credentialsService.resolve(integration.id, scope),
          stateService.get(integration.id, scope),
        ])
        return {
          id: integration.id,
          title: integration.title,
          description: integration.description ?? null,
          providerKey: integration.providerKey ?? null,
          hasCredentials: Boolean(credentials),
          isEnabled: state?.isEnabled ?? true,
          supportsPaymentLinks: integration.paymentGateway?.supportsPaymentLinks ?? false,
          transactionCreateFieldSpotId: integration.paymentGateway?.transactionCreateFieldSpotId ?? null,
          paymentLinkWidgetSpotId: integration.paymentGateway?.paymentLinkWidgetSpotId ?? null,
        }
      }),
  )

  return NextResponse.json({
    items: items.filter((item) => item.providerKey && item.hasCredentials && item.isEnabled),
  })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'List enabled payment gateway providers available for transaction creation',
  methods: {
    GET: {
      summary: 'List payment gateway providers',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Available providers' },
      ],
    },
  },
}

export default GET
