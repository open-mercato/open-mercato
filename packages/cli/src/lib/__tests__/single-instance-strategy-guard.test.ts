import {
  defineCacheProvider,
  defineCacheProviderRegistration,
  resetCacheProviderSelectionForTests,
  setCacheProviderRegistrations,
  type CacheProviderPlacement,
} from '@open-mercato/cache/provider'
import { loadCacheProviderManifest } from '../cache-provider-manifest'
import {
  assertSingleInstanceStrategies,
  evaluateSingleInstanceGuard,
  readInfraStrategySnapshot,
  resolveEffectiveCacheProviderSnapshot,
  SingleInstanceStrategyError,
  type InfraStrategySnapshot,
} from '../single-instance-strategy-guard'

jest.mock('../cache-provider-manifest', () => ({ loadCacheProviderManifest: jest.fn() }))

const loadManifestMock = jest.mocked(loadCacheProviderManifest)

const singleInstanceSnapshot: InfraStrategySnapshot = {
  cacheStrategy: 'memory',
  queueStrategy: 'local',
  rateLimitStrategy: 'memory',
}

const multiInstanceSafeSnapshot: InfraStrategySnapshot = {
  cacheStrategy: 'redis',
  queueStrategy: 'async',
  rateLimitStrategy: 'redis',
}

describe('evaluateSingleInstanceGuard', () => {
  it('is a no-op outside production even with single-instance strategies', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'development',
      OM_MULTI_INSTANCE: '1',
    })
    expect(result.action).toBe('ok')
    expect(result.offenders).toHaveLength(3)
  })

  it('is a no-op in production when all strategies are multi-instance safe', () => {
    const result = evaluateSingleInstanceGuard(multiInstanceSafeSnapshot, {
      NODE_ENV: 'production',
      OM_MULTI_INSTANCE: '1',
    })
    expect(result.action).toBe('ok')
    expect(result.offenders).toHaveLength(0)
  })

  it('fails in production when a multi-instance topology is declared via OM_MULTI_INSTANCE', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
      OM_MULTI_INSTANCE: '1',
    })
    expect(result.action).toBe('fail')
    expect(result.offenders.map((offender) => offender.envVar)).toEqual([
      'CACHE_STRATEGY',
      'QUEUE_STRATEGY',
      'RATE_LIMIT_STRATEGY',
    ])
  })

  it('treats OM_INSTANCE_COUNT > 1 as a multi-instance topology', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
      OM_INSTANCE_COUNT: '3',
    })
    expect(result.action).toBe('fail')
  })

  it('does not treat OM_INSTANCE_COUNT=1 as multi-instance', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
      OM_INSTANCE_COUNT: '1',
    })
    expect(result.action).toBe('warn')
  })

  it('only warns in production when no multi-instance topology is declared', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
    })
    expect(result.action).toBe('warn')
    expect(result.multiInstance).toBe(false)
  })

  it('downgrades a hard failure to a warning when the override is set', () => {
    const result = evaluateSingleInstanceGuard(singleInstanceSnapshot, {
      NODE_ENV: 'production',
      OM_MULTI_INSTANCE: '1',
      OM_ALLOW_SINGLE_INSTANCE_STRATEGIES: '1',
    })
    expect(result.action).toBe('warn')
    expect(result.overridden).toBe(true)
  })

  it('flags only the offending strategy when others are safe', () => {
    const result = evaluateSingleInstanceGuard(
      { cacheStrategy: 'redis', queueStrategy: 'local', rateLimitStrategy: 'redis' },
      { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' },
    )
    expect(result.action).toBe('fail')
    expect(result.offenders).toHaveLength(1)
    expect(result.offenders[0].component).toBe('queue')
  })
})

