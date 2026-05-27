// Unit tests for the Phase 5 process-scoped bootstrap once-guard.
//
// The once-guard caches `cache`, `eventBus`, `kmsService`, etc. on
// `globalThis` after the first `createRequestContainer()` call so that
// subsequent calls in the same process re-register those services
// directly without re-importing `@open-mercato/core/bootstrap`.
// `registerDiRegistrars` clears the cache so HMR sees fresh subscribers.
// `OM_BOOTSTRAP_CACHE` gates the whole behavior; default OFF.

import { asValue } from 'awilix'

// Mock the deep ORM/engine imports BEFORE importing container.ts so we can
// exercise the bootstrap once-guard without pulling in MikroORM decorators.
jest.mock(
  '@open-mercato/shared/lib/db/mikro',
  () => {
    const baseEm: any = {
      fork: () => baseEm,
      getRepository: () => ({ find: async () => [], findOne: async () => null }),
    }
    return {
      __esModule: true,
      getOrm: async () => ({ em: baseEm }),
      getOrmEntities: () => [],
      registerOrmEntities: () => {},
    }
  },
  { virtual: false },
)

jest.mock(
  '@mikro-orm/core',
  () => ({
    __esModule: true,
    RequestContext: { getEntityManager: () => null },
  }),
  { virtual: true },
)

jest.mock(
  '@open-mercato/shared/lib/query/engine',
  () => ({ __esModule: true, BasicQueryEngine: class {} }),
  { virtual: false },
)

jest.mock(
  '@open-mercato/shared/lib/data/engine',
  () => ({ __esModule: true, DefaultDataEngine: class {} }),
  { virtual: false },
)

jest.mock(
  '@open-mercato/shared/lib/commands',
  () => ({
    __esModule: true,
    commandRegistry: {},
    CommandBus: class { constructor() {} },
  }),
  { virtual: false },
)

jest.mock(
  '@open-mercato/shared/modules/overrides',
  () => ({
    __esModule: true,
    applyDiOverridesToContainer: () => {},
  }),
  { virtual: false },
)

const {
  registerDiRegistrars,
  resetBootstrapCache,
} = require('@open-mercato/shared/lib/di/container')

const bootstrapMock = jest.fn(async (container: any) => {
  container.register({
    cache: asValue({ __value: 'cache-value' }),
    eventBus: asValue({ __value: 'event-bus-value' }),
    tenantEncryptionService: asValue({ isEnabled: () => true, __value: 'enc' }),
  })
})

jest.mock(
  '@open-mercato/core/bootstrap',
  () => ({
    __esModule: true,
    bootstrap: (...args: unknown[]) => bootstrapMock(...args as [any]),
  }),
  { virtual: true },
)

const subscriberRegistered = jest.fn()
jest.mock(
  '@open-mercato/shared/lib/encryption/subscriber',
  () => ({
    __esModule: true,
    registerTenantEncryptionSubscriber: (...args: unknown[]) => subscriberRegistered(...args),
  }),
  { virtual: true },
)

const ORIGINAL_FLAG = process.env.OM_BOOTSTRAP_CACHE

describe('bootstrap once-guard cache', () => {
  beforeEach(() => {
    resetBootstrapCache()
    bootstrapMock.mockClear()
    subscriberRegistered.mockClear()
    registerDiRegistrars([])
  })

  afterAll(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.OM_BOOTSTRAP_CACHE
    else process.env.OM_BOOTSTRAP_CACHE = ORIGINAL_FLAG
  })

  it('resetBootstrapCache clears the process-scoped bootstrap cache and encryption flag', () => {
    const g = globalThis as Record<string, unknown>
    g.__openMercatoBootstrapCache__ = { cache: { tag: 'memo' } }
    g.__openMercatoEncryptionEnabledCache__ = true
    resetBootstrapCache()
    expect(g.__openMercatoBootstrapCache__).toBeNull()
    expect(g.__openMercatoEncryptionEnabledCache__).toBeUndefined()
  })

  it('runs bootstrap() on the first createRequestContainer() and replays cached services on the second when OM_BOOTSTRAP_CACHE=1', async () => {
    process.env.OM_BOOTSTRAP_CACHE = '1'
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const first = await createRequestContainer()
    expect(bootstrapMock).toHaveBeenCalledTimes(1)
    expect(first.resolve('cache')).toMatchObject({ __value: 'cache-value' })

    const second = await createRequestContainer()
    // Bootstrap MUST NOT run again — the cached entries are replayed.
    expect(bootstrapMock).toHaveBeenCalledTimes(1)
    expect(second.resolve('cache')).toMatchObject({ __value: 'cache-value' })
    expect(second.resolve('eventBus')).toMatchObject({ __value: 'event-bus-value' })
  })

  it('runs bootstrap() on every createRequestContainer() when OM_BOOTSTRAP_CACHE is unset (default)', async () => {
    delete process.env.OM_BOOTSTRAP_CACHE
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    await createRequestContainer()
    await createRequestContainer()
    expect(bootstrapMock).toHaveBeenCalledTimes(2)
  })

  it('registerDiRegistrars clears the cache so HMR re-runs bootstrap on the next request', async () => {
    process.env.OM_BOOTSTRAP_CACHE = '1'
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    await createRequestContainer()
    expect(bootstrapMock).toHaveBeenCalledTimes(1)
    registerDiRegistrars([])
    await createRequestContainer()
    expect(bootstrapMock).toHaveBeenCalledTimes(2)
  })

  it('memoizes tenantEncryptionService.isEnabled() across requests', async () => {
    process.env.OM_BOOTSTRAP_CACHE = '1'
    let isEnabledCalls = 0
    bootstrapMock.mockImplementationOnce(async (container: any) => {
      container.register({
        cache: asValue({ __value: 'cache-value' }),
        eventBus: asValue({ __value: 'event-bus-value' }),
        tenantEncryptionService: asValue({
          isEnabled: () => {
            isEnabledCalls += 1
            return true
          },
        }),
      })
    })
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    await createRequestContainer()
    await createRequestContainer()
    await createRequestContainer()
    // Called once during the first bootstrap, then cached on globalThis.
    expect(isEnabledCalls).toBe(1)
    expect(subscriberRegistered).toHaveBeenCalledTimes(3)
  })
})
