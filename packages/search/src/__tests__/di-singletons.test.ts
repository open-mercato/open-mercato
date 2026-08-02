jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    end: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
    connect: jest.fn(),
  })),
}))

jest.mock('@open-mercato/shared/lib/redis/connection', () => ({
  getRedisUrlOrThrow: jest.fn().mockReturnValue('redis://localhost:6379'),
}))

jest.mock('../queue/vector-indexing', () => ({
  createVectorIndexingQueue: jest.fn().mockImplementation(() => ({
    name: 'vector-indexing',
    strategy: 'local',
    enqueue: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}))

jest.mock('../queue/fulltext-indexing', () => ({
  createFulltextIndexingQueue: jest.fn().mockImplementation(() => ({
    name: 'fulltext-indexing',
    strategy: 'local',
    enqueue: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}))

jest.mock('../vector', () => ({
  EmbeddingService: jest.fn().mockImplementation(() => ({ _id: Math.random() })),
  createPgVectorDriver: jest.fn().mockImplementation(() => ({ _id: Math.random() })),
  createChromaDbDriver: jest.fn().mockReturnValue({}),
  createQdrantDriver: jest.fn().mockReturnValue({}),
}))

jest.mock('awilix', () => ({
  asValue: (v: unknown) => ({ _value: v }),
}))

jest.mock('../fulltext/drivers', () => ({
  createFulltextDriver: jest.fn().mockImplementation(() => ({ _id: Math.random() })),
}))

import { register } from '../modules/search/di'
import { registerSearchModule } from '../di'
import { createFulltextDriver } from '../fulltext/drivers'

const SINGLETON_KEYS = [
  '__omSearchEmbeddingService__',
  '__omSearchVectorDrivers__',
  '__omSearchVectorIndexQueue__',
  '__omSearchFulltextIndexQueue__',
  '__omSearchVectorPgPool__',
  '__omSearchSingletonsShutdown__',
  '__omSearchFulltextDriver__',
] as const

function clearSingletonGlobals() {
  for (const key of SINGLETON_KEYS) {
    delete (globalThis as Record<string, unknown>)[key]
  }
}

function makeMockContainer() {
  const registered: Record<string, unknown> = {}
  return {
    resolve: jest.fn().mockImplementation((name: string) => {
      if (name in registered) return registered[name]
      throw new Error(`[mock] Not registered: ${name}`)
    }),
    register: jest.fn().mockImplementation((regs: Record<string, { _value: unknown }>) => {
      for (const [key, reg] of Object.entries(regs)) {
        registered[key] = reg._value
      }
    }),
    _registered: registered,
  }
}

describe('search module DI — vector singleton cache', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    clearSingletonGlobals()
    process.env = { ...originalEnv, DATABASE_URL: 'postgres://localhost/test' }
  })

  afterAll(() => {
    process.env = originalEnv
    clearSingletonGlobals()
  })

  it('returns the same EmbeddingService instance on consecutive registrations', () => {
    const c1 = makeMockContainer()
    const c2 = makeMockContainer()
    register(c1 as never)
    register(c2 as never)

    expect(c1._registered.vectorEmbeddingService).toBe(c2._registered.vectorEmbeddingService)
  })

  it('returns fresh EmbeddingService instances when SEARCH_DISABLE_SINGLETON_CACHE=1', () => {
    process.env.SEARCH_DISABLE_SINGLETON_CACHE = '1'
    const c1 = makeMockContainer()
    const c2 = makeMockContainer()
    register(c1 as never)
    register(c2 as never)

    expect(c1._registered.vectorEmbeddingService).not.toBe(c2._registered.vectorEmbeddingService)
  })

  it('reuses the same vectorDrivers array when cache is enabled', () => {
    const c1 = makeMockContainer()
    const c2 = makeMockContainer()
    register(c1 as never)
    register(c2 as never)

    expect(c1._registered.vectorDrivers).toBe(c2._registered.vectorDrivers)
  })
})

describe('registerSearchModule — fulltext driver canMemoize guard', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    clearSingletonGlobals()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
    clearSingletonGlobals()
  })

  it('reuses the cached fulltext driver when SEARCH_EXCLUDE_ENCRYPTED_FIELDS is not set', () => {
    const c1 = makeMockContainer()
    const c2 = makeMockContainer()
    registerSearchModule(c1 as never, { skipVector: true, skipTokens: true })
    registerSearchModule(c2 as never, { skipVector: true, skipTokens: true })

    expect(jest.mocked(createFulltextDriver)).toHaveBeenCalledTimes(1)
  })

  it('does not cache fulltext driver when SEARCH_DISABLE_SINGLETON_CACHE=1', () => {
    process.env.SEARCH_DISABLE_SINGLETON_CACHE = '1'
    const c1 = makeMockContainer()
    const c2 = makeMockContainer()
    registerSearchModule(c1 as never, { skipVector: true, skipTokens: true })
    registerSearchModule(c2 as never, { skipVector: true, skipTokens: true })

    expect(jest.mocked(createFulltextDriver)).toHaveBeenCalledTimes(2)
  })

  it('does not cache fulltext driver when SEARCH_EXCLUDE_ENCRYPTED_FIELDS is enabled', () => {
    process.env.SEARCH_EXCLUDE_ENCRYPTED_FIELDS = 'true'
    const c1 = makeMockContainer()
    const c2 = makeMockContainer()
    registerSearchModule(c1 as never, { skipVector: true, skipTokens: true })
    registerSearchModule(c2 as never, { skipVector: true, skipTokens: true })

    expect(jest.mocked(createFulltextDriver)).toHaveBeenCalledTimes(2)
  })
})
