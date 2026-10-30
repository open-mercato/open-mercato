import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyGusRegonEnvPreset, readGusRegonEnvPreset } from '../lib/preset'

const API_KEY = 'gus-preset-key-123'
const baseEnv = { OM_INTEGRATION_GUS_REGON_API_KEY: API_KEY }
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function createServices(existing: { credentials?: unknown; state?: unknown } = {}) {
  const save = jest.fn(async () => undefined)
  const upsert = jest.fn(async (_id: string, input: unknown) => input)
  const info = jest.fn(async () => undefined)
  return {
    save,
    upsert,
    info,
    credentialsService: {
      getRaw: jest.fn().mockResolvedValue(existing.credentials ?? null),
      save,
    } as unknown as CredentialsService,
    integrationStateService: {
      get: jest.fn().mockResolvedValue(existing.state ?? null),
      upsert,
    } as unknown as IntegrationStateService,
    integrationLogService: {
      scoped: jest.fn(() => ({ info })),
    } as unknown as IntegrationLogService,
  }
}

describe('gus_regon env preset', () => {
  it('returns null without an API key', () => {
    expect(readGusRegonEnvPreset({})).toBeNull()
    expect(readGusRegonEnvPreset({ OM_INTEGRATION_GUS_REGON_ENVIRONMENT: 'production' })).toBeNull()
    expect(readGusRegonEnvPreset({ OM_INTEGRATION_GUS_REGON_API_KEY: '   ' })).toBeNull()
  })

  it('defaults to Test, the CRM card off and the integration enabled', () => {
    expect(readGusRegonEnvPreset(baseEnv)).toEqual({
      credentials: { environment: 'test', apiKey: API_KEY, showOnCompanyForms: false },
      force: false,
      enabled: true,
    })
  })

  it('reads environment, switch, enabled and force flags', () => {
    expect(
      readGusRegonEnvPreset({
        ...baseEnv,
        OM_INTEGRATION_GUS_REGON_ENVIRONMENT: 'production',
        OM_INTEGRATION_GUS_REGON_SHOW_ON_COMPANY_FORMS: 'true',
        OM_INTEGRATION_GUS_REGON_ENABLED: 'false',
        OM_INTEGRATION_GUS_REGON_FORCE_PRECONFIGURE: 'yes',
      }),
    ).toEqual({
      credentials: { environment: 'production', apiKey: API_KEY, showOnCompanyForms: true },
      force: true,
      enabled: false,
    })
  })

  it('rejects an unknown environment without echoing the key', () => {
    const read = () => readGusRegonEnvPreset({ ...baseEnv, OM_INTEGRATION_GUS_REGON_ENVIRONMENT: 'staging' })
    expect(read).toThrow('must be "test" or "production"')
    expect(read).not.toThrow(API_KEY)
  })

  it('skips without env', async () => {
    const services = createServices()
    await expect(applyGusRegonEnvPreset({ ...services, scope, env: {} })).resolves.toEqual({
      status: 'skipped',
      reason: 'No GUS REGON preset env variables were provided.',
    })
    expect(services.save).not.toHaveBeenCalled()
  })

  it('does not overwrite an existing configuration unless forced', async () => {
    const services = createServices({ credentials: { environment: 'production' } })
    await expect(applyGusRegonEnvPreset({ ...services, scope, env: baseEnv })).resolves.toMatchObject({ status: 'skipped' })
    expect(services.save).not.toHaveBeenCalled()

    await expect(applyGusRegonEnvPreset({ ...services, scope, env: baseEnv, force: true })).resolves.toEqual({
      status: 'configured',
      enabled: true,
    })
    expect(services.save).toHaveBeenCalledWith(
      'gus_regon',
      { environment: 'test', apiKey: API_KEY, showOnCompanyForms: false },
      scope,
    )
  })

  it('saves credentials, enables the integration and logs without the key', async () => {
    const services = createServices()
    await expect(applyGusRegonEnvPreset({ ...services, scope, env: baseEnv })).resolves.toEqual({
      status: 'configured',
      enabled: true,
    })
    expect(services.upsert).toHaveBeenCalledWith('gus_regon', { isEnabled: true }, scope)
    expect(services.info).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(services.info.mock.calls)).not.toContain(API_KEY)
  })
})
