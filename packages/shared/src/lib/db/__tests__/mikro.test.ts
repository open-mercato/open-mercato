import type { TelemetryMetricPoint } from '../../telemetry/runtime'
import type { ObservablePool } from '../mikro'

describe('ORM entity registry', () => {
  const GLOBAL_ENTITIES_KEY = '__openMercatoOrmEntities__'
  const originalEntities = (globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY]

  afterEach(() => {
    jest.resetModules()
    if (typeof originalEntities === 'undefined') {
      delete (globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY]
      return
    }
    ;(globalThis as Record<string, unknown>)[GLOBAL_ENTITIES_KEY] = originalEntities
  })

  it('survives module reloads via global state', async () => {
    const entities = [{ name: 'TestEntity' }]

    const firstLoad = await import('../mikro')
    firstLoad.registerOrmEntities(entities)

    jest.resetModules()

    const secondLoad = await import('../mikro')
    expect(secondLoad.getOrmEntities()).toBe(entities)
  })
})

describe('attachPoolErrorHandlers', () => {
  it('swallows errors from idle pooled clients (pool-level emit)', async () => {
    const { EventEmitter } = await import('node:events')
    const { attachPoolErrorHandlers } = await import('../mikro')
    const pool = new EventEmitter()

    attachPoolErrorHandlers(pool as any)

    expect(() => pool.emit('error', new Error('terminating connection due to idle-in-transaction timeout'))).not.toThrow()
  })

  it('swallows errors from checked-out clients (client-level emit)', async () => {
    const { EventEmitter } = await import('node:events')
    const { attachPoolErrorHandlers } = await import('../mikro')
    const pool = new EventEmitter()
    const client = new EventEmitter()

    attachPoolErrorHandlers(pool as any)
    pool.emit('connect', client)

    expect(client.listenerCount('error')).toBe(1)
    expect(() => client.emit('error', new Error('terminating connection due to idle-in-transaction timeout'))).not.toThrow()
  })
})

describe('resolvePoolConfig', () => {
  const baseEnv = (extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
    ({ ...extra }) as NodeJS.ProcessEnv

  it('applies pool size defaults when env is empty', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    const config = resolvePoolConfig(baseEnv())
    expect(config.poolMin).toBe(2)
    expect(config.poolMax).toBe(20)
    expect(config.poolIdleTimeout).toBe(3000)
    expect(config.poolAcquireTimeout).toBe(6000)
  })

  it('reads pool sizes from env overrides', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    const config = resolvePoolConfig(
      baseEnv({ DB_POOL_MIN: '5', DB_POOL_MAX: '50', DB_POOL_ACQUIRE_TIMEOUT: '12000' }),
    )
    expect(config.poolMin).toBe(5)
    expect(config.poolMax).toBe(50)
    expect(config.poolAcquireTimeout).toBe(12000)
  })

  it('defaults idle_in_transaction to a finite 120s in production', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    const config = resolvePoolConfig(baseEnv({ NODE_ENV: 'production' }))
    expect(config.idleInTransactionTimeoutMs).toBe(120_000)
  })

  it('defaults idle_in_transaction to a finite 120s in development', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    const config = resolvePoolConfig(baseEnv({ NODE_ENV: 'development' }))
    expect(config.idleInTransactionTimeoutMs).toBe(120_000)
  })

  it('lets idle_in_transaction be overridden, including 0 to disable', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    expect(
      resolvePoolConfig(baseEnv({ DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '30000' }))
        .idleInTransactionTimeoutMs,
    ).toBe(30000)
    expect(
      resolvePoolConfig(
        baseEnv({ NODE_ENV: 'production', DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' }),
      ).idleInTransactionTimeoutMs,
    ).toBe(0)
  })

  it('keeps idle_session production-undefined / dev-600s default', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    expect(resolvePoolConfig(baseEnv({ NODE_ENV: 'production' })).idleSessionTimeoutMs).toBeUndefined()
    expect(resolvePoolConfig(baseEnv({ NODE_ENV: 'development' })).idleSessionTimeoutMs).toBe(600_000)
  })

  it('leaves statement/lock timeouts unset by default (no timeout)', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    const config = resolvePoolConfig(baseEnv({ NODE_ENV: 'production' }))
    expect(config.statementTimeoutMs).toBeUndefined()
    expect(config.lockTimeoutMs).toBeUndefined()
  })

  it('passes through positive statement/lock timeouts when set', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    const config = resolvePoolConfig(
      baseEnv({ DB_STATEMENT_TIMEOUT_MS: '30000', DB_LOCK_TIMEOUT_MS: '5000' }),
    )
    expect(config.statementTimeoutMs).toBe(30000)
    expect(config.lockTimeoutMs).toBe(5000)
  })

  it('ignores non-positive or non-numeric statement/lock timeouts', async () => {
    const { resolvePoolConfig } = await import('../mikro')
    for (const value of ['0', '-1', 'abc', '']) {
      const config = resolvePoolConfig(
        baseEnv({ DB_STATEMENT_TIMEOUT_MS: value, DB_LOCK_TIMEOUT_MS: value }),
      )
      expect(config.statementTimeoutMs).toBeUndefined()
      expect(config.lockTimeoutMs).toBeUndefined()
    }
  })
})

