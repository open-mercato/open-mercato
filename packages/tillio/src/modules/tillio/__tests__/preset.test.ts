import { TILLIO_INTEGRATION_ID } from '../integration'
import { TillioOperatorLimitError } from '../lib/operators'
import { TILLIO_OPERATORS_INTEGRATION_ID, type TillioCredentialsService } from '../lib/operators-store'
import { applyTillioEnvPreset, readTillioEnvPreset, TILLIO_ENV_VARS } from '../lib/preset'

jest.mock('../lib/operators', () => ({
  ...jest.requireActual('../lib/operators'),
  attachOperator: jest.fn(),
  detachOperator: jest.fn(),
}))

const { attachOperator, detachOperator } = jest.requireMock('../lib/operators')

const otherEnvironment = { apiUrl: 'https://other.example.com', apiKey: 'other-key' }

const attachedOperator = {
  id: 'ringostat-1',
  plugin: 'Ringostat' as const,
  config: { key: 'old' },
  token: 'tok-old',
  tenantDomain: 'tenant.example.com',
  envFingerprint: 'fp-old',
}

const scope = { tenantId: 'tn', organizationId: 'org' }

const completeEnv = {
  [TILLIO_ENV_VARS.apiUrl]: 'https://api.example.com',
  [TILLIO_ENV_VARS.apiKey]: 'key-1',
} as NodeJS.ProcessEnv

function fakeStore(initial: Record<string, Record<string, unknown> | null> = {}): {
  service: TillioCredentialsService
  store: Record<string, Record<string, unknown> | null>
} {
  const store: Record<string, Record<string, unknown> | null> = { ...initial }
  return {
    store,
    service: {
      getRaw: jest.fn(async (id: string) => store[id] ?? null),
      save: jest.fn(async (id: string, credentials: Record<string, unknown>) => {
        store[id] = credentials
      }),
    },
  }
}

function fakeServices(healthStatus = 'healthy') {
  return {
    integrationStateService: { upsert: jest.fn().mockResolvedValue(undefined) },
    integrationHealthService: { runHealthCheck: jest.fn().mockResolvedValue({ status: healthStatus }) },
  }
}

beforeEach(() => {
  attachOperator.mockReset()
  attachOperator.mockResolvedValue({ id: 'ringostat-1' })
  detachOperator.mockReset()
  detachOperator.mockResolvedValue({ ok: true, detached: true, revoked: true })
})

describe('readTillioEnvPreset', () => {
  it('reports absent when no Tillio variable is set', () => {
    expect(readTillioEnvPreset({} as NodeJS.ProcessEnv)).toEqual({ status: 'absent' })
  })

  it('names the missing variable when the preset is half configured', () => {
    const preset = readTillioEnvPreset({ [TILLIO_ENV_VARS.apiUrl]: 'https://api.example.com' } as NodeJS.ProcessEnv)

    expect(preset).toEqual({ status: 'incomplete', missing: [TILLIO_ENV_VARS.apiKey] })
  })

  it('treats a blank value as unset', () => {
    const preset = readTillioEnvPreset({ ...completeEnv, [TILLIO_ENV_VARS.apiKey]: '   ' } as NodeJS.ProcessEnv)

    expect(preset).toEqual({ status: 'incomplete', missing: [TILLIO_ENV_VARS.apiKey] })
  })

  it('carries a configured time zone into the credentials and rejects an invalid one', () => {
    const preset = readTillioEnvPreset({ ...completeEnv, [TILLIO_ENV_VARS.timeZone]: 'America/New_York' } as NodeJS.ProcessEnv)

    expect(preset).toMatchObject({ credentials: { timeZone: 'America/New_York' } })
    expect(() => readTillioEnvPreset({ ...completeEnv, [TILLIO_ENV_VARS.timeZone]: 'Europe/Atlantis' } as NodeJS.ProcessEnv))
      .toThrow()
  })

  it('reads a complete preset with the operator key and the force flag', () => {
    const preset = readTillioEnvPreset({
      ...completeEnv,
      [TILLIO_ENV_VARS.ringostatKey]: 'ringostat-key',
      [TILLIO_ENV_VARS.force]: 'true',
    } as NodeJS.ProcessEnv)

    expect(preset).toEqual({
      status: 'ready',
      credentials: { apiUrl: 'https://api.example.com', apiKey: 'key-1' },
      ringostatKey: 'ringostat-key',
      force: true,
      replaceOperator: false,
    })
  })
})

