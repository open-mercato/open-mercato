import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  ensureGatewayProviderConfigured,
  getGatewayProviderConfigurationMessageKey,
} from '../gatewayProviderAvailability'

describe('gatewayProviderAvailability', () => {
  it('returns the missing-credentials validation key for unconfigured providers', () => {
    expect(getGatewayProviderConfigurationMessageKey({
      providerKey: 'stripe',
      label: 'Stripe',
      requiresConfiguration: true,
      isConfigured: false,
      configurationStatus: 'missing_credentials',
    })).toBe('checkout.validation.gatewayProviderKey.notConfigured')
  })

  it('returns the disabled validation key for disabled providers', () => {
    expect(getGatewayProviderConfigurationMessageKey({
      providerKey: 'stripe',
      label: 'Stripe',
      requiresConfiguration: true,
      isConfigured: false,
      configurationStatus: 'disabled',
    })).toBe('checkout.validation.gatewayProviderKey.disabled')
  })

  it('throws a field-level validation error when a provider is unavailable', async () => {
    await expect(
      ensureGatewayProviderConfigured(
        'stripe',
        {
          getResolved: jest.fn(async () => ({
            providerKey: 'stripe',
            label: 'Stripe',
            requiresConfiguration: true,
            isConfigured: false,
            configurationStatus: 'missing_credentials',
          })),
        },
        {
          organizationId: 'org_test',
          tenantId: 'tenant_test',
        },
      ),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({
      status: 422,
      body: {
        fieldErrors: {
          gatewayProviderKey: 'checkout.validation.gatewayProviderKey.notConfigured',
        },
      },
    })
  })
})
