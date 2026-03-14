import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { readInpostEnvPreset, applyInpostEnvPreset } from '../lib/preset'
import type { ApplyInpostPresetResult } from '../lib/preset'

const makeServices = (hasExisting = false) => {
  const credentialsService = {
    getRaw: jest.fn().mockResolvedValue(hasExisting ? { apiToken: 'existing' } : null),
    save: jest.fn().mockResolvedValue(undefined),
  } as unknown as CredentialsService
  const integrationStateService = {
    get: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
  } as unknown as IntegrationStateService
  const integrationLogService = {
    scoped: jest.fn().mockReturnValue({
      info: jest.fn().mockResolvedValue(undefined),
    }),
  } as unknown as IntegrationLogService
  return { credentialsService, integrationStateService, integrationLogService }
}

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('readInpostEnvPreset', () => {
  it('returns null when no env vars are set', () => {
    expect(readInpostEnvPreset({})).toBeNull()
  })

  it('throws when only apiToken is set (missing organizationId)', () => {
    expect(() => readInpostEnvPreset({ OM_INTEGRATION_INPOST_API_TOKEN: 'tok' })).toThrow(
      'OM_INTEGRATION_INPOST_ORGANIZATION_ID',
    )
  })

  it('returns a preset with required fields', () => {
    const preset = readInpostEnvPreset({
      OM_INTEGRATION_INPOST_API_TOKEN: 'my-token',
      OM_INTEGRATION_INPOST_ORGANIZATION_ID: 'my-org',
    })
    expect(preset).not.toBeNull()
    expect(preset?.credentials.apiToken).toBe('my-token')
    expect(preset?.credentials.organizationId).toBe('my-org')
    expect(preset?.force).toBe(false)
    expect(preset?.enabled).toBe(true)
  })

  it('includes optional fields when present', () => {
    const preset = readInpostEnvPreset({
      OM_INTEGRATION_INPOST_API_TOKEN: 'tok',
      OM_INTEGRATION_INPOST_ORGANIZATION_ID: 'org',
      OM_INTEGRATION_INPOST_API_BASE_URL: 'https://sandbox.inpost.pl',
      OM_INTEGRATION_INPOST_WEBHOOK_SECRET: 'shh',
      OM_INTEGRATION_INPOST_FORCE_PRECONFIGURE: 'true',
      OM_INTEGRATION_INPOST_ENABLED: 'false',
    })
    expect(preset?.credentials.apiBaseUrl).toBe('https://sandbox.inpost.pl')
    expect(preset?.credentials.webhookSecret).toBe('shh')
    expect(preset?.force).toBe(true)
    expect(preset?.enabled).toBe(false)
  })
})

describe('applyInpostEnvPreset', () => {
  it('returns skipped when no env vars', async () => {
    const services = makeServices()
    const result = await applyInpostEnvPreset({ ...services, scope, env: {} })
    expect(result.status).toBe('skipped')
  })

  it('returns skipped when credentials already exist', async () => {
    const services = makeServices(true)
    const result = await applyInpostEnvPreset({
      ...services,
      scope,
      env: {
        OM_INTEGRATION_INPOST_API_TOKEN: 'tok',
        OM_INTEGRATION_INPOST_ORGANIZATION_ID: 'org',
      },
    })
    expect(result.status).toBe('skipped')
    expect(jest.mocked(services.credentialsService.save)).not.toHaveBeenCalled()
  })

  it('configures when env vars provided and no existing config', async () => {
    const services = makeServices(false)
    const result: ApplyInpostPresetResult = await applyInpostEnvPreset({
      ...services,
      scope,
      env: {
        OM_INTEGRATION_INPOST_API_TOKEN: 'tok',
        OM_INTEGRATION_INPOST_ORGANIZATION_ID: 'org',
      },
    })
    expect(result.status).toBe('configured')
    expect(jest.mocked(services.credentialsService.save)).toHaveBeenCalledWith(
      'carrier_inpost',
      expect.objectContaining({ apiToken: 'tok', organizationId: 'org' }),
      scope,
    )
    expect(jest.mocked(services.integrationStateService.upsert)).toHaveBeenCalled()
  })

  it('overwrites existing config when force is set', async () => {
    const services = makeServices(true)
    const result = await applyInpostEnvPreset({
      ...services,
      scope,
      force: true,
      env: {
        OM_INTEGRATION_INPOST_API_TOKEN: 'new-tok',
        OM_INTEGRATION_INPOST_ORGANIZATION_ID: 'new-org',
      },
    })
    expect(result.status).toBe('configured')
    expect(jest.mocked(services.credentialsService.save)).toHaveBeenCalled()
  })
})