describe('applyTillioEnvPreset', () => {
  it('saves credentials, enables the integration and runs the health check', async () => {
    const { service, store } = fakeStore()
    const services = fakeServices()

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...services,
      scope,
      env: completeEnv,
    })

    expect(result).toEqual({
      status: 'applied',
      credentialsAction: 'saved',
      health: 'healthy',
      operator: 'not-requested',
    })
    expect(store[TILLIO_INTEGRATION_ID]).toEqual({ apiUrl: 'https://api.example.com', apiKey: 'key-1' })
    expect(services.integrationStateService.upsert).toHaveBeenCalledWith(
      TILLIO_INTEGRATION_ID,
      { isEnabled: true },
      scope,
    )
    expect(services.integrationHealthService.runHealthCheck).toHaveBeenCalledWith(TILLIO_INTEGRATION_ID, scope)
    expect(attachOperator).not.toHaveBeenCalled()
  })

  it('attaches the operator through the same call the UI route makes', async () => {
    const { service } = fakeStore()
    const services = fakeServices()

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...services,
      scope,
      appUrl: 'https://app.example.com',
      env: { ...completeEnv, [TILLIO_ENV_VARS.ringostatKey]: 'ringostat-key' },
    })

    expect(result).toMatchObject({ operator: 'attached' })
    expect(attachOperator).toHaveBeenCalledWith(
      { credentialsService: service, scope, appUrl: 'https://app.example.com' },
      { plugin: 'Ringostat', config: { key: 'ringostat-key' } },
    )
  })

  it('reports the operator as kept when the slot is already taken', async () => {
    attachOperator.mockRejectedValue(new TillioOperatorLimitError())
    const { service } = fakeStore()

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...fakeServices(),
      scope,
      appUrl: 'https://app.example.com',
      env: { ...completeEnv, [TILLIO_ENV_VARS.ringostatKey]: 'ringostat-key' },
    })

    expect(result).toMatchObject({ operator: 'kept' })
  })

  it('does not attach against an environment the health check rejected', async () => {
    const { service } = fakeStore()

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...fakeServices('unhealthy'),
      scope,
      appUrl: 'https://app.example.com',
      env: { ...completeEnv, [TILLIO_ENV_VARS.ringostatKey]: 'ringostat-key' },
    })

    expect(result).toMatchObject({ health: 'unhealthy', operator: 'failed' })
    expect(attachOperator).not.toHaveBeenCalled()
  })

  it('writes nothing on an incomplete preset and reports the missing variable', async () => {
    const { service } = fakeStore()
    const services = fakeServices()

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...services,
      scope,
      env: { [TILLIO_ENV_VARS.apiKey]: 'key-1' } as NodeJS.ProcessEnv,
    })

    expect(result).toEqual({
      status: 'skipped',
      reason: `Incomplete Tillio env preset; missing ${TILLIO_ENV_VARS.apiUrl}.`,
    })
    expect(service.save).not.toHaveBeenCalled()
    expect(services.integrationStateService.upsert).not.toHaveBeenCalled()
    expect(services.integrationHealthService.runHealthCheck).not.toHaveBeenCalled()
  })

  it('keeps credentials that already exist unless forced', async () => {
    const existing = { apiUrl: 'https://rotated.example.com', apiKey: 'rotated' }
    const { service, store } = fakeStore({ [TILLIO_INTEGRATION_ID]: existing })

    const kept = await applyTillioEnvPreset({
      credentialsService: service,
      ...fakeServices(),
      scope,
      env: completeEnv,
    })

    expect(kept).toMatchObject({ credentialsAction: 'kept' })
    expect(store[TILLIO_INTEGRATION_ID]).toEqual(existing)

    const forced = await applyTillioEnvPreset({
      credentialsService: service,
      ...fakeServices(),
      scope,
      env: { ...completeEnv, [TILLIO_ENV_VARS.force]: 'true' },
    })

    expect(forced).toMatchObject({ credentialsAction: 'saved' })
    expect(store[TILLIO_INTEGRATION_ID]).toEqual({ apiUrl: 'https://api.example.com', apiKey: 'key-1' })
  })

  it('refuses to switch environments while an operator is attached', async () => {
    const { service, store } = fakeStore({
      [TILLIO_INTEGRATION_ID]: otherEnvironment,
      [TILLIO_OPERATORS_INTEGRATION_ID]: { operators: [attachedOperator], defaultOperatorId: attachedOperator.id },
    })

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...fakeServices(),
      scope,
      appUrl: 'https://app.example.com',
      env: {
        ...completeEnv,
        [TILLIO_ENV_VARS.ringostatKey]: 'ringostat-key',
        [TILLIO_ENV_VARS.force]: 'true',
      },
    })

    expect(result.status).toBe('blocked')
    expect(detachOperator).not.toHaveBeenCalled()
    expect(store[TILLIO_INTEGRATION_ID]).toEqual(otherEnvironment)
  })

  it('revokes the attached operator before the switch once it is confirmed', async () => {
    const { service, store } = fakeStore({
      [TILLIO_INTEGRATION_ID]: otherEnvironment,
      [TILLIO_OPERATORS_INTEGRATION_ID]: { operators: [attachedOperator], defaultOperatorId: attachedOperator.id },
    })
    const confirmOperatorReplacement = jest.fn().mockResolvedValue(true)

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...fakeServices(),
      scope,
      appUrl: 'https://app.example.com',
      confirmOperatorReplacement,
      env: {
        ...completeEnv,
        [TILLIO_ENV_VARS.ringostatKey]: 'ringostat-key',
        [TILLIO_ENV_VARS.force]: 'true',
      },
    })

    expect(confirmOperatorReplacement).toHaveBeenCalledWith(attachedOperator)
    // Revoked while the old credentials are still stored, otherwise the token cannot be revoked at all.
    expect(detachOperator.mock.invocationCallOrder[0])
      .toBeLessThan((service.save as jest.Mock).mock.invocationCallOrder.at(-1) as number)
    expect(store[TILLIO_INTEGRATION_ID]).toEqual({ apiUrl: 'https://api.example.com', apiKey: 'key-1' })
    expect(result).toMatchObject({ credentialsAction: 'saved', operator: 'attached' })
  })

  it('takes the env variable as the answer for unattended runs', async () => {
    const { service } = fakeStore({
      [TILLIO_INTEGRATION_ID]: otherEnvironment,
      [TILLIO_OPERATORS_INTEGRATION_ID]: { operators: [attachedOperator], defaultOperatorId: attachedOperator.id },
    })

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...fakeServices(),
      scope,
      appUrl: 'https://app.example.com',
      env: {
        ...completeEnv,
        [TILLIO_ENV_VARS.ringostatKey]: 'ringostat-key',
        [TILLIO_ENV_VARS.force]: 'true',
        [TILLIO_ENV_VARS.replaceOperator]: 'true',
      },
    })

    expect(detachOperator).toHaveBeenCalled()
    expect(result).toMatchObject({ operator: 'attached' })
  })

  it('refuses the switch when no key is available to reattach the operator', async () => {
    const { service } = fakeStore({
      [TILLIO_INTEGRATION_ID]: otherEnvironment,
      [TILLIO_OPERATORS_INTEGRATION_ID]: { operators: [attachedOperator], defaultOperatorId: attachedOperator.id },
    })

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...fakeServices(),
      scope,
      env: { ...completeEnv, [TILLIO_ENV_VARS.force]: 'true', [TILLIO_ENV_VARS.replaceOperator]: 'true' },
    })

    expect(result.status).toBe('blocked')
    expect(detachOperator).not.toHaveBeenCalled()
  })

  it('leaves the operator store untouched when no preset is present', async () => {
    const { service } = fakeStore()
    const services = fakeServices()

    const result = await applyTillioEnvPreset({
      credentialsService: service,
      ...services,
      scope,
      env: {} as NodeJS.ProcessEnv,
    })

    expect(result.status).toBe('skipped')
    expect(service.save).not.toHaveBeenCalled()
    expect(service.getRaw).not.toHaveBeenCalledWith(TILLIO_OPERATORS_INTEGRATION_ID, scope)
  })
})
