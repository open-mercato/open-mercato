import Chance from 'chance'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import { readInpostEnvPreset, applyInpostEnvPreset } from '../lib/preset'
import type { ApplyInpostPresetResult } from '../lib/preset'

const chance = new Chance()

const makeServices = (hasExisting = false) => {
  const credentialsService = {
    getRaw: jest.fn().mockResolvedValue(hasExisting ? { apiToken: chance.guid() } : null),
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

function makeScope() {
  return { tenantId: chance.guid(), organizationId: chance.guid() }
}

describe('readInpostEnvPreset', () => {
  it('returns null when no env vars are set', () => {
    expect(readInpostEnvPreset({})).toBeNull()
  })

  it('throws when only apiToken is set (missing organizationId)', () => {
    expect(() =>
      readInpostEnvPreset({ OM_INTEGRATION_INPOST_API_TOKEN: chance.guid() }),
    ).toThrow('OM_INTEGRATION_INPOST_ORGANIZATION_ID')
  })

  it('returns a preset with required fields', () => {
    const token = chance.guid()
    const orgId = chance.guid()

    const preset = readInpostEnvPreset({
      OM_INTEGRATION_INPOST_API_TOKEN: token,
      OM_INTEGRATION_INPOST_ORGANIZATION_ID: orgId,
    })

    expect(preset).not.toBeNull()
    expect(preset?.credentials.apiToken).toBe(token)
    expect(preset?.credentials.organizationId).toBe(orgId)
    expect(preset?.force).toBe(false)
    expect(preset?.enabled).toBe(true)
  })

  it('includes optional fields when present', () => {
    const baseUrl = `https://sandbox-${chance.word()}.easypack24.net`
    const webhookSecret = chance.string({ length: 40 })

    const preset = readInpostEnvPreset({
      OM_INTEGRATION_INPOST_API_TOKEN: chance.guid(),
      OM_INTEGRATION_INPOST_ORGANIZATION_ID: chance.guid(),
      OM_INTEGRATION_INPOST_API_BASE_URL: baseUrl,
      OM_INTEGRATION_INPOST_WEBHOOK_SECRET: webhookSecret,
      OM_INTEGRATION_INPOST_FORCE_PRECONFIGURE: 'true',
      OM_INTEGRATION_INPOST_ENABLED: 'false',
    })

    expect(preset?.credentials.apiBaseUrl).toBe(baseUrl)
    expect(preset?.credentials.webhookSecret).toBe(webhookSecret)
    expect(preset?.force).toBe(true)
    expect(preset?.enabled).toBe(false)
  })
})

describe('applyInpostEnvPreset', () => {
  it('returns skipped when no env vars', async () => {
    const services = makeServices()
    const result = await applyInpostEnvPreset({ ...services, scope: makeScope(), env: {} })
    expect(result.status).toBe('skipped')
  })

  it('returns skipped when credentials already exist', async () => {
    const services = makeServices(true)
    const result = await applyInpostEnvPreset({
      ...services,
      scope: makeScope(),
      env: {
        OM_INTEGRATION_INPOST_API_TOKEN: chance.guid(),
        OM_INTEGRATION_INPOST_ORGANIZATION_ID: chance.guid(),
      },
    })
    expect(result.status).toBe('skipped')
    expect(jest.mocked(services.credentialsService.save)).not.toHaveBeenCalled()
  })

  it('configures when env vars provided and no existing config', async () => {
    const services = makeServices(false)
    const token = chance.guid()
    const orgId = chance.guid()
    const scope = makeScope()

    const result: ApplyInpostPresetResult = await applyInpostEnvPreset({
      ...services,
      scope,
      env: {
        OM_INTEGRATION_INPOST_API_TOKEN: token,
        OM_INTEGRATION_INPOST_ORGANIZATION_ID: orgId,
      },
    })

    expect(result.status).toBe('configured')
    expect(jest.mocked(services.credentialsService.save)).toHaveBeenCalledWith(
      'carrier_inpost',
      expect.objectContaining({ apiToken: token, organizationId: orgId }),
      scope,
    )
    expect(jest.mocked(services.integrationStateService.upsert)).toHaveBeenCalled()
  })

  it('overwrites existing config when force is set', async () => {
    const services = makeServices(true)

    const result = await applyInpostEnvPreset({
      ...services,
      scope: makeScope(),
      force: true,
      env: {
        OM_INTEGRATION_INPOST_API_TOKEN: chance.guid(),
        OM_INTEGRATION_INPOST_ORGANIZATION_ID: chance.guid(),
      },
    })

    expect(result.status).toBe('configured')
    expect(jest.mocked(services.credentialsService.save)).toHaveBeenCalled()
  })
})
