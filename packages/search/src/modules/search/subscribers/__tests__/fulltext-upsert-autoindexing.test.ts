jest.mock('../../lib/auto-indexing', () => ({
  resolveAutoIndexingEnabled: jest.fn().mockResolvedValue(false),
}))

import fulltextUpsert from '../fulltext_upsert'

/**
 * The auto-indexing switch (OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING) only controls the vector
 * strategy. With it on, new and restored records must still reach the full-text queue.
 */
describe('fulltext_upsert with vector auto-indexing disabled', () => {
  it('still enqueues the full-text index job', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined)
    const ctx = {
      resolve: jest.fn((name: string) => {
        if (name === 'fulltextIndexQueue') return { enqueue }
        throw new Error(`[internal] not registered: ${name}`)
      }),
    }

    await fulltextUpsert(
      { entityId: 'customers:customer_person', recordId: 'r1', tenantId: 'tenant-1', organizationId: 'org-1' },
      ctx,
    )

    expect(enqueue).toHaveBeenCalledWith({
      jobType: 'index',
      entityType: 'customers:customer_person',
      recordId: 'r1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
  })
})