describe('instrumentPrimaryPool', () => {
  afterEach(async () => {
    const {
      resetTelemetryMetricCollectors,
      resetTelemetryRuntime,
    } = await import('../../telemetry/runtime')
    resetTelemetryMetricCollectors()
    resetTelemetryRuntime()
  })

  async function registerMetricRecorder() {
    const { registerTelemetryRuntime } = await import('../../telemetry/runtime')
    const points: TelemetryMetricPoint[] = []
    registerTelemetryRuntime({
      canUseGlobalTracePropagation: () => false,
      captureTraceContext: () => ({}),
      continueTrace: (_carrier, _name, fn) => fn(),
      recordMetric: (point) => points.push(point),
      recordHttpDuration: () => {},
      reportError: () => {},
      shutdown: async () => {},
    })
    return points
  }

  it('collects exact pool state after telemetry initializes late', async () => {
    const { EventEmitter } = await import('node:events')
    const { instrumentPrimaryPool } = await import('../mikro')
    const { collectTelemetryMetrics } = await import('../../telemetry/runtime')
    const emitter = new EventEmitter()
    const originalConnect = () => Promise.resolve({ id: 'client' })
    const pool = Object.assign(emitter, {
      totalCount: 8,
      idleCount: 3,
      waitingCount: 4,
      options: { max: 20 },
      connect: originalConnect,
    }) as unknown as ObservablePool
    const dispose = instrumentPrimaryPool(pool)

    collectTelemetryMetrics()
    const points = await registerMetricRecorder()
    collectTelemetryMetrics()

    expect(points).toEqual([
      {
        kind: 'gauge',
        name: 'db.client.connection.count',
        value: 3,
        labels: { pool: 'primary', state: 'idle' },
        unit: '{connection}',
      },
      {
        kind: 'gauge',
        name: 'db.client.connection.count',
        value: 5,
        labels: { pool: 'primary', state: 'used' },
        unit: '{connection}',
      },
      {
        kind: 'gauge',
        name: 'db.client.connection.pending_requests',
        value: 4,
        labels: { pool: 'primary' },
        unit: '{request}',
      },
      {
        kind: 'gauge',
        name: 'db.client.connection.max',
        value: 20,
        labels: { pool: 'primary' },
        unit: '{connection}',
      },
    ])

    dispose()
    points.length = 0
    collectTelemetryMetrics()
    expect(points).toEqual([])
    expect(pool.connect).toBe(originalConnect)
  })

  it('preserves promise success and rejection while timing both outcomes', async () => {
    const { EventEmitter } = await import('node:events')
    const { instrumentPrimaryPool } = await import('../mikro')
    const points = await registerMetricRecorder()
    const client = { id: 'client' }
    const failure = new Error('[internal] pool exhausted')
    const results: Array<Promise<unknown>> = [
      Promise.resolve(client),
      Promise.reject(failure),
    ]
    const originalConnect = jest.fn(() => results.shift() ?? Promise.resolve(client))
    const pool = Object.assign(new EventEmitter(), {
      totalCount: 1,
      idleCount: 0,
      waitingCount: 0,
      options: { max: 20 },
      connect: originalConnect,
    }) as unknown as ObservablePool
    const times = [100, 350, 400, 900]
    const dispose = instrumentPrimaryPool(pool, () => times.shift() ?? 900)

    await expect(pool.connect()).resolves.toBe(client)
    await expect(pool.connect()).rejects.toBe(failure)

    expect(points.filter((point) => point.name === 'db.client.connection.wait_time'))
      .toEqual([
        {
          kind: 'histogram',
          name: 'db.client.connection.wait_time',
          value: 0.25,
          labels: { pool: 'primary' },
          unit: 's',
        },
        {
          kind: 'histogram',
          name: 'db.client.connection.wait_time',
          value: 0.5,
          labels: { pool: 'primary' },
          unit: 's',
        },
      ])
    expect(originalConnect.mock.contexts).toEqual([pool, pool])

    dispose()
  })

  it('preserves callback arguments, receiver, and acquisition timing', async () => {
    const { EventEmitter } = await import('node:events')
    const { instrumentPrimaryPool } = await import('../mikro')
    const points = await registerMetricRecorder()
    const client = { id: 'client' }
    const failure = new Error('[internal] callback acquisition failed')
    const release = jest.fn()
    let receivedThis: unknown
    let callCount = 0
    const originalConnect = function (
      this: unknown,
      callback: (
        err: Error | undefined,
        connectedClient: unknown,
        done: (releaseError?: unknown) => void,
      ) => void,
    ): void {
      receivedThis = this
      callCount += 1
      if (callCount === 1) {
        callback(undefined, client, release)
        return
      }
      callback(failure, undefined, release)
    }
    const pool = Object.assign(new EventEmitter(), {
      totalCount: 1,
      idleCount: 0,
      waitingCount: 0,
      options: { max: 20 },
      connect: originalConnect,
    }) as unknown as ObservablePool
    const times = [1_000, 1_250, 1_500, 2_000]
    const dispose = instrumentPrimaryPool(pool, () => times.shift() ?? 2_000)

    await new Promise<void>((resolve, reject) => {
      pool.connect((err, connectedClient, done) => {
        try {
          expect(err).toBeUndefined()
          expect(connectedClient).toBe(client)
          expect(done).toBe(release)
          resolve()
        } catch (testError) {
          reject(testError)
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      pool.connect((err, connectedClient, done) => {
        try {
          expect(err).toBe(failure)
          expect(connectedClient).toBeUndefined()
          expect(done).toBe(release)
          resolve()
        } catch (testError) {
          reject(testError)
        }
      })
    })

    expect(receivedThis).toBe(pool)
    expect(points.filter((point) => point.name === 'db.client.connection.wait_time'))
      .toEqual([
        {
          kind: 'histogram',
          name: 'db.client.connection.wait_time',
          value: 0.25,
          labels: { pool: 'primary' },
          unit: 's',
        },
        {
          kind: 'histogram',
          name: 'db.client.connection.wait_time',
          value: 0.5,
          labels: { pool: 'primary' },
          unit: 's',
        },
      ])

    dispose()
  })
})
