import { EventEmitter } from 'node:events'
import type { AppMikroORM, ObservablePool } from '../mikro'

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

async function prepare(ready: () => Promise<void>, calls: string[]) {
  const { MikroORM } = await import('@mikro-orm/core')
  const runtime = await import('../runtime')
  const pool = Object.assign(new EventEmitter(), {
    connect: jest.fn(), totalCount: 0, idleCount: 0, waitingCount: 0,
    ended: false,
    end: jest.fn(async () => { calls.push('end'); pool.ended = true }),
  })
  let initializePool: () => void = () => undefined
  const initialized = {
    em: { getKysely: jest.fn(() => initializePool()) },
    close: jest.fn(async () => { calls.push('close') }),
  } as unknown as AppMikroORM
  runtime.registerDatabaseRuntimeAdapter({
    id: 'test', version: '1', configurationKey: 'test',
    configurePool: () => ({ ready, dispose: () => { calls.push('dispose') } }),
    run: (_context, callback) => callback(),
  })
  const initialize = jest.spyOn(MikroORM, 'init').mockImplementation(async (options) => {
    const driverOptions = options.driverOptions as { onPoolCreated(pool: ObservablePool): void }
    initializePool = () => driverOptions.onPoolCreated(pool)
    return initialized
  })
  const { getOrm, registerOrmEntities } = await import('../mikro')
  registerOrmEntities([])
  return { getOrm, initialize, initialized, pool, runtime }
}

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
