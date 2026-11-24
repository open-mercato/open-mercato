// The route imports `@/bootstrap-api` and calls `bootstrap()` at module scope,
// so that exact module has to be mocked or importing the route boots the app.
jest.mock('@/bootstrap-api', () => ({
  bootstrap: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

import { createHealthcheckHandler } from '../route'

type ProbeOptions = {
  database?: () => Promise<unknown>
  redis?: () => Promise<boolean>
  dispose?: () => Promise<void>
}

function createContainer(options: ProbeOptions = {}) {
  const database = options.database ?? (async () => [{ '?column?': 1 }])
  const redis = options.redis ?? (async () => false)

  return async () => ({
    dispose: options.dispose ?? jest.fn(async () => undefined),
    resolve: (name: string) => {
      if (name === 'em') {
        return {
          getConnection: () => ({ execute: database }),
        }
      }
      if (name === 'cache') {
        return { has: redis }
      }
      throw new Error(`Unexpected dependency: ${name}`)
    },
  })
}

describe('GET /api/healthz', () => {
  const now = () => new Date('2026-06-05T10:00:00.000Z')
  const logger = { error: jest.fn() }

  beforeEach(() => {
    logger.error.mockClear()
  })

  it('returns 200 when database and Redis probes succeed', async () => {
    const handler = createHealthcheckHandler({
      createContainer: createContainer() as never,
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      ts: '2026-06-05T10:00:00.000Z',
    })
  })

  it.each([
    ['database', { database: async () => { throw new Error('database unavailable') } }],
    ['redis', { redis: async () => { throw new Error('redis unavailable') } }],
  ])('returns 503 when the %s probe fails', async (_component, options) => {
    const handler = createHealthcheckHandler({
      createContainer: createContainer(options) as never,
      now,
      logger,
    })

    const response = await handler()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({
      status: 'degraded',
      ts: '2026-06-05T10:00:00.000Z',
    })
    expect(Object.keys(body)).toEqual(['status', 'ts'])
  })

  it('returns 503 when a probe exceeds the timeout', async () => {
    const handler = createHealthcheckHandler({
      createContainer: createContainer({
        database: () => new Promise(() => undefined),
      }) as never,
      now,
      timeoutMs: 5,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'degraded',
      ts: '2026-06-05T10:00:00.000Z',
    })
  })

  it('returns 503 when Redis is configured but the cache fell back without a probe', async () => {
    const handler = createHealthcheckHandler({
      createContainer: createContainer() as never,
      cacheStrategy: () => 'redis',
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      status: 'degraded',
      ts: '2026-06-05T10:00:00.000Z',
    })
  })

  it('disposes the probe scope after completed probes', async () => {
    const dispose = jest.fn(async () => undefined)
    const handler = createHealthcheckHandler({ createContainer: createContainer({ dispose }) as never, now, logger })
    const response = await handler()
    expect(response.status).toBe(200)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('retains a timed-out probe scope until its underlying operation settles', async () => {
    let finishProbe!: () => void
    let finishedCleanup!: () => void
    const operation = new Promise<void>((resolve) => { finishProbe = resolve })
    const cleanup = new Promise<void>((resolve) => { finishedCleanup = resolve })
    const dispose = jest.fn(async () => { finishedCleanup() })
    const handler = createHealthcheckHandler({
      createContainer: createContainer({ database: () => operation, dispose }) as never,
      now, logger, timeoutMs: 5,
    })
    const response = await handler()
    expect(response.status).toBe(503)
    expect(dispose).not.toHaveBeenCalled()
    finishProbe()
    await cleanup
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes a scope when dependency resolution throws', async () => {
    const dispose = jest.fn(async () => undefined)
    const handler = createHealthcheckHandler({
      createContainer: (async () => ({ dispose, resolve: () => { throw new Error('missing dependency') } })) as never,
      now, logger,
    })
    expect((await handler()).status).toBe(503)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('preserves the successful response when scope cleanup fails', async () => {
    const dispose = jest.fn(async () => { throw new Error('cleanup failure') })
    const handler = createHealthcheckHandler({ createContainer: createContainer({ dispose }) as never, now, logger })
    expect((await handler()).status).toBe(200)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('[healthz] Scope cleanup failed', expect.any(Object))
  })

})

describe('GET /api/healthz cache probe selection characterization', () => {
  const now = () => new Date('2026-06-05T10:00:00.000Z')
  const logger = { error: jest.fn() }
  const originalStrategy = process.env.CACHE_STRATEGY

  afterEach(() => {
    logger.error.mockClear()
    if (originalStrategy === undefined) delete process.env.CACHE_STRATEGY
    else process.env.CACHE_STRATEGY = originalStrategy
  })

  function createCacheContainer(cache: { has: jest.Mock; healthcheck?: jest.Mock }) {
    return async () => ({
      dispose: jest.fn(async () => undefined),
      resolve: (name: string) => {
        if (name === 'em') return { getConnection: () => ({ execute: async () => [] }) }
        if (name === 'cache') return cache
        throw new Error(`Unexpected dependency: ${name}`)
      },
    })
  }

  it('calls cache.healthcheck instead of cache.has when the strategy is redis', async () => {
    const cache = { has: jest.fn(async () => false), healthcheck: jest.fn(async () => undefined) }
    const handler = createHealthcheckHandler({
      createContainer: createCacheContainer(cache) as never,
      cacheStrategy: () => 'redis',
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', ts: '2026-06-05T10:00:00.000Z' })
    expect(cache.healthcheck).toHaveBeenCalledTimes(1)
    expect(cache.has).not.toHaveBeenCalled()
  })

  it('returns 503 with the degraded body when the redis healthcheck fails', async () => {
    const cache = {
      has: jest.fn(async () => false),
      healthcheck: jest.fn(async () => { throw new Error('redis down') }),
    }
    const handler = createHealthcheckHandler({
      createContainer: createCacheContainer(cache) as never,
      cacheStrategy: () => 'redis',
      now,
      logger,
    })

    const response = await handler()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ status: 'degraded', ts: '2026-06-05T10:00:00.000Z' })
    expect(Object.keys(body)).toEqual(['status', 'ts'])
    expect(logger.error).toHaveBeenCalledWith(
      '[healthz] Infrastructure probe failed',
      { component: 'redis', error: 'redis down' },
    )
  })

  it.each([['memory'], ['sqlite'], ['jsonfile'], [undefined]])(
    'uses cache.has and ignores healthcheck for strategy %s',
    async (strategy) => {
      const cache = { has: jest.fn(async () => false), healthcheck: jest.fn(async () => undefined) }
      const handler = createHealthcheckHandler({
        createContainer: createCacheContainer(cache) as never,
        cacheStrategy: () => strategy,
        now,
        logger,
      })

      const response = await handler()

      expect(response.status).toBe(200)
      expect(cache.has).toHaveBeenCalledWith('__open_mercato_healthcheck__')
      expect(cache.healthcheck).not.toHaveBeenCalled()
    },
  )

  it('reads the strategy from CACHE_STRATEGY by default', async () => {
    process.env.CACHE_STRATEGY = 'redis'
    const cache = { has: jest.fn(async () => false), healthcheck: jest.fn(async () => undefined) }
    const handler = createHealthcheckHandler({
      createContainer: createCacheContainer(cache) as never,
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(200)
    expect(cache.healthcheck).toHaveBeenCalledTimes(1)
    expect(cache.has).not.toHaveBeenCalled()
  })
})

describe('GET /api/healthz cache provider readiness', () => {
  const now = () => new Date('2026-06-05T10:00:00.000Z')
  const logger = { error: jest.fn() }

  afterEach(() => {
    logger.error.mockClear()
  })

  function createProviderContainer(cache: { has: jest.Mock; healthcheck?: jest.Mock }) {
    return async () => ({
      dispose: jest.fn(async () => undefined),
      resolve: (name: string) => {
        if (name === 'em') return { getConnection: () => ({ execute: async () => [] }) }
        if (name === 'cache') return cache
        throw new Error(`Unexpected dependency: ${name}`)
      },
    })
  }

  it('calls the provider healthcheck when a cache provider is selected', async () => {
    const cache = { has: jest.fn(async () => false), healthcheck: jest.fn(async () => undefined) }
    const handler = createHealthcheckHandler({
      createContainer: createProviderContainer(cache) as never,
      cacheProviderSelected: () => true,
      cacheStrategy: () => 'memory',
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', ts: '2026-06-05T10:00:00.000Z' })
    expect(cache.healthcheck).toHaveBeenCalledTimes(1)
    expect(cache.has).not.toHaveBeenCalled()
  })

  it('fails readiness when the selected provider exposes no healthcheck', async () => {
    const cache = { has: jest.fn(async () => false) }
    const handler = createHealthcheckHandler({
      createContainer: createProviderContainer(cache) as never,
      cacheProviderSelected: () => true,
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'degraded', ts: '2026-06-05T10:00:00.000Z' })
    expect(cache.has).not.toHaveBeenCalled()
  })

  it('keeps the response body unchanged and logs only a sanitized provider failure', async () => {
    const cache = {
      has: jest.fn(async () => false),
      healthcheck: jest.fn(async () => {
        throw new Error('connect ECONNREFUSED rediss://user:secret@cache.internal:6380 for acme/fake')
      }),
    }
    const handler = createHealthcheckHandler({
      createContainer: createProviderContainer(cache) as never,
      cacheProviderSelected: () => true,
      now,
      logger,
    })

    const response = await handler()
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ status: 'degraded', ts: '2026-06-05T10:00:00.000Z' })
    expect(JSON.stringify(body)).not.toContain('acme/fake')
    expect(logger.error).toHaveBeenCalledWith(
      '[healthz] Infrastructure probe failed',
      { component: 'redis', error: 'Cache provider healthcheck failed' },
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret')
  })

  it('fails readiness with a sanitized message when the provider selection cannot be described', async () => {
    const cache = { has: jest.fn(async () => false), healthcheck: jest.fn(async () => undefined) }
    const selectionError = Object.assign(new Error('Cache provider "acme/fake" settings are invalid at: password'), {
      name: 'CacheProviderError',
      code: 'invalid_settings',
    })
    const handler = createHealthcheckHandler({
      createContainer: createProviderContainer(cache) as never,
      cacheProviderSelected: () => { throw selectionError },
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(503)
    expect(logger.error).toHaveBeenCalledWith(
      '[healthz] Infrastructure probe failed',
      { component: 'redis', error: 'Cache provider healthcheck failed (invalid_settings)' },
    )
    expect(cache.healthcheck).not.toHaveBeenCalled()
  })

  it('keeps the stock redis probe when no provider is selected', async () => {
    const cache = { has: jest.fn(async () => false), healthcheck: jest.fn(async () => undefined) }
    const handler = createHealthcheckHandler({
      createContainer: createProviderContainer(cache) as never,
      cacheProviderSelected: () => false,
      cacheStrategy: () => 'redis',
      now,
      logger,
    })

    const response = await handler()

    expect(response.status).toBe(200)
    expect(cache.healthcheck).toHaveBeenCalledTimes(1)
    expect(cache.has).not.toHaveBeenCalled()
  })
})
