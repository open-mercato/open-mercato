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
