import {
  createCacheProviderHostContext,
  defineCacheProviderRegistration,
  prepareCacheProviderSelection,
  resetCacheProviderSelectionForTests,
  resolveCacheProvider,
  setCacheProviderRegistrations,
} from '@open-mercato/cache/provider'
import type { CacheProviderDefinition, CacheProviderEnv, CacheProviderRegistration } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import {
  defineEnterpriseCacheProviderRegistration,
  ENTERPRISE_CACHE_PROVIDERS_ENV,
  ENTERPRISE_MODULES_ENV,
  isEnterpriseCacheProviderActivationEnabled,
  OFFICIAL_MANAGED_CACHE_PROVIDER_IDS,
} from '../src/enterprise'
import type { EnterpriseCacheProviderRegistrationOptions, OfficialManagedCacheProviderId } from '../src/enterprise'

const SECRET = 'gate-secret-never-printed'
const ENV_KEYS = [ENTERPRISE_MODULES_ENV, ENTERPRISE_CACHE_PROVIDERS_ENV, 'CACHE_PROVIDER', 'CACHE_PROVIDER_NAMESPACE'] as const

function setEnv(values: Partial<Record<typeof ENV_KEYS[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, values)
}

export type EnterpriseGateSuiteOptions<TConfig> = {
  /** Build the package's (gated) provider definition; `env` is the env its gate reads. */
  createProvider(options?: { env?: CacheProviderEnv }): CacheProviderDefinition<TConfig>
  /** The package's exported gated registration helper. */
  registration(options: EnterpriseCacheProviderRegistrationOptions): CacheProviderRegistration
  /** Raw settings the provider accepts once the gate is open. */
  validSettings: Record<string, unknown>
}

/**
 * Enterprise activation gate suite for an official managed provider: with the
 * gate closed, web, worker and maintenance paths fail with a sanitized
 * `unavailable` error, never load the provider, never evaluate settings and
 * never connect; with it open, the real settings schema applies.
 */
