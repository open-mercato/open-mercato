import { EventEmitter } from 'node:events'
import { registerDatabaseExecutionContextResolver } from '@open-mercato/shared/lib/db/runtime'
import { installTenantPoolBoundary, type BoundaryClient, type BoundaryPool } from '../pool'
import { runWithTenantBoundary } from '../scope'

const tenantA = '11111111-1111-4111-8111-111111111111'
const tenantB = '22222222-2222-4222-8222-222222222222'
const contextA = { kind: 'tenant', source: 'api', tenantId: tenantA } as const
const tenantSql = "select set_config('app.current_tenant_id', $1, false)"

function fixture() {
  const physical = Object.assign(new EventEmitter(), {
    query: jest.fn(async (..._arguments: unknown[]) => ({ rows: [{ value: 'result' }] })),
    release: jest.fn(),
    processID: 42,
  })
  const connect = jest.fn(async () => physical)
  const pool: BoundaryPool = { connect: connect as BoundaryPool['connect'], ended: false }
  return { physical, connect, pool }
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/shared.databaseRuntime.v1')]
})

it('sets tenant state on the exact client before handing out a restricted facade', async () => {
  const { pool, physical } = fixture()
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  await runWithTenantBoundary(contextA, async () => {
    const client = await pool.connect()
    expect(client).not.toBe(physical)
    expect(physical.query).toHaveBeenCalledWith(tenantSql, [tenantA])
    await client.query('select value')
    client.release()
  })
  expect(physical.release).toHaveBeenCalledTimes(1)
})

it.each([tenantA, tenantB])('never lets an old released handle inherit the next lease for tenant %s', async (tenantId) => {
  const { pool, physical } = fixture()
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  let stale: BoundaryClient | undefined
  await runWithTenantBoundary(contextA, async () => {
    stale = await pool.connect()
    stale.release()
  })
  await runWithTenantBoundary({ ...contextA, tenantId }, async () => {
    const current = await pool.connect()
    expect(current).not.toBe(stale)
    await expect(stale?.query('select stale')).rejects.toThrow('released')
    expect(() => stale?.release()).toThrow('released')
    await current.query('select current')
    current.release()
  })
  expect(physical.query.mock.calls.some((call) => call[0] === 'select stale')).toBe(false)
  expect(physical.release).toHaveBeenCalledTimes(2)
})

it('rejects retained clients after invocation completion and destroys them on cleanup', async () => {
  const { pool, physical } = fixture()
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  const escaped = await runWithTenantBoundary(contextA, () => pool.connect())
  await expect(escaped.query('select escaped')).rejects.toThrow('completed')
  escaped.release()
  expect(physical.release).toHaveBeenCalledWith(expect.any(Error))
  expect(physical.query.mock.calls.some((call) => call[0] === 'select escaped')).toBe(false)
})

it('guards callback acquisition, callback query and the callback release capability', async () => {
  const { pool, physical } = fixture()
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  await runWithTenantBoundary(contextA, () => new Promise<void>((resolve, reject) => {
    pool.connect((error, client, release) => {
      if (error || !client) { reject(error); return }
      client.query('select callback', (queryError: Error | null, result: unknown) => {
        if (queryError) { release(queryError); reject(queryError); return }
        expect(result).toEqual({ rows: [{ value: 'result' }] })
        release()
        resolve()
      })
    })
  }))
  expect(physical.release).toHaveBeenCalledTimes(1)
})

it('clears absent identity on each checkout', async () => {
  const { pool, physical } = fixture()
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  await runWithTenantBoundary(contextA, async () => { const client = await pool.connect(); client.release() })
  const absent = await pool.connect()
  await absent.query('select no_tenant')
  absent.release()
  expect(physical.query.mock.calls.filter((call) => call[0] === tenantSql).map((call) => call[1])).toEqual([[tenantA], ['']])
})

it.each(['promise', 'callback'] as const)('destroys %s setup failures without leaking the pool slot and recovers', async (mode) => {
  const { pool, physical } = fixture()
  physical.query.mockRejectedValueOnce(new Error('[internal] setter failed'))
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  const failed = runWithTenantBoundary(contextA, () => mode === 'promise'
    ? pool.connect()
    : new Promise<BoundaryClient>((resolve, reject) => {
      pool.connect((error, client) => {
        if (error) reject(error)
        else if (client) resolve(client)
      })
    }))
  await expect(failed).rejects.toThrow('setter failed')
  expect(physical.release).toHaveBeenCalledWith(expect.any(Error))
  await runWithTenantBoundary(contextA, async () => { const client = await pool.connect(); client.release() })
  expect(physical.release).toHaveBeenCalledTimes(2)
})

