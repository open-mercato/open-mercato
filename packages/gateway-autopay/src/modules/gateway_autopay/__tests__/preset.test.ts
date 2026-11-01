import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyAutopayEnvPreset, readAutopayEnvPreset } from '../lib/preset'

describe('gateway_autopay preset', () => {
  it('reads credentials and optional settings from env', () => {
    const preset = readAutopayEnvPreset({
      OM_INTEGRATION_AUTOPAY_SERVICE_ID: '2',
      OM_INTEGRATION_AUTOPAY_SHARED_KEY: '2test2',
      OM_INTEGRATION_AUTOPAY_GATEWAY_URL: 'https://testpay.autopay.eu/sciezka',
      OM_INTEGRATION_AUTOPAY_HASH_ALGORITHM: 'sha512',
      OM_INTEGRATION_AUTOPAY_ENABLED: 'false',
      OM_INTEGRATION_AUTOPAY_FORCE_PRECONFIGURE: 'true',
    })

    expect(preset).not.toBeNull()
    expect(preset?.credentials.serviceId).toBe('2')
    expect(preset?.credentials.sharedKey).toBe('2test2')
    expect(preset?.credentials.gatewayUrl).toBe('https://testpay.autopay.eu/sciezka')
    expect(preset?.credentials.hashAlgorithm).toBe('sha512')
    expect(preset?.enabled).toBe(false)
    expect(preset?.force).toBe(true)
  })

  it('returns null when no Autopay env vars are set', () => {
    expect(readAutopayEnvPreset({})).toBeNull()
  })

  it('throws when only some required credentials are provided', () => {
    expect(() => readAutopayEnvPreset({ OM_INTEGRATION_AUTOPAY_SERVICE_ID: '2' })).toThrow(/Incomplete Autopay env preset/)
  })

  it('applies credentials and enabled state from env', async () => {
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

    const result = await applyAutopayEnvPreset({
      credentialsService,
      integrationStateService,
      integrationLogService,
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
      env: {
        OM_INTEGRATION_AUTOPAY_SERVICE_ID: '2',
        OM_INTEGRATION_AUTOPAY_SHARED_KEY: '2test2',
        OM_INTEGRATION_AUTOPAY_GATEWAY_URL: 'https://testpay.autopay.eu/sciezka',
      },
    })

    expect(result).toEqual({ status: 'configured', enabled: true })
    expect(savedCredentials).toEqual([
      {
        serviceId: '2',
        sharedKey: '2test2',
        gatewayUrl: 'https://testpay.autopay.eu/sciezka',
        hashAlgorithm: undefined,
      },
    ])
    expect(upserts).toEqual([{ isEnabled: true }])
    expect(logs).toEqual([{ enabled: true }])
  })

  it('skips re-applying when credentials already exist and force is not set', async () => {
    const credentialsService = {
      getRaw: jest.fn().mockResolvedValue({ serviceId: 'existing' }),
    } as unknown as CredentialsService
    const integrationStateService = {
      get: jest.fn().mockResolvedValue(null),
    } as unknown as IntegrationStateService

    const result = await applyAutopayEnvPreset({
      credentialsService,
      integrationStateService,
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
      env: {
        OM_INTEGRATION_AUTOPAY_SERVICE_ID: '2',
        OM_INTEGRATION_AUTOPAY_SHARED_KEY: '2test2',
        OM_INTEGRATION_AUTOPAY_GATEWAY_URL: 'https://testpay.autopay.eu/sciezka',
      },
    })

    expect(result.status).toBe('skipped')
  })
})
