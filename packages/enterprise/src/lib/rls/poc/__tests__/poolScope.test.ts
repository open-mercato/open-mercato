import {
  installRlsPoolScope,
  runWithRlsTenant,
  type ScopeClient,
  type ScopeConnect,
  type ScopePool,
} from '../poolScope'

const tenantAlpha = '11111111-1111-4111-8111-111111111111'
const tenantBeta = '22222222-2222-4222-8222-222222222222'
const tenantSql = "select set_config('app.current_tenant_id', $1, false)"

function createPool() {
  const client: ScopeClient = {
    query: jest.fn(async () => undefined),
    release: jest.fn(),
  }
  const originalConnect = jest.fn(async () => client)
  const pool: ScopePool = { connect: originalConnect as ScopeConnect }
  return { pool, client, originalConnect }
}

function callbackConnect(pool: ScopePool): Promise<ScopeClient> {
  return new Promise((resolve, reject) => {
    pool.connect((error, client) => {
      if (error) reject(error)
      else if (client) resolve(client)
      else reject(new Error('[internal] Missing test connection'))
    })
  })
}

describe('enterprise RLS pool-scope PoC', () => {
  it('initializes the exact acquired client before returning it and preserves the pool receiver', async () => {
    const { pool, client, originalConnect } = createPool()
    const events: string[] = []
    jest.mocked(client.query).mockImplementation(async () => { events.push('initialized') })
    installRlsPoolScope(pool)

    const returned = await runWithRlsTenant(tenantAlpha, () => pool.connect())
    events.push('returned')

    expect(returned).toBe(client)
    expect(events).toEqual(['initialized', 'returned'])
    expect(originalConnect.mock.contexts).toEqual([pool])
    expect(client.query).toHaveBeenCalledWith(tenantSql, [tenantAlpha])
    expect(client.release).not.toHaveBeenCalled()
  })

  it('replaces stale context on every reservation, including unscoped work', async () => {
    const { pool, client } = createPool()
    installRlsPoolScope(pool)

    await runWithRlsTenant(tenantAlpha, () => pool.connect())
    await runWithRlsTenant(tenantBeta, () => pool.connect())
    await pool.connect()

    expect(jest.mocked(client.query).mock.calls).toEqual([
      [tenantSql, [tenantAlpha]],
      [tenantSql, [tenantBeta]],
      [tenantSql, ['']],
    ])
  })

  it('keeps concurrent async tenant scopes independent while acquisitions complete out of order', async () => {
    const { pool, client, originalConnect } = createPool()
    let releaseAlpha: (client: ScopeClient) => void = () => undefined
    originalConnect.mockImplementationOnce(() => new Promise((resolve) => { releaseAlpha = resolve }))
    installRlsPoolScope(pool)

    const alpha = runWithRlsTenant(tenantAlpha, async () => {
      await Promise.resolve()
      return pool.connect()
    })
    const beta = runWithRlsTenant(tenantBeta, async () => {
      await Promise.resolve()
      return pool.connect()
    })
    await beta
    releaseAlpha(client)
    await alpha
    await pool.connect()

    expect(jest.mocked(client.query).mock.calls.map((call) => call[1])).toEqual([
      [tenantBeta], [tenantAlpha], [''],
    ])
  })

  it('supports callback acquisition and passes through release for successful clients', async () => {
    const { pool, client } = createPool()
    installRlsPoolScope(pool)

    await runWithRlsTenant(tenantAlpha, () => new Promise<void>((resolve, reject) => {
      pool.connect((error, returned, release) => {
        if (error) { reject(error); return }
        expect(returned).toBe(client)
        expect(client.query).toHaveBeenCalledWith(tenantSql, [tenantAlpha])
        release()
        resolve()
      })
    }))

    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it.each(['promise', 'callback'] as const)('destroys a client after failed initialization through %s acquisition', async (mode) => {
    const { pool, client } = createPool()
    const failure = new Error('[internal] Setup failed')
    jest.mocked(client.query).mockRejectedValueOnce(failure)
    installRlsPoolScope(pool)

    const operation = runWithRlsTenant(tenantAlpha, () => mode === 'promise' ? pool.connect() : callbackConnect(pool))
    await expect(operation).rejects.toBe(failure)
    expect(client.release).toHaveBeenCalledTimes(1)
    expect(client.release).toHaveBeenCalledWith(failure)

    await expect(pool.connect()).resolves.toBe(client)
    expect(client.query).toHaveBeenLastCalledWith(tenantSql, [''])
  })

  it.each(['promise', 'callback'] as const)('propagates pool acquisition failures through %s acquisition', async (mode) => {
    const { pool, client, originalConnect } = createPool()
    const failure = new Error('[internal] Pool unavailable')
    originalConnect.mockRejectedValueOnce(failure)
    installRlsPoolScope(pool)

    await expect(mode === 'promise' ? pool.connect() : callbackConnect(pool)).rejects.toBe(failure)
    expect(client.query).not.toHaveBeenCalled()
    expect(client.release).not.toHaveBeenCalled()
  })

  it('normalizes non-Error setup failures for client destruction and callbacks', async () => {
    const { pool, client } = createPool()
    jest.mocked(client.query).mockRejectedValueOnce('failed')
    installRlsPoolScope(pool)

    await expect(callbackConnect(pool)).rejects.toThrow('[internal] RLS connection setup failed')
    expect(client.release).toHaveBeenCalledWith(expect.objectContaining({ cause: 'failed' }))
  })

  it('rejects nested tenant switches before any connection can be borrowed', async () => {
    const { pool, originalConnect } = createPool()
    installRlsPoolScope(pool)

    expect(() => runWithRlsTenant(tenantAlpha, () => runWithRlsTenant(tenantBeta, () => pool.connect())))
      .toThrow('[internal] Cannot change RLS tenant')
    expect(originalConnect).not.toHaveBeenCalled()
    await expect(runWithRlsTenant(tenantAlpha, () => runWithRlsTenant(tenantAlpha, () => pool.connect())))
      .resolves.toBeDefined()
  })

  it('validates UUIDs and accepts normalized UUID case without a nested switch', async () => {
    const { pool, client } = createPool()
    installRlsPoolScope(pool)
    expect(() => runWithRlsTenant("'; RESET ALL; --", () => pool.connect())).toThrow('[internal] RLS tenant must be a UUID')
    const tenantUpper = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
    await runWithRlsTenant(tenantUpper, () => runWithRlsTenant(tenantUpper.toLowerCase(), () => pool.connect()))
    expect(client.query).toHaveBeenLastCalledWith(tenantSql, [tenantUpper.toLowerCase()])
  })

  it('installs once and restores the existing connection wrapper on disposal', async () => {
    const { pool, client, originalConnect } = createPool()
    const dispose = installRlsPoolScope(pool)
    expect(installRlsPoolScope(pool)).toBe(dispose)
    await pool.connect()
    expect(client.query).toHaveBeenCalledTimes(1)

    dispose()
    dispose()
    expect(pool.connect).toBe(originalConnect)
    const reinstallDispose = installRlsPoolScope(pool)
    dispose()
    expect(installRlsPoolScope(pool)).toBe(reinstallDispose)
    reinstallDispose()
    expect(pool.connect).toBe(originalConnect)
  })
})
