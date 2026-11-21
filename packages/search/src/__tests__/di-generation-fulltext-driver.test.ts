const mockCreateIndex = jest.fn(async () => undefined)
const mockUpdateSettings = jest.fn(async () => undefined)
const mockAddDocuments = jest.fn(async (_documents: unknown[]) => undefined)

jest.mock('meilisearch', () => ({
  Meilisearch: jest.fn().mockImplementation(() => ({
    createIndex: mockCreateIndex,
    index: () => ({ updateSettings: mockUpdateSettings, addDocuments: mockAddDocuments }),
  })),
}))

import { asValue, createContainer } from 'awilix'
import { registerScopedSearchModule } from '../di'
import type { SearchStrategy } from '../types'

const originalEnv = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv, MEILISEARCH_HOST: 'http://search.test', SEARCH_EXCLUDE_ENCRYPTED_FIELDS: 'off' }
  delete process.env.SEARCH_DISABLE_SINGLETON_CACHE
})
afterEach(() => { process.env = originalEnv })

function database(encryptedField = 'secret') {
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'where', 'orderBy']) query[method] = jest.fn(() => query)
  query.execute = jest.fn(async () => [{ fields_json: [{ field: encryptedField }] }])
  return { selectFrom: jest.fn(() => query) }
}

function generation(excluded = 'secret') {
  const root = createContainer()
  registerScopedSearchModule(root, {
    skipTokens: true, skipVector: true,
    moduleConfigs: [{ entities: [{ entityId: 'probe:record', fieldPolicy: { excluded: [excluded] } }] }],
  })
  const firstDb = database('first_secret')
  const secondDb = database('second_secret')
  const first = root.createScope().register({ em: asValue({ getKysely: () => firstDb }) })
  const second = root.createScope().register({ em: asValue({ getKysely: () => secondDb }) })
  return { first, second, firstDb, secondDb }
}

const record = {
  entityId: 'probe:record', recordId: 'record', tenantId: 'same-tenant',
  fields: { title: 'Visible', secret: 'hidden', first_secret: 'first', second_secret: 'second' },
}

it('coalesces tenant index creation and settings across callers without retaining their SQL accessors', async () => {
  const { first, second, firstDb, secondDb } = generation()
  const firstStrategy = first.resolve<SearchStrategy[]>('searchStrategies')[0]
  const secondStrategy = second.resolve<SearchStrategy[]>('searchStrategies')[0]
  expect(firstStrategy).not.toBe(secondStrategy)
  expect(first.resolve('searchIndexer')).not.toBe(second.resolve('searchIndexer'))
  await Promise.all([firstStrategy.index(record), secondStrategy.index({ ...record, recordId: 'second' })])
  await secondStrategy.index({ ...record, recordId: 'third' })
  expect(mockCreateIndex).toHaveBeenCalledTimes(1)
  expect(mockUpdateSettings).toHaveBeenCalledTimes(1)
  expect(mockAddDocuments).toHaveBeenCalledTimes(3)
  expect(mockAddDocuments.mock.calls[0][0][0]).not.toHaveProperty('secret')
  expect(firstDb.selectFrom).not.toHaveBeenCalled()
  expect(secondDb.selectFrom).not.toHaveBeenCalled()
})

it('owns driver initialization per generation and uses that generation field policy', async () => {
  const oldGeneration = generation('secret')
  const nextGeneration = generation('title')
  await oldGeneration.first.resolve<SearchStrategy[]>('searchStrategies')[0].index(record)
  await nextGeneration.first.resolve<SearchStrategy[]>('searchStrategies')[0].index(record)
  expect(mockCreateIndex).toHaveBeenCalledTimes(2)
  expect(mockUpdateSettings).toHaveBeenCalledTimes(2)
  expect(mockAddDocuments.mock.calls[0][0][0]).toHaveProperty('title', 'Visible')
  expect(mockAddDocuments.mock.calls[1][0][0]).not.toHaveProperty('title')
})

it.each(['encrypted', 'disabled-cache'])('keeps fulltext drivers scoped for %s mode', async (mode) => {
  if (mode === 'encrypted') process.env.SEARCH_EXCLUDE_ENCRYPTED_FIELDS = 'on'
  else process.env.SEARCH_DISABLE_SINGLETON_CACHE = '1'
  const { first, second, firstDb, secondDb } = generation()
  await Promise.all([
    first.resolve<SearchStrategy[]>('searchStrategies')[0].index(record),
    second.resolve<SearchStrategy[]>('searchStrategies')[0].index(record),
  ])
  expect(mockCreateIndex).toHaveBeenCalledTimes(2)
  expect(mockUpdateSettings).toHaveBeenCalledTimes(2)
  if (mode === 'encrypted') {
    expect(firstDb.selectFrom).toHaveBeenCalledWith('encryption_maps')
    expect(secondDb.selectFrom).toHaveBeenCalledWith('encryption_maps')
  }
})
