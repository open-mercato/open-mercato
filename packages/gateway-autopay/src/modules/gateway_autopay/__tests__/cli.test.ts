import { resolveForceFlag } from '../cli'
import { applyAutopayEnvPreset } from '../lib/preset'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'

describe('resolveForceFlag', () => {
  it('preserves undefined when --force was never passed', () => {
    expect(resolveForceFlag(undefined)).toBeUndefined()
  })

  it('resolves bare --force to true', () => {
    expect(resolveForceFlag(true)).toBe(true)
  })

  it('parses an explicit --force=false string', () => {
    expect(resolveForceFlag('false')).toBe(false)
  })

  it('parses an explicit --force=true string', () => {
    expect(resolveForceFlag('true')).toBe(true)
  })
})

describe('CLI force flag reaching the env preset', () => {
  it('lets OM_INTEGRATION_AUTOPAY_FORCE_PRECONFIGURE=true win when no --force flag is passed', async () => {
    const credentialsService = {
      getRaw: jest.fn().mockResolvedValue({ serviceId: 'existing' }),
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as CredentialsService
    const integrationStateService = {
      get: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    } as unknown as IntegrationStateService

    const result = await applyAutopayEnvPreset({
      credentialsService,
      integrationStateService,
      scope: { tenantId: 'tenant-1', organizationId: 'org-1' },
      force: resolveForceFlag(undefined),
      env: {
        OM_INTEGRATION_AUTOPAY_SERVICE_ID: '2',
        OM_INTEGRATION_AUTOPAY_SHARED_KEY: '2test2',
        OM_INTEGRATION_AUTOPAY_GATEWAY_URL: 'https://testpay.autopay.eu/sciezka',
        OM_INTEGRATION_AUTOPAY_FORCE_PRECONFIGURE: 'true',
      },
    })

    expect(result.status).toBe('configured')
    expect(credentialsService.save).toHaveBeenCalled()
  })
})
