import {
  getAllIntegrations,
  type IntegrationScope,
} from '@open-mercato/shared/modules/integrations/types'
import {
  getPaymentGatewayDescriptor,
  listPaymentGatewayDescriptors,
  type PaymentGatewayDescriptor,
} from '@open-mercato/shared/modules/payment_gateways/types'
import type { CredentialsService } from '../../integrations/lib/credentials-service'
import type { IntegrationStateService } from '../../integrations/lib/state-service'

export type PaymentGatewayConfigurationStatus =
  | 'configured'
  | 'missing_credentials'
  | 'disabled'
  | 'unmanaged'

export type ResolvedPaymentGatewayDescriptor = PaymentGatewayDescriptor & {
  integrationId: string | null
  requiresConfiguration: boolean
  isConfigured: boolean
  configurationStatus: PaymentGatewayConfigurationStatus
}

export type PaymentGatewayDescriptorService = ReturnType<typeof createPaymentGatewayDescriptorService>

type Deps = {
  integrationCredentialsService: CredentialsService
  integrationStateService: IntegrationStateService
}

function findGatewayIntegration(providerKey: string) {
  return getAllIntegrations().find(
    (integration) => integration.hub === 'payment_gateways' && integration.providerKey === providerKey,
  )
}

async function resolveDescriptor(
  descriptor: PaymentGatewayDescriptor,
  scope: IntegrationScope,
  deps: Deps,
): Promise<ResolvedPaymentGatewayDescriptor> {
  const integration = findGatewayIntegration(descriptor.providerKey)
  if (!integration) {
    return {
      ...descriptor,
      integrationId: null,
      requiresConfiguration: false,
      isConfigured: true,
      configurationStatus: 'unmanaged',
    }
  }

  const [credentials, state] = await Promise.all([
    deps.integrationCredentialsService.resolve(integration.id, scope),
    deps.integrationStateService.resolveState(integration.id, scope),
  ])

  if (!credentials) {
    return {
      ...descriptor,
      integrationId: integration.id,
      requiresConfiguration: true,
      isConfigured: false,
      configurationStatus: 'missing_credentials',
    }
  }

  if (!state.isEnabled) {
    return {
      ...descriptor,
      integrationId: integration.id,
      requiresConfiguration: true,
      isConfigured: false,
      configurationStatus: 'disabled',
    }
  }

  return {
    ...descriptor,
    integrationId: integration.id,
    requiresConfiguration: true,
    isConfigured: true,
    configurationStatus: 'configured',
  }
}

export function createPaymentGatewayDescriptorService(deps: Deps) {
  return {
    list(): PaymentGatewayDescriptor[] {
      return listPaymentGatewayDescriptors()
    },

    get(providerKey: string): PaymentGatewayDescriptor | null {
      return getPaymentGatewayDescriptor(providerKey) ?? null
    },

    async listResolved(scope: IntegrationScope): Promise<ResolvedPaymentGatewayDescriptor[]> {
      return Promise.all(
        listPaymentGatewayDescriptors().map((descriptor) => resolveDescriptor(descriptor, scope, deps)),
      )
    },

    async getResolved(providerKey: string, scope: IntegrationScope): Promise<ResolvedPaymentGatewayDescriptor | null> {
      const descriptor = getPaymentGatewayDescriptor(providerKey)
      if (!descriptor) return null
      return resolveDescriptor(descriptor, scope, deps)
    },
  }
}
