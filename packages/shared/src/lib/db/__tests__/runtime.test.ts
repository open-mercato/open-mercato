import {
  afterDatabaseMigrate,
  beginDatabaseInitialization,
  beforeDatabaseMigrate,
  configureDatabasePool,
  registerDatabaseExecutionContextResolver,
  registerDatabaseRuntimeAdapter,
  resolveDatabaseConnectionUrl,
  resolveDatabaseExecutionContext,
  runWithDatabaseExecutionContext,
  type DatabaseRuntimeAdapter,
} from '../runtime'

const runtimeKey = Symbol.for('@open-mercato/shared.databaseRuntime.v1')
const globals = globalThis as Record<symbol, unknown>
const descriptor = { id: 'primary', purpose: 'runtime', tables: 'primary' } as const

function adapter(overrides: Partial<DatabaseRuntimeAdapter> = {}): DatabaseRuntimeAdapter {
  return {
    id: 'test', version: '1', configurationKey: 'configuration',
    configurePool: () => ({ ready: async () => undefined, dispose: () => undefined }),
    run: (_context, callback) => callback(),
    ...overrides,
  }
}

beforeEach(() => { delete globals[runtimeKey] })
afterEach(() => { delete globals[runtimeKey] })

it('preserves execution, URLs and migration behavior when no adapter is registered', async () => {
  const result = { unchanged: true }
  expect(runWithDatabaseExecutionContext({ kind: 'identity', source: 'identity', tenantId: null }, () => result)).toBe(result)
  expect(resolveDatabaseConnectionUrl('runtime', 'default')).toBe('default')
  await expect(beforeDatabaseMigrate()).resolves.toBeUndefined()
  await expect(afterDatabaseMigrate()).resolves.toBeUndefined()
})

it('retains the original adapter across duplicate same-version registrations', () => {
  const first = jest.fn(() => 'first')
  registerDatabaseRuntimeAdapter(adapter({ connectionUrl: first }))
  registerDatabaseRuntimeAdapter(adapter({ connectionUrl: () => 'replacement' }))
  expect(resolveDatabaseConnectionUrl('runtime', 'default')).toBe('first')
  expect(first).toHaveBeenCalledWith('runtime', 'default')
  expect(() => registerDatabaseRuntimeAdapter(adapter({ configurationKey: 'changed' }))).toThrow('restart')
})

it('rejects late registration while preserving the existing pool lifecycle', async () => {
  const lifecycle = configureDatabasePool({}, descriptor)
  expect(() => registerDatabaseRuntimeAdapter(adapter())).toThrow('before connection pools')
  await lifecycle.ready()
  lifecycle.dispose()
  lifecycle.dispose()
  expect(() => registerDatabaseRuntimeAdapter(adapter())).not.toThrow()
})

it('rejects registration after lazy ORM initialization even before a physical pool exists', () => {
  expect(beginDatabaseInitialization()).toBe(false)
  expect(() => registerDatabaseRuntimeAdapter(adapter())).toThrow('before connection pools')
})

it('configures a physical pool once and rejects identity confusion', async () => {
  const ready = jest.fn(async () => undefined)
  const dispose = jest.fn()
  const configure = jest.fn(() => ({ ready, dispose }))
  registerDatabaseRuntimeAdapter(adapter({ configurePool: configure }))
  const pool = {}
  const first = configureDatabasePool(pool, descriptor)
  expect(configureDatabasePool(pool, descriptor)).toBe(first)
  expect(configure).toHaveBeenCalledTimes(1)
  expect(() => configureDatabasePool(pool, { ...descriptor, purpose: 'maintenance' })).toThrow('conflicting identities')
  await first.ready()
  await first.ready()
  expect(ready).toHaveBeenCalledTimes(1)
  first.dispose()
  first.dispose()
  expect(dispose).toHaveBeenCalledTimes(1)
  await expect(first.ready()).rejects.toThrow('disposed')
})

it('propagates readiness failure rather than allowing an unvalidated pool', async () => {
  registerDatabaseRuntimeAdapter(adapter({
    configurePool: () => ({
      ready: async () => { throw new Error('[internal] unsafe runtime role') },
      dispose: () => undefined,
    }),
  }))
  const lifecycle = configureDatabasePool({}, descriptor)
  await expect(lifecycle.ready()).rejects.toThrow('unsafe runtime role')
  lifecycle.dispose()
})

it('does not mark a pool disposed when the adapter rejects unsafe disposal', async () => {
  const dispose = jest.fn().mockImplementationOnce(() => { throw new Error('[internal] drain first') })
  registerDatabaseRuntimeAdapter(adapter({ configurePool: () => ({ ready: async () => undefined, dispose }) }))
  const lifecycle = configureDatabasePool({}, descriptor)
  expect(lifecycle.dispose).toThrow('drain first')
  await expect(lifecycle.ready()).resolves.toBeUndefined()
  lifecycle.dispose()
  expect(dispose).toHaveBeenCalledTimes(2)
})

it('passes immutable context to the adapter and keeps callback results intact', async () => {
  const seen: Array<string | null> = []
  registerDatabaseRuntimeAdapter(adapter({ run: (context, callback) => {
    expect(Object.isFrozen(context)).toBe(true)
    seen.push(context.tenantId)
    return callback()
  } }))
  const result = Promise.resolve('result')
  expect(runWithDatabaseExecutionContext({ kind: 'tenant', source: 'worker', tenantId: 'tenant-a' }, () => result)).toBe(result)
  expect(seen).toEqual(['tenant-a'])
})

it('keeps context resolvers stable across module re-registration and propagates failures', async () => {
  const invocation = Object.freeze({ token: Symbol('request'), isActive: () => true })
  registerDatabaseExecutionContextResolver('request', async () => ({
    status: 'resolved', context: { kind: 'tenant', source: 'page', tenantId: 'tenant-a' }, invocation,
  }))
  registerDatabaseExecutionContextResolver('request', async () => ({ status: 'absent' }))
  expect(await resolveDatabaseExecutionContext()).toEqual({
    status: 'resolved', context: { kind: 'tenant', source: 'page', tenantId: 'tenant-a' }, invocation,
  })
  delete globals[runtimeKey]
  registerDatabaseExecutionContextResolver('request', async () => { throw new Error('[internal] identity unavailable') })
  await expect(resolveDatabaseExecutionContext()).rejects.toThrow('identity unavailable')
})

it('distinguishes absent identity from a resolver that could not validate identity', async () => {
  registerDatabaseExecutionContextResolver('request', async () => ({ status: 'absent' }))
  expect(await resolveDatabaseExecutionContext()).toEqual({ status: 'absent' })
  registerDatabaseExecutionContextResolver('portal', async () => ({
    status: 'unavailable', error: new Error('[internal] canonical identity unavailable'),
  }))
  await expect(resolveDatabaseExecutionContext()).rejects.toThrow('canonical identity unavailable')
})

it('awaits migration hooks and propagates failures to the caller', async () => {
  const calls: string[] = []
  registerDatabaseRuntimeAdapter(adapter({
    beforeMigrate: async () => { calls.push('preflight') },
    afterMigrate: async () => { throw new Error('[internal] policy drift') },
  }))
  await beforeDatabaseMigrate()
  expect(calls).toEqual(['preflight'])
  await expect(afterDatabaseMigrate()).rejects.toThrow('policy drift')
})
