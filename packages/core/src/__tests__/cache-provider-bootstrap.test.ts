import { asValue, createContainer } from 'awilix'
import type { CacheStrategy } from '@open-mercato/cache'
import { createMemoryStrategy } from '@open-mercato/cache/strategies/memory'
import {
  CacheProviderError,
  defineCacheProvider,
  defineCacheProviderRegistration,
  resetCacheProviderSelectionForTests,
  setCacheProviderRegistrations,
  type CacheProviderRegistration,
} from '@open-mercato/cache/provider'
import { bootstrap, bootstrapProcessRoot, getCachedCacheService } from '../bootstrap'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const stubLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: () => stubLogger,
  }
  return { createLogger: () => stubLogger }
})
jest.mock('@open-mercato/events/index', () => jest.requireActual('../../../events/src/index'), { virtual: true })
jest.mock('@open-mercato/shared/lib/ratelimit/service', () => ({
  RateLimiterService: class {
    initialize() { return Promise.resolve() }
    destroy() { return Promise.resolve() }
  },
}))
jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({
  createKmsService: jest.fn(() => ({ isHealthy: () => true })),
}))
jest.mock('@open-mercato/shared/lib/encryption/tenantDataEncryptionService', () => ({
  TenantDataEncryptionService: class {
    constructor(readonly em: unknown, readonly options: unknown) {}
  },
}))
jest.mock('@open-mercato/shared/lib/encryption/subscriber', () => ({ registerTenantEncryptionSubscriber: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({ isTenantDataEncryptionEnabled: () => false }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ getModules: () => [] }))
jest.mock('@open-mercato/shared/modules/search', () => ({ getSearchModuleConfigs: () => [] }))
jest.mock('@open-mercato/search/di', () => ({ registerScopedSearchModule: jest.fn() }), { virtual: true })
jest.mock('@open-mercato/search', () => ({
  registerSearchModule: jest.fn(),
  searchDeleteMetadata: { event: 'search.delete_record', persistent: false },
  createSearchDeleteSubscriber: jest.fn(),
}), { virtual: true })

const CACHE_GLOBAL_KEY = '__openMercatoCacheService__'
const CACHE_SHUTDOWN_KEY = '__openMercatoCacheShutdown__'
const PROVIDER_ID = 'acme/fake'
const ENV_KEYS = ['CACHE_PROVIDER', 'CACHE_PROVIDER_NAMESPACE', 'CACHE_STRATEGY', 'OM_CACHE_SINGLETON'] as const

type FakeProvider = {
  registration: CacheProviderRegistration
  create: jest.Mock
  close: jest.Mock
}

function fakeProvider(): FakeProvider {
  const close = jest.fn(async () => {})
  const create = jest.fn(() => {
    const base = createMemoryStrategy()
    return { ...base, healthcheck: jest.fn(async () => {}), close }
  })
  const definition = defineCacheProvider<Record<string, never>>({
    id: PROVIDER_ID,
    settings: { safeParse: () => ({ success: true, data: {} }) },
    capability: () => ({ placement: 'shared' }),
    create,
  })
  const registration = defineCacheProviderRegistration({
    id: PROVIDER_ID,
    load: async () => definition,
    settings: () => ({}),
  })
  return { registration, create, close }
}

function clearCacheGlobals(): void {
  const scope = globalThis as Record<string, unknown>
  const existing = scope[CACHE_GLOBAL_KEY] as CacheStrategy | undefined
  void existing?.close?.()
  delete scope[CACHE_GLOBAL_KEY]
  delete scope[CACHE_SHUTDOWN_KEY]
}

describe('core bootstrap cache provider resolution', () => {
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}

  beforeAll(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
  })

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
    clearCacheGlobals()
    resetCacheProviderSelectionForTests()
  })

  afterEach(() => {
    clearCacheGlobals()
    resetCacheProviderSelectionForTests()
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key]
      else process.env[key] = originalEnv[key]
    }
  })

  it('prepares the selected provider and registers a provider-backed cache', async () => {
    const provider = fakeProvider()
    setCacheProviderRegistrations([provider.registration])
    process.env.CACHE_PROVIDER = PROVIDER_ID
    process.env.CACHE_PROVIDER_NAMESPACE = 'test-ns'
    const container = createContainer().register({ em: asValue({}) })

    await bootstrap(container)

    const cache = container.resolve<CacheStrategy>('cache')
    await cache.set('greeting', 'hello')
    expect(await cache.get('greeting')).toBe('hello')
    expect(provider.create).toHaveBeenCalledTimes(1)
    expect(provider.create.mock.calls[0][1]).toMatchObject({ namespace: 'test-ns' })
    await container.dispose()
  })

  it('propagates a provider selection error instead of falling back to memory', async () => {
    setCacheProviderRegistrations([])
    process.env.CACHE_PROVIDER = PROVIDER_ID
    process.env.CACHE_PROVIDER_NAMESPACE = 'test-ns'
    const container = createContainer().register({ em: asValue({}) })

    await expect(bootstrap(container)).rejects.toMatchObject({ name: 'CacheProviderError', code: 'not_registered' })

    expect(container.hasRegistration('cache')).toBe(false)
    expect((globalThis as Record<string, unknown>)[CACHE_GLOBAL_KEY]).toBeUndefined()
    await container.dispose()
  })

  it('propagates provider errors from the process-root bootstrap path', async () => {
    const provider = fakeProvider()
    setCacheProviderRegistrations([provider.registration])
    process.env.CACHE_PROVIDER = PROVIDER_ID
    const root = createContainer()

    await expect(bootstrapProcessRoot(root)).rejects.toMatchObject({ code: 'missing_namespace' })

    expect(root.hasRegistration('cache')).toBe(false)
    expect(provider.create).not.toHaveBeenCalled()
    await root.dispose()
  })

  it('getCachedCacheService rethrows when a provider is selected but never prepared', () => {
    setCacheProviderRegistrations([fakeProvider().registration])
    process.env.CACHE_PROVIDER = PROVIDER_ID
    process.env.CACHE_PROVIDER_NAMESPACE = 'test-ns'

    let thrown: unknown
    try {
      getCachedCacheService()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CacheProviderError)
    expect((thrown as CacheProviderError).code).toBe('not_resolved')
    expect((globalThis as Record<string, unknown>)[CACHE_GLOBAL_KEY]).toBeUndefined()
  })

  it('keeps one provider-backed process singleton even when OM_CACHE_SINGLETON=off', async () => {
    const provider = fakeProvider()
    setCacheProviderRegistrations([provider.registration])
    process.env.CACHE_PROVIDER = PROVIDER_ID
    process.env.CACHE_PROVIDER_NAMESPACE = 'test-ns'
    process.env.OM_CACHE_SINGLETON = 'off'
    const first = createContainer().register({ em: asValue({}) })
    const second = createContainer().register({ em: asValue({}) })

    await bootstrap(first)
    await bootstrap(second)

    const firstCache = first.resolve<CacheStrategy>('cache')
    expect(second.resolve<CacheStrategy>('cache')).toBe(firstCache)
    await firstCache.has('warm-up')
    expect(provider.create).toHaveBeenCalledTimes(1)
    await first.dispose()
    await second.dispose()
  })

  it('leaves stock selection untouched when no provider is selected', async () => {
    const provider = fakeProvider()
    setCacheProviderRegistrations([provider.registration])
    process.env.CACHE_STRATEGY = 'memory'
    const container = createContainer().register({ em: asValue({}) })

    await bootstrap(container)

    const cache = container.resolve<CacheStrategy>('cache')
    await cache.set('stock', 1)
    expect(await cache.get('stock')).toBe(1)
    expect(provider.create).not.toHaveBeenCalled()
    await container.dispose()
  })
})
