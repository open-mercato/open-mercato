import { FullTextSearchStrategy } from '../strategies/fulltext.strategy'

/**
 * Coverage for issue #5931: the fulltext driver had no way to enumerate document
 * IDs for an entity+tenant without Meilisearch's maxTotalHits search-hit cap.
 * listDocumentIds uses index.getDocuments (not search), which is not subject to
 * that cap.
 */

describe('FullTextSearchStrategy.listDocumentIds', () => {
  it('returns null when the driver does not implement listDocumentIds', async () => {
    const driver = {
      ensureReady: jest.fn().mockResolvedValue(undefined),
      isHealthy: jest.fn().mockResolvedValue(true),
      search: jest.fn().mockResolvedValue([]),
      index: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    }
    const strategy = new FullTextSearchStrategy(driver as never)

    const result = await strategy.listDocumentIds('demo:item', 'tenant-1')

    expect(result).toBeNull()
  })

  it('forwards entityId, tenantId, and options to the driver and returns its result', async () => {
    const driver = {
      ensureReady: jest.fn().mockResolvedValue(undefined),
      isHealthy: jest.fn().mockResolvedValue(true),
      search: jest.fn().mockResolvedValue([]),
      index: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      listDocumentIds: jest.fn().mockResolvedValue(['rec-1', 'rec-2']),
    }
    const strategy = new FullTextSearchStrategy(driver as never)

    const result = await strategy.listDocumentIds('demo:item', 'tenant-1', {
      offset: 20,
      limit: 20,
      organizationId: 'org-A',
    })

    expect(driver.listDocumentIds).toHaveBeenCalledWith('demo:item', 'tenant-1', {
      offset: 20,
      limit: 20,
      organizationId: 'org-A',
    })
    expect(result).toEqual(['rec-1', 'rec-2'])
  })
})

describe('Meilisearch driver listDocumentIds', () => {
  function createFakeMeilisearchModule(getDocumentsImpl: jest.Mock) {
    return {
      Meilisearch: jest.fn().mockImplementation(() => ({
        index: jest.fn().mockReturnValue({ getDocuments: getDocumentsImpl }),
      })),
    }
  }

  async function loadDriverWithFakeClient(getDocumentsImpl: jest.Mock) {
    jest.resetModules()
    jest.doMock('meilisearch', () => createFakeMeilisearchModule(getDocumentsImpl))
    const { createMeilisearchDriver } = await import('../fulltext/drivers/meilisearch')
    return createMeilisearchDriver({ host: 'http://localhost:7700', indexPrefix: 'om' })
  }

  afterEach(() => {
    jest.dontMock('meilisearch')
  })

  it('maps getDocuments results to a plain string array, filtered by entity only', async () => {
    const getDocumentsImpl = jest.fn().mockResolvedValue({
      results: [{ _id: 'rec-1' }, { _id: 'rec-2' }],
      total: 2,
      offset: 0,
      limit: 20,
    })
    const driver = await loadDriverWithFakeClient(getDocumentsImpl)

    const ids = await driver.listDocumentIds!('demo:item', 'tenant-1')

    expect(ids).toEqual(['rec-1', 'rec-2'])
    expect(getDocumentsImpl).toHaveBeenCalledWith({
      filter: '_entityId = "demo:item"',
      fields: ['_id'],
      limit: 20,
      offset: 0,
    })
  })

  it('adds an _organizationId clause to the filter when organizationId is provided', async () => {
    const getDocumentsImpl = jest.fn().mockResolvedValue({ results: [], total: 0, offset: 0, limit: 10 })
    const driver = await loadDriverWithFakeClient(getDocumentsImpl)

    await driver.listDocumentIds!('demo:item', 'tenant-1', { offset: 40, limit: 10, organizationId: 'org-A' })

    expect(getDocumentsImpl).toHaveBeenCalledWith({
      filter: '_entityId = "demo:item" AND _organizationId = "org-A"',
      fields: ['_id'],
      limit: 10,
      offset: 40,
    })
  })

  it('returns an empty array when the index does not exist yet', async () => {
    const getDocumentsImpl = jest.fn().mockRejectedValue({ code: 'index_not_found' })
    const driver = await loadDriverWithFakeClient(getDocumentsImpl)

    const ids = await driver.listDocumentIds!('demo:item', 'tenant-1')

    expect(ids).toEqual([])
  })

  it('propagates errors other than index_not_found', async () => {
    const getDocumentsImpl = jest.fn().mockRejectedValue({ code: 'internal_error' })
    const driver = await loadDriverWithFakeClient(getDocumentsImpl)

    await expect(driver.listDocumentIds!('demo:item', 'tenant-1')).rejects.toEqual({ code: 'internal_error' })
  })
})
