import { registerSearchModule, type SearchContainer } from '../di'
import type { SearchIndexer } from '../indexer/search-indexer'
import type { FullTextSearchDocument } from '../fulltext/types'

jest.mock('awilix', () => ({ asValue: (value: unknown) => ({ _value: value }) }))
jest.mock('../fulltext/drivers', () => ({
  createFulltextDriver: () => ({
    id: 'capture',
    ensureReady: async () => {},
    isHealthy: async () => true,
    search: async () => [],
    index: async (document: FullTextSearchDocument) => { mockDocuments.push(document) },
    delete: async () => {},
  }),
}))

const mockDocuments: FullTextSearchDocument[] = []
const originalSingletonSetting = process.env.SEARCH_DISABLE_SINGLETON_CACHE

beforeEach(() => {
  mockDocuments.length = 0
  process.env.SEARCH_DISABLE_SINGLETON_CACHE = '1'
})

afterAll(() => {
  if (originalSingletonSetting === undefined) delete process.env.SEARCH_DISABLE_SINGLETON_CACHE
  else process.env.SEARCH_DISABLE_SINGLETON_CACHE = originalSingletonSetting
})

function makeContainer(em?: unknown): SearchContainer {
  const registrations: Record<string, unknown> = {}
  return {
    resolve<T>(name: string): T {
      if (name === 'em' && em) return em as T
      if (name in registrations) return registrations[name] as T
      throw new Error('[internal] Missing registration')
    },
    register(values) {
      for (const [key, resolver] of Object.entries(values)) {
        registrations[key] = (resolver as { _value: unknown })._value
      }
    },
  }
}

function registerIndexer(container: SearchContainer): SearchIndexer {
  registerSearchModule(container, {
    skipTokens: true,
    skipVector: true,
    defaultStrategies: ['fulltext'],
    moduleConfigs: [{ entities: [{ entityId: 'example:todo' }] }],
  })
  return container.resolve<SearchIndexer>('searchIndexer')
}

async function index(indexer: SearchIndexer) {
  await indexer.indexRecord({
    entityId: 'example:todo', recordId: 'record-1', tenantId: 'tenant-1',
    record: { title: 'Public title', cf_secret: 'PRIVATE', cf_note: 'Public note' },
  })
}

it('wires live definitions into the production indexer independently of the base-column encryption flag', async () => {
  const query = {
    select: () => query,
    where: () => query,
    execute: async () => [{ key: 'secret', config_json: { encrypted: true } }],
  }
  const container = makeContainer({ getKysely: () => ({ selectFrom: () => query }) })

  await index(registerIndexer(container))

  expect(mockDocuments[0].fields).toEqual({ title: 'Public title', cf_note: 'Public note' })
})

it('fails closed for custom fields when the DI container has no entity manager', async () => {
  await index(registerIndexer(makeContainer()))

  expect(mockDocuments[0].fields).toEqual({ title: 'Public title' })
})

it('fails closed for custom fields when the live definition query fails', async () => {
  const container = makeContainer({ getKysely: () => ({ selectFrom: () => { throw new Error('[internal] Lookup failed') } }) })

  await index(registerIndexer(container))

  expect(mockDocuments[0].fields).toEqual({ title: 'Public title' })
})
