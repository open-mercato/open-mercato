import { asValue, createContainer } from 'awilix'
import type { CacheServiceOptions, CacheStrategy } from '@open-mercato/cache'
import { createCacheService } from '@open-mercato/cache'
import { bootstrap, getCachedCacheService } from '../bootstrap'

jest.mock('@open-mercato/cache', () => ({ createCacheService: jest.fn() }))
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

const createCacheServiceMock = jest.mocked(createCacheService)

function fakeCache(label: string): CacheStrategy & { label: string } {
  return {
    label,
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    has: jest.fn(async () => false),
    delete: jest.fn(async () => false),
    deleteByTags: jest.fn(async () => 0),
    clear: jest.fn(async () => 0),
    keys: jest.fn(async () => []),
    stats: jest.fn(async () => ({ size: 0, expired: 0 })),
    close: jest.fn(async () => {}),
  }
}

function failStockInitialization(memoryFallback: CacheStrategy) {
  createCacheServiceMock.mockImplementation((options?: CacheServiceOptions) => {
    if (options?.strategy === 'memory') return memoryFallback
    throw new Error('stock cache initialization failed')
  })
}

describe('core bootstrap cache fallback characterization', () => {
  const originalSingletonEnv = process.env.OM_CACHE_SINGLETON

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[CACHE_GLOBAL_KEY]
    delete (globalThis as Record<string, unknown>)[CACHE_SHUTDOWN_KEY]
    delete process.env.OM_CACHE_SINGLETON
    createCacheServiceMock.mockReset()
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[CACHE_GLOBAL_KEY]
    delete (globalThis as Record<string, unknown>)[CACHE_SHUTDOWN_KEY]
    if (originalSingletonEnv === undefined) delete process.env.OM_CACHE_SINGLETON
    else process.env.OM_CACHE_SINGLETON = originalSingletonEnv
    jest.restoreAllMocks()
  })

  it('getCachedCacheService falls back to an explicit memory strategy when stock initialization throws', () => {
    const memoryFallback = fakeCache('memory-fallback')
    failStockInitialization(memoryFallback)

    const service = getCachedCacheService()

    expect(service).toBe(memoryFallback)
    expect(createCacheServiceMock).toHaveBeenNthCalledWith(1)
    expect(createCacheServiceMock).toHaveBeenNthCalledWith(2, { strategy: 'memory' })
    expect(getCachedCacheService()).toBe(memoryFallback)
    expect(createCacheServiceMock).toHaveBeenCalledTimes(2)
  })

  it('bootstrap registers the memory fallback singleton when stock initialization throws', async () => {
    const memoryFallback = fakeCache('memory-fallback')
    failStockInitialization(memoryFallback)
    const container = createContainer().register({ em: asValue({}) })

    await bootstrap(container)

    expect(container.resolve('cache')).toBe(memoryFallback)
    expect(createCacheServiceMock).toHaveBeenCalledWith({ strategy: 'memory' })
    await container.dispose()
  })

  it('bootstrap builds a per-request cache when OM_CACHE_SINGLETON=off', async () => {
    process.env.OM_CACHE_SINGLETON = 'off'
    createCacheServiceMock.mockImplementation(() => fakeCache('per-request'))
    const first = createContainer().register({ em: asValue({}) })
    const second = createContainer().register({ em: asValue({}) })

    await bootstrap(first)
    await bootstrap(second)

    const firstCache = first.resolve<CacheStrategy>('cache')
    const secondCache = second.resolve<CacheStrategy>('cache')
    expect(firstCache).not.toBe(secondCache)
    expect(createCacheServiceMock).toHaveBeenCalledTimes(2)
    expect(createCacheServiceMock).toHaveBeenNthCalledWith(1)
    expect(createCacheServiceMock).toHaveBeenNthCalledWith(2)
    expect((globalThis as Record<string, unknown>)[CACHE_GLOBAL_KEY]).toBeUndefined()
    await first.dispose()
    await second.dispose()
  })

  it('bootstrap falls back to a per-request memory cache when the singleton is off and stock initialization throws', async () => {
    process.env.OM_CACHE_SINGLETON = 'off'
    const memoryFallback = fakeCache('memory-fallback')
    failStockInitialization(memoryFallback)
    const container = createContainer().register({ em: asValue({}) })

    await bootstrap(container)

    expect(container.resolve('cache')).toBe(memoryFallback)
    expect(createCacheServiceMock).toHaveBeenNthCalledWith(1)
    expect(createCacheServiceMock).toHaveBeenNthCalledWith(2, { strategy: 'memory' })
    await container.dispose()
  })
})
