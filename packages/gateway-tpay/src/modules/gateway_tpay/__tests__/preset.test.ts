import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyTpayEnvPreset, readTpayEnvPreset } from '../lib/preset'

const SECRET = 'super-secret-value-123'
const SECURITY_CODE = 'security-code-456'

const baseEnv = {
  OM_INTEGRATION_TPAY_CLIENT_ID: 'client-id-1',
  OM_INTEGRATION_TPAY_CLIENT_SECRET: SECRET,
}

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

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('gateway_tpay preset', () => {
  it('returns null when no credential env is provided', async () => {
    expect(await readTpayEnvPreset({})).toBeNull()
    expect(await readTpayEnvPreset({ OM_INTEGRATION_TPAY_ENVIRONMENT: 'production' })).toBeNull()
  })

  it('throws without echoing secrets when only one credential is provided', async () => {
    const onlySecret = readTpayEnvPreset({ OM_INTEGRATION_TPAY_CLIENT_SECRET: SECRET })
    await expect(onlySecret).rejects.toThrow('Incomplete Tpay env preset')
    await expect(onlySecret).rejects.not.toThrow(SECRET)
    await expect(readTpayEnvPreset({ OM_INTEGRATION_TPAY_CLIENT_ID: 'client-id-1' })).rejects.toThrow(
      'Incomplete Tpay env preset',
    )
  })

  it('reads a complete env with sandbox and enabled defaults', async () => {
    const preset = await readTpayEnvPreset(baseEnv)
    expect(preset).toEqual({
      credentials: { clientId: 'client-id-1', clientSecret: SECRET, environment: 'sandbox' },
      force: false,
      enabled: true,
    })
  })

  it('reads optional notification settings and flags', async () => {
    const preset = await readTpayEnvPreset({
      ...baseEnv,
      OM_INTEGRATION_TPAY_ENVIRONMENT: 'production',
      OM_INTEGRATION_TPAY_NOTIFICATION_URL: 'https://shop.example.com/notifications/tpay',
      OM_INTEGRATION_TPAY_NOTIFICATION_SECURITY_CODE: SECURITY_CODE,
      OM_INTEGRATION_TPAY_ENABLED: 'false',
      OM_INTEGRATION_TPAY_FORCE_PRECONFIGURE: 'true',
    })
    expect(preset).toEqual({
      credentials: {
        clientId: 'client-id-1',
        clientSecret: SECRET,
        environment: 'production',
        notificationUrl: 'https://shop.example.com/notifications/tpay',
        notificationSecurityCode: SECURITY_CODE,
      },
      force: true,
      enabled: false,
    })
  })

  it('rejects an invalid environment without leaking secrets', async () => {
    const result = readTpayEnvPreset({ ...baseEnv, OM_INTEGRATION_TPAY_ENVIRONMENT: 'staging' })
    await expect(result).rejects.toThrow('OM_INTEGRATION_TPAY_ENVIRONMENT')
    await expect(result).rejects.not.toThrow(SECRET)
  })

  it('rejects an invalid notification url naming the variable and not the value', async () => {
    const invalidUrl = 'http://user:pass@shop.example.com/notify?token=abc'
    const result = readTpayEnvPreset({
      ...baseEnv,
      OM_INTEGRATION_TPAY_NOTIFICATION_URL: invalidUrl,
      OM_INTEGRATION_TPAY_NOTIFICATION_SECURITY_CODE: SECURITY_CODE,
    })
    await expect(result).rejects.toThrow('OM_INTEGRATION_TPAY_NOTIFICATION_URL')
    await expect(result).rejects.not.toThrow('pass')
    await expect(result).rejects.not.toThrow(SECURITY_CODE)
    await expect(result).rejects.not.toThrow(SECRET)
  })

  it('validates the notification url against the selected environment', async () => {
    const env = {
      ...baseEnv,
      OM_INTEGRATION_TPAY_NOTIFICATION_URL: 'http://shop.example.com/notifications/tpay',
    }
    await expect(readTpayEnvPreset(env)).resolves.not.toBeNull()
    await expect(
      readTpayEnvPreset({ ...env, OM_INTEGRATION_TPAY_ENVIRONMENT: 'production' }),
    ).rejects.toThrow('OM_INTEGRATION_TPAY_NOTIFICATION_URL')
  })

  it('does not honour legacy aliases', async () => {
    expect(
      await readTpayEnvPreset({ TPAY_CLIENT_ID: 'a', TPAY_CLIENT_SECRET: 'b', OPENMERCATO_TPAY_CLIENT_ID: 'c' }),
    ).toBeNull()
  })

  it('saves credentials, enabled state and default api version', async () => {
    const services = createServices()
    const result = await applyTpayEnvPreset({
      credentialsService: services.credentialsService,
      integrationStateService: services.integrationStateService,
      integrationLogService: services.integrationLogService,
      scope,
      env: { ...baseEnv, OM_INTEGRATION_TPAY_NOTIFICATION_SECURITY_CODE: SECURITY_CODE },
    })

    expect(result).toEqual({ status: 'configured', appliedApiVersion: 'v1', enabled: true })
    expect(services.save).toHaveBeenCalledWith(
      'gateway_tpay',
      {
        clientId: 'client-id-1',
        clientSecret: SECRET,
        environment: 'sandbox',
        notificationSecurityCode: SECURITY_CODE,
      },
      scope,
    )
    expect(services.upsert).toHaveBeenCalledWith('gateway_tpay', { isEnabled: true, apiVersion: 'v1' }, scope)
    expect(services.info).toHaveBeenCalledWith(expect.any(String), {
      enabled: true,
      apiVersion: 'v1',
      environment: 'sandbox',
    })
    expect(JSON.stringify(services.info.mock.calls)).not.toContain(SECRET)
  })

  it('stores a disabled state when the enabled flag is false', async () => {
    const services = createServices()
    const result = await applyTpayEnvPreset({
      credentialsService: services.credentialsService,
      integrationStateService: services.integrationStateService,
      scope,
      env: { ...baseEnv, OM_INTEGRATION_TPAY_ENABLED: 'false' },
    })
    expect(result).toEqual({ status: 'configured', appliedApiVersion: 'v1', enabled: false })
    expect(services.upsert).toHaveBeenCalledWith('gateway_tpay', { isEnabled: false, apiVersion: 'v1' }, scope)
  })

  it('skips when no preset env is present', async () => {
    const services = createServices()
    const result = await applyTpayEnvPreset({
      credentialsService: services.credentialsService,
      integrationStateService: services.integrationStateService,
      scope,
      env: {},
    })
    expect(result.status).toBe('skipped')
    expect(services.save).not.toHaveBeenCalled()
  })

  it.each([
    ['credentials', { credentials: { clientId: 'x' } }],
    ['state', { state: { isEnabled: true } }],
  ])('skips when %s already exist and force is off', async (_label, existing) => {
    const services = createServices(existing)
    const result = await applyTpayEnvPreset({
      credentialsService: services.credentialsService,
      integrationStateService: services.integrationStateService,
      scope,
      env: baseEnv,
    })
    expect(result.status).toBe('skipped')
    expect(services.save).not.toHaveBeenCalled()
    expect(services.upsert).not.toHaveBeenCalled()
  })

  it('overwrites existing configuration when force is set by param or env', async () => {
    const byParam = createServices({ credentials: { clientId: 'x' }, state: { isEnabled: false } })
    const paramResult = await applyTpayEnvPreset({
      credentialsService: byParam.credentialsService,
      integrationStateService: byParam.integrationStateService,
      scope,
      force: true,
      env: baseEnv,
    })
    expect(paramResult.status).toBe('configured')
    expect(byParam.save).toHaveBeenCalledTimes(1)

    const byEnv = createServices({ credentials: { clientId: 'x' } })
    const envResult = await applyTpayEnvPreset({
      credentialsService: byEnv.credentialsService,
      integrationStateService: byEnv.integrationStateService,
      scope,
      env: { ...baseEnv, OM_INTEGRATION_TPAY_FORCE_PRECONFIGURE: '1' },
    })
    expect(envResult.status).toBe('configured')
    expect(byEnv.upsert).toHaveBeenCalledTimes(1)
  })
})
