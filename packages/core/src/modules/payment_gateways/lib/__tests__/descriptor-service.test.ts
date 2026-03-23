import {
  clearRegisteredIntegrations,
  registerIntegration,
} from '@open-mercato/shared/modules/integrations/types'
import {
  clearPaymentGatewayDescriptors,
  registerPaymentGatewayDescriptor,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { createPaymentGatewayDescriptorService } from '../descriptor-service'

describe('createPaymentGatewayDescriptorService', () => {
  const scope = {
    organizationId: 'org_test',
    tenantId: 'tenant_test',
  }

  beforeEach(() => {
    clearRegisteredIntegrations()
    clearPaymentGatewayDescriptors()
  })

  afterEach(() => {
    clearRegisteredIntegrations()
    clearPaymentGatewayDescriptors()
  })

  it('marks unmanaged descriptors as configured by default', async () => {
    registerPaymentGatewayDescriptor({
      providerKey: 'mock',
      label: 'Mock Gateway',
    })

    const service = createPaymentGatewayDescriptorService({
      integrationCredentialsService: {
        resolve: jest.fn(async () => null),
      } as never,
      integrationStateService: {
        resolveState: jest.fn(async () => ({
          isEnabled: false,
          apiVersion: null,
          reauthRequired: false,
          lastHealthStatus: null,
          lastHealthCheckedAt: null,
        })),
      } as never,
    })

    await expect(service.getResolved('mock', scope)).resolves.toMatchObject({
      providerKey: 'mock',
      integrationId: null,
      requiresConfiguration: false,
      isConfigured: true,
      configurationStatus: 'unmanaged',
    })
  })

  it('marks integration-backed descriptors as unconfigured when credentials are missing', async () => {
    registerIntegration({
      id: 'gateway_stripe',
      title: 'Stripe',
      hub: 'payment_gateways',
      providerKey: 'stripe',
    })
    registerPaymentGatewayDescriptor({
      providerKey: 'stripe',
      label: 'Stripe',
    })

    const service = createPaymentGatewayDescriptorService({
      integrationCredentialsService: {
        resolve: jest.fn(async () => null),
      } as never,
      integrationStateService: {
        resolveState: jest.fn(async () => ({
          isEnabled: true,
          apiVersion: null,
          reauthRequired: false,
          lastHealthStatus: null,
          lastHealthCheckedAt: null,
        })),
      } as never,
    })

    await expect(service.getResolved('stripe', scope)).resolves.toMatchObject({
      providerKey: 'stripe',
      integrationId: 'gateway_stripe',
      requiresConfiguration: true,
      isConfigured: false,
      configurationStatus: 'missing_credentials',
    })
  })

  it('marks integration-backed descriptors as disabled until the integration is enabled', async () => {
    registerIntegration({
      id: 'gateway_stripe',
      title: 'Stripe',
      hub: 'payment_gateways',
      providerKey: 'stripe',
    })
    registerPaymentGatewayDescriptor({
      providerKey: 'stripe',
      label: 'Stripe',
    })

    const service = createPaymentGatewayDescriptorService({
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ secretKey: 'sk_test_123' })),
      } as never,
      integrationStateService: {
        resolveState: jest.fn(async () => ({
          isEnabled: false,
          apiVersion: null,
          reauthRequired: false,
          lastHealthStatus: null,
          lastHealthCheckedAt: null,
        })),
      } as never,
    })

    await expect(service.getResolved('stripe', scope)).resolves.toMatchObject({
      providerKey: 'stripe',
      integrationId: 'gateway_stripe',
      requiresConfiguration: true,
      isConfigured: false,
      configurationStatus: 'disabled',
    })
  })

  it('marks integration-backed descriptors as configured when credentials exist and the integration is enabled', async () => {
    registerIntegration({
      id: 'gateway_stripe',
      title: 'Stripe',
      hub: 'payment_gateways',
      providerKey: 'stripe',
    })
    registerPaymentGatewayDescriptor({
      providerKey: 'stripe',
      label: 'Stripe',
    })

    const service = createPaymentGatewayDescriptorService({
      integrationCredentialsService: {
        resolve: jest.fn(async () => ({ secretKey: 'sk_test_123' })),
      } as never,
      integrationStateService: {
        resolveState: jest.fn(async () => ({
          isEnabled: true,
          apiVersion: '2025-02-24.acacia',
          reauthRequired: false,
          lastHealthStatus: 'healthy',
          lastHealthCheckedAt: null,
        })),
      } as never,
    })

    await expect(service.getResolved('stripe', scope)).resolves.toMatchObject({
      providerKey: 'stripe',
      integrationId: 'gateway_stripe',
      requiresConfiguration: true,
      isConfigured: true,
      configurationStatus: 'configured',
    })
  })
})