it('captures identity before queued acquisition completes under a different tenant', async () => {
  const { pool, physical, connect } = fixture()
  let finishFirst: (client: typeof physical) => void = () => undefined
  const waiting = new Promise<typeof physical>((resolve) => { finishFirst = resolve })
  connect.mockImplementationOnce(() => waiting)
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  const first = runWithTenantBoundary(contextA, async () => {
    const client = await pool.connect()
    await client.query('select first')
    client.release()
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  await runWithTenantBoundary({ ...contextA, tenantId: tenantB }, async () => {
    const client = await pool.connect()
    client.release()
  })
  finishFirst(physical)
  await first
  expect(physical.query.mock.calls.filter((call) => call[0] === tenantSql).map((call) => call[1])).toEqual([[tenantB], [tenantA]])
})

it('runs readiness once before application checkout and permits only its own internal validation queries', async () => {
  const { pool, physical } = fixture()
  const verify = jest.fn(async (candidate: BoundaryPool) => {
    const client = await candidate.connect()
    await client.query('select catalog')
    client.release()
  })
  const lifecycle = installTenantPoolBoundary(pool, { configurationKey: 'test', verifyPool: verify })
  await Promise.all([lifecycle.ready(), lifecycle.ready()])
  expect(verify).toHaveBeenCalledTimes(1)
  expect(physical.query).toHaveBeenCalledWith('select catalog')
  await runWithTenantBoundary(contextA, async () => { const client = await pool.connect(); client.release() })
})

it('refuses checkout when catalog readiness fails', async () => {
  const { pool, connect } = fixture()
  installTenantPoolBoundary(pool, { configurationKey: 'test', verifyPool: async () => { throw new Error('[internal] policy drift') } })
  await expect(pool.connect()).rejects.toThrow('policy drift')
  expect(connect).not.toHaveBeenCalled()
})

it('validates each new physical client once while replacing tenant state on every lease', async () => {
  const { pool, physical } = fixture()
  const initialize = jest.fn(async () => undefined)
  installTenantPoolBoundary(pool, { configurationKey: 'test', initializeClient: initialize })
  for (const tenantId of [tenantA, tenantB]) {
    await runWithTenantBoundary({ ...contextA, tenantId }, async () => { const client = await pool.connect(); client.release() })
  }
  expect(initialize).toHaveBeenCalledTimes(1)
  expect(physical.query.mock.calls.filter((call) => call[0] === tenantSql)).toHaveLength(2)
})

it('uses a stable deferred request token for checkout and queries, then rejects after request completion', async () => {
  const { pool, physical } = fixture()
  let active = true
  const invocation = Object.freeze({ token: Symbol('request'), isActive: () => active })
  registerDatabaseExecutionContextResolver('request', async () => ({ status: 'resolved', context: contextA, invocation }))
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  const client = await pool.connect()
  await client.query('select deferred')
  active = false
  await expect(client.query('select after_response')).rejects.toThrow('completed')
  client.release()
  expect(physical.release).toHaveBeenCalledWith(expect.any(Error))
})

it('rejects another deferred invocation even when its tenant UUID is identical', async () => {
  const { pool, physical } = fixture()
  let token = Symbol('first-request')
  registerDatabaseExecutionContextResolver('request', async () => ({
    status: 'resolved', context: contextA, invocation: { token, isActive: () => true },
  }))
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  const client = await pool.connect()
  token = Symbol('second-request')
  await expect(client.query('select another_request')).rejects.toThrow('another tenant boundary')
  client.release()
  expect(physical.query.mock.calls.some((call) => call[0] === 'select another_request')).toBe(false)
})

it('does not expose the physical client through event chaining or listener receiver', async () => {
  const { pool, physical } = fixture()
  installTenantPoolBoundary(pool, { configurationKey: 'test' })
  await runWithTenantBoundary(contextA, async () => {
    const client = await pool.connect()
    const listener = jest.fn(function (this: unknown) { expect(this).toBe(client) })
    const events = client as BoundaryClient & { on(event: string, handler: () => void): BoundaryClient }
    expect(events.on('notice', listener)).toBe(client)
    physical.emit('notice')
    expect(listener).toHaveBeenCalledTimes(1)
    expect('connection' in client).toBe(false)
    client.release()
    physical.emit('notice')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => events.on('notice', listener)).toThrow('released')
  })
})

it('refuses streaming escapes and disposal before the pool closes', async () => {
  const { pool } = fixture()
  const lifecycle = installTenantPoolBoundary(pool, { configurationKey: 'test' })
  expect(installTenantPoolBoundary(pool, { configurationKey: 'test' })).toBe(lifecycle)
  expect(() => installTenantPoolBoundary(pool, { configurationKey: 'changed' })).toThrow('configuration changed')
  expect(lifecycle.dispose).toThrow('drain and close')
  await runWithTenantBoundary(contextA, async () => {
    const client = await pool.connect()
    await expect(client.query({ submit: () => undefined })).rejects.toThrow('streaming')
    client.release()
  })
  pool.ended = true
  lifecycle.dispose()
  lifecycle.dispose()
})
