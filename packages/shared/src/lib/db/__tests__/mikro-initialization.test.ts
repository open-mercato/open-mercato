import type { AppMikroORM } from '../mikro'

const entitiesKey = '__openMercatoOrmEntities__'
const globals = globalThis as Record<string, unknown>
const originalEntities = globals[entitiesKey]
const originalDatabaseUrl = process.env.DATABASE_URL

beforeEach(() => {
  jest.resetModules()
  process.env.DATABASE_URL = 'postgresql://localhost/orm_initialization_test'
})

afterEach(() => {
  jest.restoreAllMocks()
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = originalDatabaseUrl
  if (originalEntities === undefined) delete globals[entitiesKey]
  else globals[entitiesKey] = originalEntities
})

test('concurrent callers share one initialization and retain the resulting ORM', async () => {
  const { MikroORM } = await import('@mikro-orm/core')
  const { getOrm, registerOrmEntities } = await import('../mikro')
  registerOrmEntities([])
  const instance = { em: {} } as AppMikroORM
  let finishInitialization!: (orm: AppMikroORM) => void
  const initialization = new Promise<AppMikroORM>((resolve) => {
    finishInitialization = resolve
  })
  const initialize = jest.spyOn(MikroORM, 'init').mockImplementation(() => initialization)

  const callers = Array.from({ length: 8 }, () => getOrm())
  expect(initialize).toHaveBeenCalledTimes(1)
  finishInitialization(instance)
  const results = await Promise.all(callers)

  expect(results.every((result) => result === instance)).toBe(true)
  expect(await getOrm()).toBe(instance)
  expect(initialize).toHaveBeenCalledTimes(1)
})

test('all waiting callers receive initialization failure and a later call can retry', async () => {
  const { MikroORM } = await import('@mikro-orm/core')
  const { getOrm, registerOrmEntities } = await import('../mikro')
  registerOrmEntities([])
  const failure = new Error('Database unavailable')
  const instance = { em: {} } as AppMikroORM
  const initialize = jest.spyOn(MikroORM, 'init')
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(instance)

  const results = await Promise.allSettled([getOrm(), getOrm(), getOrm()])

  expect(results).toEqual(Array.from({ length: 3 }, () => ({ status: 'rejected', reason: failure })))
  expect(initialize).toHaveBeenCalledTimes(1)
  expect(await getOrm()).toBe(instance)
  expect(initialize).toHaveBeenCalledTimes(2)
})
