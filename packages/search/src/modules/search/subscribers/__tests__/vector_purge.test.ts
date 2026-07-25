jest.mock('@open-mercato/shared/lib/indexers/status-log', () => ({
  recordIndexerLog: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@open-mercato/shared/lib/indexers/error-log', () => ({
  recordIndexerError: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@open-mercato/core/modules/query_index/lib/coverage', () => ({
  writeCoverageCounts: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../lib/embedding-config', () => ({
  resolveEmbeddingConfig: jest.fn().mockResolvedValue(null),
}))

import handle from '../vector_purge'

/**
 * Regression coverage for issue #2935 (sibling of the DELETE endpoint fix):
 * the query_index.vectorize_purge subscriber received an organizationId in the
 * event payload but dropped it when calling purgeEntity, performing a
 * tenant-wide purge that destroys other organizations' vector entries during an
 * org-scoped force-reindex. organizationId must now flow into purgeEntity.
 */
function createCtx(purgeEntity: jest.Mock) {
  return {
    resolve: jest.fn((name: string) => {
      if (name === 'searchIndexer') return { purgeEntity }
      throw new Error(`not registered: ${name}`)
    }),
  }
}

describe('query_index.vectorize_purge subscriber organization scoping (issue #2935)', () => {
  it('forwards the payload organizationId to purgeEntity (org-scoped purge)', async () => {
    const purgeEntity = jest.fn().mockResolvedValue(undefined)

    await handle(
      { entityType: 'demo:item', tenantId: 'tenant-1', organizationId: 'org-A' },
      createCtx(purgeEntity) as never,
    )

    expect(purgeEntity).toHaveBeenCalledTimes(1)
    expect(purgeEntity).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'demo:item', tenantId: 'tenant-1', organizationId: 'org-A' }),
    )
  })

  it('performs a tenant-wide purge (organizationId null) when the event carries no organization', async () => {
    const purgeEntity = jest.fn().mockResolvedValue(undefined)

    await handle({ entityType: 'demo:item', tenantId: 'tenant-1' }, createCtx(purgeEntity) as never)

    expect(purgeEntity).toHaveBeenCalledTimes(1)
    expect((purgeEntity.mock.calls[0][0] as { organizationId?: string | null }).organizationId).toBeNull()
  })
})
