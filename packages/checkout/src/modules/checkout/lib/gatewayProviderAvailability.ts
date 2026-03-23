import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export type GatewayProviderConfigurationStatus =
  | 'configured'
  | 'missing_credentials'
  | 'disabled'
  | 'unmanaged'

export type GatewayProviderDescriptor = {
  providerKey: string
  label: string
  isConfigured?: boolean
  requiresConfiguration?: boolean
  configurationStatus?: GatewayProviderConfigurationStatus | null
}

export type GatewayProviderScope = {
  organizationId: string
  tenantId: string
}

export type PaymentGatewayDescriptorService = {
  getResolved: (
    providerKey: string,
    scope: GatewayProviderScope,
  ) => Promise<GatewayProviderDescriptor | null>
}

export function getGatewayProviderConfigurationMessageKey(
  descriptor: GatewayProviderDescriptor | null | undefined,
): string | null {
  if (!descriptor?.requiresConfiguration || descriptor.isConfigured !== false) {
    return null
  }

  return descriptor.configurationStatus === 'disabled'
    ? 'checkout.validation.gatewayProviderKey.disabled'
    : 'checkout.validation.gatewayProviderKey.notConfigured'
}

export async function ensureGatewayProviderConfigured(
  providerKey: string | null | undefined,
  descriptorService: PaymentGatewayDescriptorService,
  scope: GatewayProviderScope,
): Promise<void> {
  const normalizedProviderKey = typeof providerKey === 'string' ? providerKey.trim() : ''
  if (!normalizedProviderKey) return

  const descriptor = await descriptorService.getResolved(normalizedProviderKey, scope)
  const messageKey = getGatewayProviderConfigurationMessageKey(descriptor)
  if (!messageKey) return

  throw new CrudHttpError(422, {
    error: 'Validation failed',
    fieldErrors: {
      gatewayProviderKey: messageKey,
    },
  })
}
