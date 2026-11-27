import { EventEmitter } from 'node:events'
import type { AppMikroORM, ObservablePool } from '../mikro'
import type { DatabaseExecutionContext, DatabasePoolDescriptor } from '../runtime'

const runtimeKey = Symbol.for('@open-mercato/shared.databaseRuntime.v1')
const globals = globalThis as Record<symbol, unknown>
const previousDatabaseUrl = process.env.DATABASE_URL

beforeEach(() => {
  jest.resetModules()
  delete globals[runtimeKey]
  process.env.DATABASE_URL = 'postgresql://test@127.0.0.1:1/disposable'
})

afterEach(() => {
  jest.restoreAllMocks()
  delete globals[runtimeKey]
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = previousDatabaseUrl
})

async function prepare(ready: () => Promise<void>, calls: string[], currentContext?: () => DatabaseExecutionContext | undefined) {
  const { MikroORM } = await import('@mikro-orm/core')
  const runtime = await import('../runtime')
  const pool = Object.assign(new EventEmitter(), {
    connect: jest.fn(), totalCount: 0, idleCount: 0, waitingCount: 0,
    ended: false,
    end: jest.fn(async () => { calls.push('end'); pool.ended = true }),
  })
  let initializePool: () => void = () => undefined
  const metadata = new Map<string, unknown>()
  let descriptor: DatabasePoolDescriptor | undefined
  const initialized = {
    em: { getKysely: jest.fn(() => initializePool()) },
    getMetadata: () => ({ getAll: () => metadata }),
    config: { get: () => 'public' },
    close: jest.fn(async () => { calls.push('close') }),
  } as unknown as AppMikroORM
  runtime.registerDatabaseRuntimeAdapter({
    id: 'test', version: '1', configurationKey: 'test',
    configurePool: (_pool, configuredDescriptor) => {
      descriptor = configuredDescriptor
      return { ready, dispose: () => { calls.push('dispose') } }
    },
    run: (_context, callback) => callback(),
    currentContext,
    connectionUrl: (purpose, original) => purpose === 'maintenance' ? 'postgresql://maintenance@127.0.0.1:1/disposable' : original,
  })
  const initialize = jest.spyOn(MikroORM, 'init').mockImplementation(async (options) => {
    const driverOptions = options.driverOptions as { onPoolCreated(pool: ObservablePool): void }
    initializePool = () => driverOptions.onPoolCreated(pool)
    return initialized
  })
  const { getOrm, registerOrmEntities } = await import('../mikro')
  registerOrmEntities([])
  return { getOrm, initialize, initialized, pool, runtime, metadata, descriptor: () => descriptor }
}

it('exposes actual active ORM table metadata before the readiness barrier', async () => {
  const setup = await prepare(async () => {
    expect(setup.descriptor()?.metadata?.()).toEqual([
      { schema: 'active_schema', table: 'records', tenantColumn: 'tenant_id', tenantType: 'uuid', tenantNullable: false },
      { schema: 'public', table: 'globals', tenantColumn: null, tenantType: null, tenantNullable: null },
    ])
    expect(Object.isFrozen(setup.descriptor()?.metadata?.())).toBe(true)
    expect(Object.isFrozen(setup.descriptor()?.metadata?.()?.[0])).toBe(true)
  }, [])
  setup.metadata.set('record', { schema: 'active_schema', tableName: 'records', properties: {
    tenantId: { fieldNames: ['tenant_id'], columnTypes: ['uuid'], nullable: false },
  } })
  setup.metadata.set('global', { tableName: 'globals', properties: {} })
  setup.metadata.set('abstract', { tableName: 'excluded', abstract: true, properties: {} })
  await setup.getOrm()
  await setup.initialized.close(true)
  setup.runtime.configureDatabasePool(setup.pool, { id: 'primary', purpose: 'runtime', tables: 'primary' }).dispose()
})

it('shares initialization and never publishes the ORM before asynchronous runtime validation passes', async () => {
  let allowReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => { allowReady = resolve })
  const calls: string[] = []
  const setup = await prepare(() => ready, calls)
  let published = false
  const first = setup.getOrm().then((orm) => { published = true; return orm })
  const second = setup.getOrm()
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(setup.initialize).toHaveBeenCalledTimes(1)
  expect(setup.initialized.em.getKysely).toHaveBeenCalledTimes(1)
  expect(published).toBe(false)
  allowReady()
  expect(await first).toBe(setup.initialized)
  expect(await second).toBe(setup.initialized)
  await setup.initialized.close(true)
  setup.runtime.configureDatabasePool(setup.pool, { id: 'primary', purpose: 'runtime', tables: 'primary' }).dispose()
})

it('closes a rejected ORM before disposing its pool guard and permits a fresh verified retry', async () => {
  const calls: string[] = []
  let readyAttempts = 0
  const setup = await prepare(async () => {
    readyAttempts += 1
    if (readyAttempts === 1) throw new Error('[internal] unsafe role')
  }, calls)
  await expect(setup.getOrm()).rejects.toThrow('unsafe role')
  expect(calls).toEqual(['close', 'end', 'dispose'])
  expect(await setup.getOrm()).toBe(setup.initialized)
  expect(setup.initialize).toHaveBeenCalledTimes(2)
  await setup.initialized.close(true)
  setup.runtime.configureDatabasePool(setup.pool, { id: 'primary', purpose: 'runtime', tables: 'primary' }).dispose()
})

it('keeps runtime and maintenance initializations and caches separate across tenant continuations', async () => {
  let context: DatabaseExecutionContext | undefined
  const setup = await prepare(async () => undefined, [], () => context)
  setup.initialize.mockImplementation(async (options) => {
    const pool = Object.assign(new EventEmitter(), { connect: jest.fn(), totalCount: 0, idleCount: 0, waitingCount: 0 })
    const driver = options.driverOptions as { onPoolCreated(pool: ObservablePool): void }
    return { ...setup.initialized, em: { getKysely: () => driver.onPoolCreated(pool) } } as unknown as AppMikroORM
  })
  const runtime = await setup.getOrm()
  expect(setup.descriptor()?.purpose).toBe('runtime')
  context = { kind: 'maintenance', source: 'cli', tenantId: null, operation: 'reconcile' }
  const maintenance = await setup.getOrm()
  expect(setup.descriptor()?.purpose).toBe('maintenance')
  expect(maintenance).not.toBe(runtime)
  expect(setup.initialize.mock.calls.map(([options]) => options.clientUrl)).toEqual([
    'postgresql://test@127.0.0.1:1/disposable', 'postgresql://maintenance@127.0.0.1:1/disposable',
  ])
  context = { kind: 'tenant', source: 'worker', tenantId: '22222222-2222-4222-8222-222222222222' }
  expect(await setup.getOrm()).toBe(runtime)
  context = { kind: 'maintenance', source: 'cli', tenantId: null, operation: 'reconcile' }
  expect(await setup.getOrm()).toBe(maintenance)
  expect(setup.initialize).toHaveBeenCalledTimes(2)
})