export function defineEnterpriseGateSuite<TConfig>(options: EnterpriseGateSuiteOptions<TConfig>): void {
  const { validSettings } = options
  const provider = options.createProvider()
  const PROVIDER_ID = provider.id as OfficialManagedCacheProviderId

  function trackingRegistrations(): { registrations: CacheProviderRegistration[]; calls: { load: number; settings: number } } {
    const calls = { load: 0, settings: 0 }
    const registration = defineEnterpriseCacheProviderRegistration({
      id: PROVIDER_ID,
      load: async () => {
        calls.load += 1
        return provider
      },
      settings: () => {
        calls.settings += 1
        return { ...validSettings, secretProbe: SECRET }
      },
    })
    return { registrations: [registration], calls }
  }

  async function expectGateFailure(operation: () => Promise<unknown>): Promise<void> {
    const failure = await operation().then(() => null, (error: unknown) => error)
    expect(failure).toMatchObject({ name: 'CacheProviderError', code: 'unavailable', providerId: PROVIDER_ID })
    const text = `${(failure as Error).message} ${JSON.stringify(failure)}`
    expect(text).toContain(ENTERPRISE_MODULES_ENV)
    expect(text).toContain(ENTERPRISE_CACHE_PROVIDERS_ENV)
    expect(text).toContain('no local cache fallback')
    expect(text).not.toContain(SECRET)
  }

  describe(`${PROVIDER_ID} enterprise activation gate`, () => {
    const originalEnv = { ...process.env }
    let connectSpy: jest.SpyInstance

    beforeEach(() => {
      resetCacheProviderSelectionForTests()
      const ioredis = jest.requireActual<typeof import('ioredis')>('ioredis')
      connectSpy = jest.spyOn(ioredis.Redis.prototype, 'connect')
    })

    afterEach(() => {
      connectSpy.mockRestore()
      for (const key of ENV_KEYS) delete process.env[key]
      Object.assign(process.env, originalEnv)
      resetCacheProviderSelectionForTests()
    })

    it('reserves exactly the three official managed provider ids', () => {
      expect([...OFFICIAL_MANAGED_CACHE_PROVIDER_IDS]).toEqual([
        'open-mercato/azure-managed-redis',
        'open-mercato/aws-elasticache',
        'open-mercato/google-memorystore',
      ])
      expect(OFFICIAL_MANAGED_CACHE_PROVIDER_IDS).toContain(PROVIDER_ID)
      expect(() => defineEnterpriseCacheProviderRegistration({
        id: 'acme/redis' as typeof PROVIDER_ID,
        load: async () => provider,
        settings: () => ({}),
      })).toThrow(expect.objectContaining({ code: 'invalid_registration' }))
    })

    it.each([
      [{}, false],
      [{ [ENTERPRISE_MODULES_ENV]: 'true' }, false],
      [{ [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'true' }, false],
      [{ [ENTERPRISE_MODULES_ENV]: 'true', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'false' }, false],
      [{ [ENTERPRISE_MODULES_ENV]: 'yes', [ENTERPRISE_CACHE_PROVIDERS_ENV]: '1' }, true],
      [{ [ENTERPRISE_MODULES_ENV]: ' TRUE ', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'on' }, true],
    ])('requires both the Enterprise flag and the cache-provider sub-flag (%j)', (env, expected) => {
      expect(isEnterpriseCacheProviderActivationEnabled(env)).toBe(expected)
    })

    it('web bootstrap: selection succeeds without loading the provider or evaluating settings, first use fails with no fallback', async () => {
      setEnv({ CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-web' })
      const { registrations, calls } = trackingRegistrations()
      setCacheProviderRegistrations(registrations)
      const resolved = await prepareCacheProviderSelection()
      expect(resolved?.id).toBe(PROVIDER_ID)
      expect(calls).toEqual({ load: 0, settings: 0 })
      expect(resolved?.definition.redact?.(resolved.config)).toEqual({ enterpriseActivation: 'disabled' })
      const cache = createCacheService()
      await expectGateFailure(() => cache.set('k', 'v'))
      await expectGateFailure(() => cache.get('k'))
      await expectGateFailure(() => cache.healthcheck!())
      expect(connectSpy).not.toHaveBeenCalled()
      await cache.close?.()
    })

    it('worker path: a separately created service over the prepared selection fails the same way', async () => {
      setEnv({ CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-worker' })
      const { registrations, calls } = trackingRegistrations()
      const resolved = await resolveCacheProvider(registrations)
      const workerCache = createCacheService({ provider: resolved! })
      await expectGateFailure(() => workerCache.deleteByTags(['records']))
      expect(calls).toEqual({ load: 0, settings: 0 })
      expect(connectSpy).not.toHaveBeenCalled()
      await workerCache.close?.()
    })

    it('maintenance path: structural purge style keys()/clear() fail without connecting', async () => {
      setEnv({ CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-maint' })
      const { registrations } = trackingRegistrations()
      setCacheProviderRegistrations(registrations)
      await prepareCacheProviderSelection()
      const maintenance = createCacheService()
      await expectGateFailure(() => maintenance.keys('nav:*'))
      await expectGateFailure(() => maintenance.clear())
      expect(connectSpy).not.toHaveBeenCalled()
      await maintenance.close?.()
    })

    it('direct registration of the definition is gated too: settings are not inspected and create() refuses', async () => {
      setEnv({ CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-direct' })
      const registration = defineCacheProviderRegistration({
        id: PROVIDER_ID,
        load: async () => provider,
        settings: () => ({ totally: 'invalid', secretProbe: SECRET }),
      })
      const resolved = await resolveCacheProvider([registration])
      expect(resolved).not.toBeNull()
      await expectGateFailure(async () => resolved!.definition.create(resolved!.config, createCacheProviderHostContext(resolved!)))
      const cache = createCacheService({ provider: resolved! })
      await expectGateFailure(() => cache.get('x'))
      await cache.close?.()
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it('a gate that closes after resolution still blocks create() before any client work', async () => {
      setEnv({ [ENTERPRISE_MODULES_ENV]: 'true', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'true', CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-late' })
      const { registrations, calls } = trackingRegistrations()
      const resolved = await resolveCacheProvider(registrations).catch((error: unknown) => error)
      expect(calls.load).toBe(1)
      expect(calls.settings).toBe(1)
      expect(resolved).toMatchObject({ code: 'invalid_settings' })
      const valid = defineEnterpriseCacheProviderRegistration({ id: PROVIDER_ID, load: async () => provider, settings: () => validSettings })
      const enabled = await resolveCacheProvider([valid])
      delete process.env[ENTERPRISE_CACHE_PROVIDERS_ENV]
      await expectGateFailure(async () => enabled!.definition.create(enabled!.config, createCacheProviderHostContext(enabled!)))
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it('enabled gate validates the real settings and reports field paths only', async () => {
      setEnv({ [ENTERPRISE_MODULES_ENV]: 'true', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'true', CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-on' })
      const registration = defineEnterpriseCacheProviderRegistration({
        id: PROVIDER_ID,
        load: async () => provider,
        settings: () => ({ ...validSettings, password: SECRET }),
      })
      const failure = await resolveCacheProvider([registration]).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'invalid_settings' })
      expect(JSON.stringify(failure)).not.toContain(SECRET)
      const ok = defineEnterpriseCacheProviderRegistration({ id: PROVIDER_ID, load: async () => provider, settings: () => validSettings })
      const resolved = await resolveCacheProvider([ok])
      expect(resolved?.placement).toBe('shared')
      expect(resolved?.definition.redact?.(resolved.config)).not.toEqual({ enterpriseActivation: 'disabled' })
    })

    it('the exported registration helper honours the env passed by the host, not process.env', async () => {
      const open = { [ENTERPRISE_MODULES_ENV]: 'true', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'true', CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-env' }
      const closed = { CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-env' }

      setEnv({ [ENTERPRISE_MODULES_ENV]: 'true', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'true' })
      let evaluated = 0
      const closedResolved = await resolveCacheProvider([options.registration({ env: closed, settings: () => { evaluated += 1; return validSettings } })], { env: closed })
      expect(evaluated).toBe(0)
      expect(closedResolved?.definition.redact?.(closedResolved.config)).toEqual({ enterpriseActivation: 'disabled' })
      await expectGateFailure(async () => closedResolved!.definition.create(closedResolved!.config, createCacheProviderHostContext(closedResolved!)))

      setEnv({})
      const openResolved = await resolveCacheProvider([options.registration({ env: open, settings: () => validSettings })], { env: open })
      expect(openResolved?.definition.redact?.(openResolved.config)).not.toEqual({ enterpriseActivation: 'disabled' })
      const invalid = await resolveCacheProvider([options.registration({ env: open, settings: () => ({ totally: 'invalid' }) })], { env: open }).catch((error: unknown) => error)
      expect(invalid).toMatchObject({ code: 'invalid_settings' })

      const gatedByEnv = options.createProvider({ env: closed })
      setEnv({ [ENTERPRISE_MODULES_ENV]: 'true', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'true' })
      expect(gatedByEnv.settings.safeParse({ totally: 'invalid' }).success).toBe(true)
      expect(connectSpy).not.toHaveBeenCalled()
    })

    it('without an explicit env the registration helper reads process.env at call time', async () => {
      setEnv({ CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-default-env' })
      const registration = options.registration({ settings: () => validSettings })
      const closedResolved = await resolveCacheProvider([registration])
      expect(closedResolved?.definition.redact?.(closedResolved.config)).toEqual({ enterpriseActivation: 'disabled' })
      setEnv({ [ENTERPRISE_MODULES_ENV]: 'true', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'true', CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-default-env' })
      const openResolved = await resolveCacheProvider([registration])
      expect(openResolved?.definition.redact?.(openResolved.config)).not.toEqual({ enterpriseActivation: 'disabled' })
    })
  })
}
