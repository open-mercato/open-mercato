// Unit tests for the Phase 4 invalidation subscriber.
//
// The subscriber listens on `directory.organization.*` (wildcard
// suffix) and drops every OrganizationScope cache entry tagged for
// the affected tenant. The wildcard contract MUST cover the three
// concrete events declared in `directory/events.ts`
// (`directory.organization.created|updated|deleted`); without this
// safety net, an organization mutation would leave stale scopes in
// the cache until the 60s TTL backstop expires.

import handler, { metadata } from '@open-mercato/core/modules/directory/subscribers/invalidateOrgScopeCache'

function makeCtx(cache: { deleteByTags: jest.Mock } | null) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'cache' && cache) return cache as unknown as T
      throw new Error(`unexpected DI key: ${name}`)
    },
  }
}

describe('directory/invalidateOrgScopeCache subscriber', () => {
  it('declares the wildcard event metadata that covers every directory.organization.* mutation', () => {
    expect(metadata.event).toBe('directory.organization.*')
    expect(metadata.persistent).toBe(false)
    expect(metadata.id).toBe('directory:invalidate-org-scope-cache')
  })

  it('invokes cache.deleteByTags with the tenant-scoped org-scope tag when tenantId is present', async () => {
    const deleteByTags = jest.fn(async () => 3)
    await handler({ tenantId: 'tenant-123', id: 'org-xyz' }, makeCtx({ deleteByTags }))
    expect(deleteByTags).toHaveBeenCalledTimes(1)
    expect(deleteByTags).toHaveBeenCalledWith(['org-scope:tenant:tenant-123'])
  })

  it('is a no-op when tenantId is missing on the payload', async () => {
    const deleteByTags = jest.fn(async () => 0)
    await handler({ id: 'org-xyz' }, makeCtx({ deleteByTags }))
    expect(deleteByTags).not.toHaveBeenCalled()
  })

  it('is a no-op when no cache service is registered', async () => {
    await expect(
      handler({ tenantId: 'tenant-123' }, {
        resolve: <T = unknown>(name: string): T => {
          throw new Error(`unexpected DI key: ${name}`)
        },
      }),
    ).resolves.toBeUndefined()
  })

  it('swallows cache.deleteByTags failures so the TTL backstop wins', async () => {
    const deleteByTags = jest.fn(async () => {
      throw new Error('cache backend down')
    })
    await expect(
      handler({ tenantId: 'tenant-123' }, makeCtx({ deleteByTags })),
    ).resolves.toBeUndefined()
  })
})
