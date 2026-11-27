jest.mock('../fulltext/drivers', () => ({ createFulltextDriver: jest.fn(() => null) }))

import { asValue, createContainer } from 'awilix'
import { registerScopedSearchModule } from '../di'
import type { SearchIndexer } from '../indexer/search-indexer'
import type { SearchBuildContext } from '../types'

function definitionsDatabase(encryptedField: string) {
  const query: Record<string, jest.Mock> = {}
  for (const method of ['select', 'where']) query[method] = jest.fn(() => query)
  query.execute = jest.fn(async () => [{ key: encryptedField, config_json: { encrypted: true } }])
  return { selectFrom: jest.fn(() => query) }
}

it('indexes with each caller SQL policy and container even when its sibling resolves first', async () => {
  const root = createContainer()
  const contexts: SearchBuildContext[] = []
  registerScopedSearchModule(root, {
    skipTokens: true,
    skipVector: true,
    skipFulltext: true,
    moduleConfigs: [{ entities: [{
      entityId: 'probe:record',
      enabled: true,
      buildSource: async (context) => {
        await Promise.resolve()
        contexts.push(context)
        return { text: 'safe text' }
      },
    }] }],
  })
  const firstDb = definitionsDatabase('secret_a')
  const secondDb = definitionsDatabase('secret_b')
  const first = root.createScope().register({ em: asValue({ getKysely: () => firstDb }), auth: asValue('first') })
  const second = root.createScope().register({ em: asValue({ getKysely: () => secondDb }), auth: asValue('second') })
  const secondIndexer = second.resolve<SearchIndexer>('searchIndexer')
  const firstIndexer = first.resolve<SearchIndexer>('searchIndexer')
  expect(firstIndexer).not.toBe(secondIndexer)
  expect(first.resolve('searchService')).not.toBe(second.resolve('searchService'))
  expect(first.resolve('searchIndexer')).toBe(firstIndexer)
  const record = { id: 'record', 'cf:secret_a': 'private-a', 'cf:secret_b': 'private-b' }
  await Promise.all([
    firstIndexer.indexRecord({ entityId: 'probe:record', recordId: 'record', tenantId: 'tenant-a', record, customFields: { secret_a: 'private-a', secret_b: 'private-b' } }),
    secondIndexer.indexRecord({ entityId: 'probe:record', recordId: 'record', tenantId: 'tenant-b', record, customFields: { secret_a: 'private-a', secret_b: 'private-b' } }),
  ])
  const firstContext = contexts.find((context) => context.tenantId === 'tenant-a')!
  const secondContext = contexts.find((context) => context.tenantId === 'tenant-b')!
  expect(firstContext.container?.resolve('auth')).toBe('first')
  expect(secondContext.container?.resolve('auth')).toBe('second')
  expect(firstContext.customFields).toEqual({ secret_b: 'private-b' })
  expect(secondContext.customFields).toEqual({ secret_a: 'private-a' })
  expect(firstDb.selectFrom).toHaveBeenCalledWith('custom_field_defs')
  expect(secondDb.selectFrom).toHaveBeenCalledWith('custom_field_defs')
})
