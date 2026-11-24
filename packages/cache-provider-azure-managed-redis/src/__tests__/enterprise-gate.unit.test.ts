import {
  defineCacheProviderRegistration,
  prepareCacheProviderSelection,
  resetCacheProviderSelectionForTests,
  resolveCacheProvider,
  setCacheProviderRegistrations,
} from '@open-mercato/cache/provider'
import type { CacheProviderRegistration } from '@open-mercato/cache/provider'
import { createCacheService } from '@open-mercato/cache/service'
import {
  defineEnterpriseCacheProviderRegistration,
  ENTERPRISE_CACHE_PROVIDERS_ENV,
  ENTERPRISE_MODULES_ENV,
  isEnterpriseCacheProviderActivationEnabled,
  OFFICIAL_MANAGED_CACHE_PROVIDER_IDS,
  provider,
} from '../index'
import { GATE_FIXTURE } from './gate-fixture'

const PROVIDER_ID = provider.id
const SECRET = 'gate-secret-never-printed'
const ENV_KEYS = [ENTERPRISE_MODULES_ENV, ENTERPRISE_CACHE_PROVIDERS_ENV, 'CACHE_PROVIDER', 'CACHE_PROVIDER_NAMESPACE'] as const

function setEnv(values: Partial<Record<typeof ENV_KEYS[number], string>>): void {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, values)
}

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
      return { ...GATE_FIXTURE.validSettings, secretProbe: SECRET }
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
    await expectGateFailure(async () => resolved!.definition.create(resolved!.config, {} as never))
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
    const valid = defineEnterpriseCacheProviderRegistration({ id: PROVIDER_ID, load: async () => provider, settings: () => GATE_FIXTURE.validSettings })
    const enabled = await resolveCacheProvider([valid])
    delete process.env[ENTERPRISE_CACHE_PROVIDERS_ENV]
    await expectGateFailure(async () => enabled!.definition.create(enabled!.config, {} as never))
    expect(connectSpy).not.toHaveBeenCalled()
  })

  it('enabled gate validates the real settings and reports field paths only', async () => {
    setEnv({ [ENTERPRISE_MODULES_ENV]: 'true', [ENTERPRISE_CACHE_PROVIDERS_ENV]: 'true', CACHE_PROVIDER: PROVIDER_ID, CACHE_PROVIDER_NAMESPACE: 'gate-on' })
    const registration = defineEnterpriseCacheProviderRegistration({
      id: PROVIDER_ID,
      load: async () => provider,
      settings: () => ({ ...GATE_FIXTURE.validSettings, password: SECRET }),
    })
    const failure = await resolveCacheProvider([registration]).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'invalid_settings' })
    expect(JSON.stringify(failure)).not.toContain(SECRET)
    const ok = defineEnterpriseCacheProviderRegistration({ id: PROVIDER_ID, load: async () => provider, settings: () => GATE_FIXTURE.validSettings })
    const resolved = await resolveCacheProvider([ok])
    expect(resolved?.placement).toBe('shared')
    expect(resolved?.definition.redact?.(resolved.config)).not.toEqual({ enterpriseActivation: 'disabled' })
  })
})
