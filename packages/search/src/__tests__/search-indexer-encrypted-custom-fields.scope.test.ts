import { SearchIndexer } from '../indexer/search-indexer'
import type { EncryptedCustomFieldKeysResolver } from '../lib/encrypted-custom-field-resolver'
import type { SearchBuildContext } from '../types'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'

const entityId = 'example:todo'
const records = ['org-a', 'org-b'].map((organizationId) => ({
  id: organizationId,
  organization_id: organizationId,
  'cf:secret_a': 'SECRET-A',
  'cf:secret_b': 'SECRET-B',
}))

function createHarness() {
  const contexts: SearchBuildContext[] = []
  const hydrated: Record<string, unknown>[][] = []
  const resolver = jest.fn<ReturnType<EncryptedCustomFieldKeysResolver>, Parameters<EncryptedCustomFieldKeysResolver>>(
    async (_entity, scope) => new Set([scope?.organizationId === 'org-a' ? 'secret_a' : 'secret_b']),
  )
  const service = { index: jest.fn(async () => {}), bulkIndex: jest.fn(async () => {}) }
  const queryEngine: QueryEngine = {
    query: async (_entity, options) => {
      const id = (options?.filters as { id?: string } | undefined)?.id
      const items = id ? records.filter((record) => record.id === id) : records
      return { items, total: items.length } as QueryResult
    },
  }
  const indexer = new SearchIndexer(service as never, [{ entities: [{
    entityId,
    buildSource: async (context) => {
      contexts.push(context)
      const result = await context.queryEngine?.query('example:related', {
        tenantId: 'trusted-tenant',
        includeCustomFields: true,
        customFieldSources: [{ entityId, table: 'example_todos' }],
      })
      hydrated.push(result?.items as Record<string, unknown>[])
      return { text: JSON.stringify(context.record) }
    },
  }] }], { queryEngine, encryptedCustomFieldKeysResolver: resolver })
  return { indexer, contexts, hydrated, resolver }
}

it.each(['single', 'bulk', 'by-id'] as const)('preserves row organization policies across %s indexing and hydrated sources', async (mode) => {
  const harness = createHarness()
  const items = records.map((record) => ({ entityId, recordId: record.id, tenantId: 'trusted-tenant', record: { ...record } }))
  if (mode === 'single') {
    for (const item of items) await harness.indexer.indexRecord(item)
  } else if (mode === 'bulk') {
    await harness.indexer.bulkIndexRecords(items)
  } else {
    await harness.indexer.indexRecordsById({ items, tenantId: 'trusted-tenant' })
  }
  expect(harness.contexts.map((context) => context.record)).toEqual([
    { id: 'org-a', organization_id: 'org-a', 'cf:secret_b': 'SECRET-B' },
    { id: 'org-b', organization_id: 'org-b', 'cf:secret_a': 'SECRET-A' },
  ])
  for (const rows of harness.hydrated) expect(rows).toEqual(harness.contexts.map((context) => context.record))
  expect(harness.resolver).toHaveBeenCalledWith(entityId, { tenantId: 'trusted-tenant', organizationId: 'org-a' })
  expect(harness.resolver).toHaveBeenCalledWith(entityId, { tenantId: 'trusted-tenant', organizationId: 'org-b' })
  expect(harness.resolver).toHaveBeenCalledWith('example:related', { tenantId: 'trusted-tenant', organizationId: 'org-a' })
  expect(harness.resolver).toHaveBeenCalledWith('example:related', { tenantId: 'trusted-tenant', organizationId: 'org-b' })
})

it('excludes all callback custom fields without resolving an unknown organization', async () => {
  const harness = createHarness()
  await harness.indexer.indexRecord({
    entityId, recordId: 'unknown', tenantId: 'trusted-tenant',
    record: { id: 'unknown', 'cf:secret_a': 'SECRET-A' },
    customFields: { secret_a: 'SECRET-A' },
  })
  expect(harness.contexts[0].record).toEqual({ id: 'unknown' })
  expect(harness.contexts[0].customFields).toEqual({})
  expect(harness.resolver).not.toHaveBeenCalledWith(entityId, expect.objectContaining({ organizationId: undefined }))
})
