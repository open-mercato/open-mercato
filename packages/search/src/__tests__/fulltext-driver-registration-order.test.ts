jest.mock('meilisearch', () => ({ Meilisearch: jest.fn() }))

jest.mock('../lib/debug', () => ({
  reportSearchError: jest.fn(),
  searchWarn: jest.fn(),
  searchDebug: jest.fn(),
  searchDebugWarn: jest.fn(),
  searchError: jest.fn(),
  isSearchDebugEnabled: () => false,
}))

import { createContainer } from 'awilix'
import { registerScopedSearchModule, registerSearchModule } from '../di'
import { registerFulltextDriverFactory, type FulltextDriverFactory } from '../fulltext/drivers/registry'
import type { SearchStrategy } from '../types'

const originalEnv = { ...process.env }
const isHealthy = jest.fn(async () => true)

function providerModuleRegister(): () => void {
  const factory: FulltextDriverFactory = {
    id: 'fake',
    describe: () => ({ id: 'fake', label: 'Fake', envVars: [] }),
    isConfigured: (env = process.env) => Boolean(env.FAKE_URL),
    create: () => ({
      id: 'fake',
      ensureReady: async () => undefined,
      isHealthy,
      search: async () => [],
      index: async () => undefined,
      delete: async () => undefined,
    }),
  }
  return registerFulltextDriverFactory(factory)
}

let unregister: (() => void) | null = null

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv, FULLTEXT_DRIVER: 'fake', FAKE_URL: 'http://fake.test', SEARCH_DISABLE_SINGLETON_CACHE: '1' }
  delete process.env.MEILISEARCH_HOST
  delete (globalThis as Record<string, unknown>).__omSearchFulltextDriver__
})

afterEach(() => {
  unregister?.()
  unregister = null
  process.env = originalEnv
})

async function fulltextStrategy(strategies: SearchStrategy[]): Promise<SearchStrategy> {
  const strategy = strategies.find((entry) => entry.id === 'fulltext')
  expect(strategy).toBeDefined()
  return strategy as SearchStrategy
}

describe('provider-registered fulltext drivers reach the search module', () => {
  it('registerSearchModule builds the fulltext strategy from a factory registered by a module di.ts', async () => {
    unregister = providerModuleRegister()
    const container = createContainer()
    registerSearchModule(container, { skipTokens: true, skipVector: true, moduleConfigs: [] })
    const strategy = await fulltextStrategy(container.resolve<SearchStrategy[]>('searchStrategies'))
    await strategy.isAvailable()
    expect(isHealthy).toHaveBeenCalledTimes(1)
  })

  it('registerScopedSearchModule resolves the factory lazily at first use', async () => {
    const root = createContainer()
    registerScopedSearchModule(root, { skipTokens: true, skipVector: true, moduleConfigs: [] })
    unregister = providerModuleRegister()
    const scope = root.createScope()
    const strategy = await fulltextStrategy(scope.resolve<SearchStrategy[]>('searchStrategies'))
    await strategy.isAvailable()
    expect(isHealthy).toHaveBeenCalledTimes(1)
  })

  it('registers an unavailable fulltext strategy when the selected driver is not configured, so queued jobs retry', async () => {
    unregister = providerModuleRegister()
    delete process.env.FAKE_URL
    const container = createContainer()
    registerSearchModule(container, { skipTokens: true, skipVector: true, moduleConfigs: [] })
    const strategy = await fulltextStrategy(container.resolve<SearchStrategy[]>('searchStrategies'))
    await expect(strategy.isAvailable()).resolves.toBe(false)
    expect(isHealthy).not.toHaveBeenCalled()
  })

  it('registers no fulltext strategy when nothing selects or configures a driver', () => {
    delete process.env.FULLTEXT_DRIVER
    delete process.env.FAKE_URL
    const container = createContainer()
    registerSearchModule(container, { skipTokens: true, skipVector: true, moduleConfigs: [] })
    expect(container.resolve<SearchStrategy[]>('searchStrategies').some((entry) => entry.id === 'fulltext')).toBe(false)
  })
})
