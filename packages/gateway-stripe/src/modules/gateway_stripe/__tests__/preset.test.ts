import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyStripeEnvPreset, readStripeEnvPreset } from '../lib/preset'

describe('gateway_stripe preset', () => {
  it('reads credentials and optional settings from env', () => {
    const preset = readStripeEnvPreset({
      OM_INTEGRATION_STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
      OM_INTEGRATION_STRIPE_SECRET_KEY: 'sk_test_123',
      OM_INTEGRATION_STRIPE_WEBHOOK_SECRET: 'whsec_123',
      OM_INTEGRATION_STRIPE_API_VERSION: '2024-12-18',
      OM_INTEGRATION_STRIPE_ENABLED: 'false',
      OM_INTEGRATION_STRIPE_FORCE_PRECONFIGURE: 'true',
    })

    expect(preset).not.toBeNull()
    expect(preset?.credentials.publishableKey).toBe('pk_test_123')
    expect(preset?.credentials.secretKey).toBe('sk_test_123')
    expect(preset?.credentials.webhookSecret).toBe('whsec_123')
    expect(preset?.apiVersion).toBe('2024-12-18')
    expect(preset?.enabled).toBe(false)
    expect(preset?.force).toBe(true)
  })

  it('keeps backward compatibility with legacy OPENMERCATO_STRIPE aliases', () => {
    const preset = readStripeEnvPreset({
      OPENMERCATO_STRIPE_PUBLISHABLE_KEY: 'pk_test_legacy',
      OPENMERCATO_STRIPE_SECRET_KEY: 'sk_test_legacy',
      OPENMERCATO_STRIPE_WEBHOOK_SECRET: 'whsec_legacy',
    })

    expect(preset).not.toBeNull()
    expect(preset?.credentials.publishableKey).toBe('pk_test_legacy')
  })

  it('applies credentials, enabled state, and default api version from env', async () => {
    const savedCredentials: Array<Record<string, unknown>> = []
    const upserts: Array<Record<string, unknown>> = []
    const logs: Array<Record<string, unknown> | undefined> = []

    const credentialsService = {
      getRaw: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (_integrationId, credentials) => {
        savedCredentials.push(credentials)
      }),
    } as unknown as CredentialsService

    const integrationStateService = {
      get: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(async (_integrationId, input) => {
        upserts.push(input as Record<string, unknown>)
        return input
      }),
    } as unknown as IntegrationStateService

    const integrationLogService = {
      scoped: jest.fn(() => ({
        info: async (_message: string, payload?: Record<string, unknown>) => {
          logs.push(payload)
        },
      })),
    } as unknown as IntegrationLogService

    const result = await applyStripeEnvPreset({
      credentialsService,
      integrationStateService,
      integrationLogService,
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
      env: {
        OM_INTEGRATION_STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
        OM_INTEGRATION_STRIPE_SECRET_KEY: 'sk_test_123',
        OM_INTEGRATION_STRIPE_WEBHOOK_SECRET: 'whsec_123',
      },
    })

    expect(result).toEqual({
      status: 'configured',
      appliedApiVersion: '2025-02-24.acacia',
      enabled: true,
    })
    expect(savedCredentials).toEqual([
      {
        publishableKey: 'pk_test_123',
        secretKey: 'sk_test_123',
        webhookSecret: 'whsec_123',
      },
    ])
    expect(upserts).toEqual([
      {
        isEnabled: true,
        apiVersion: '2025-02-24.acacia',
      },
    ])
    expect(logs).toEqual([
      {
        enabled: true,
        apiVersion: '2025-02-24.acacia',
      },
    ])
  })
})