describe('stock cache strategy characterization', () => {
  it('reads CACHE_STRATEGY into the snapshot and defaults to memory', () => {
    expect(readInfraStrategySnapshot({ CACHE_STRATEGY: 'redis' }).cacheStrategy).toBe('redis')
    expect(readInfraStrategySnapshot({ CACHE_STRATEGY: '  sqlite  ' }).cacheStrategy).toBe('sqlite')
    expect(readInfraStrategySnapshot({}).cacheStrategy).toBe('memory')
    expect(readInfraStrategySnapshot({ CACHE_STRATEGY: '' }).cacheStrategy).toBe('memory')
  })

  it('treats a redis cache as multi-instance safe', () => {
    const result = evaluateSingleInstanceGuard(
      { ...multiInstanceSafeSnapshot, cacheStrategy: 'redis' },
      { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' },
    )
    expect(result.offenders.find((offender) => offender.component === 'cache')).toBeUndefined()
  })

  it.each([['memory'], ['sqlite'], ['jsonfile']])(
    'reports a %s cache as a CACHE_STRATEGY offender',
    (cacheStrategy) => {
      const result = evaluateSingleInstanceGuard(
        { ...multiInstanceSafeSnapshot, cacheStrategy },
        { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' },
      )
      expect(result.action).toBe('fail')
      expect(result.offenders).toEqual([
        { component: 'cache', envVar: 'CACHE_STRATEGY', configured: cacheStrategy, safeValues: ['redis'] },
      ])
    },
  )
})

describe('assertSingleInstanceStrategies', () => {
  function createLogger() {
    return {
      warn: jest.fn(),
      error: jest.fn(),
    }
  }

  it('throws and logs when the guard fails', () => {
    const logger = createLogger()
    expect(() =>
      assertSingleInstanceStrategies(
        { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' },
        { snapshot: singleInstanceSnapshot, logger },
      ),
    ).toThrow(SingleInstanceStrategyError)
    expect(logger.error).toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs a warning but does not throw when only warning', () => {
    const logger = createLogger()
    const result = assertSingleInstanceStrategies(
      { NODE_ENV: 'production' },
      { snapshot: singleInstanceSnapshot, logger },
    )
    expect(result.action).toBe('warn')
    expect(logger.warn).toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('stays silent and does not throw when everything is safe', () => {
    const logger = createLogger()
    const result = assertSingleInstanceStrategies(
      { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' },
      { snapshot: multiInstanceSafeSnapshot, logger },
    )
    expect(result.action).toBe('ok')
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('single-instance guard with a registered cache provider', () => {
  const productionMultiInstance = { NODE_ENV: 'production', OM_MULTI_INSTANCE: '1' }

  it('treats a provider with shared placement as multi-instance safe regardless of CACHE_STRATEGY', () => {
    const result = evaluateSingleInstanceGuard(
      { ...multiInstanceSafeSnapshot, cacheStrategy: 'memory', cacheProvider: { id: 'acme/shared', placement: 'shared' } },
      productionMultiInstance,
    )
    expect(result.action).toBe('ok')
    expect(result.offenders).toHaveLength(0)
  })

  it('reports a local provider as a CACHE_PROVIDER offender even when CACHE_STRATEGY=redis', () => {
    const result = evaluateSingleInstanceGuard(
      { ...multiInstanceSafeSnapshot, cacheProvider: { id: 'acme/local', placement: 'local' } },
      productionMultiInstance,
    )
    expect(result.action).toBe('fail')
    expect(result.offenders).toEqual([
      expect.objectContaining({ component: 'cache', envVar: 'CACHE_PROVIDER', configured: 'acme/local' }),
    ])
  })

  it('carries the provider snapshot through readInfraStrategySnapshot only when one is resolved', () => {
    expect(readInfraStrategySnapshot({}, { cacheProvider: null })).not.toHaveProperty('cacheProvider')
    expect(readInfraStrategySnapshot({}, { cacheProvider: { id: 'acme/x', placement: 'shared' } }).cacheProvider)
      .toEqual({ id: 'acme/x', placement: 'shared' })
  })
})

describe('resolveEffectiveCacheProviderSnapshot', () => {
  function registerProvider(placement: CacheProviderPlacement) {
    const definition = defineCacheProvider<Record<string, never>>({
      id: 'acme/fake',
      settings: { safeParse: () => ({ success: true, data: {} }) },
      capability: () => ({ placement }),
      create: () => { throw new Error('must not connect during the guard') },
    })
    setCacheProviderRegistrations([
      defineCacheProviderRegistration({ id: 'acme/fake', load: async () => definition, settings: () => ({}) }),
    ])
  }

  beforeEach(() => {
    resetCacheProviderSelectionForTests()
    loadManifestMock.mockReset()
  })

  afterAll(() => {
    resetCacheProviderSelectionForTests()
  })

  it('returns null without loading the manifest for stock deployments', async () => {
    await expect(resolveEffectiveCacheProviderSnapshot('/app', { CACHE_STRATEGY: 'redis' })).resolves.toBeNull()
    expect(loadManifestMock).not.toHaveBeenCalled()
  })

  it.each([['shared'], ['local']] as const)('loads the manifest and reports the %s placement', async (placement) => {
    loadManifestMock.mockImplementation(async () => {
      registerProvider(placement)
      return []
    })

    const snapshot = await resolveEffectiveCacheProviderSnapshot('/app', {
      CACHE_PROVIDER: 'acme/fake',
      CACHE_PROVIDER_NAMESPACE: 'guard-ns',
    })

    expect(loadManifestMock).toHaveBeenCalledWith('/app')
    expect(snapshot).toEqual({ id: 'acme/fake', placement })
  })

  it('propagates a provider selection error so the start aborts', async () => {
    loadManifestMock.mockImplementation(async () => {
      setCacheProviderRegistrations([])
      return []
    })

    await expect(
      resolveEffectiveCacheProviderSnapshot('/app', { CACHE_PROVIDER: 'acme/fake', CACHE_PROVIDER_NAMESPACE: 'guard-ns' }),
    ).rejects.toMatchObject({ name: 'CacheProviderError', code: 'not_registered' })
  })
})
