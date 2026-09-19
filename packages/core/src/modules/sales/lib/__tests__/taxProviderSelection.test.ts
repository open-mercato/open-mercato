jest.mock('@open-mercato/shared/lib/logger', () => {
  const globalStore = globalThis as typeof globalThis & { __omTestLoggerMock?: Record<string, jest.Mock> }
  if (!globalStore.__omTestLoggerMock) {
    const mocked: Record<string, jest.Mock> = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    }
    mocked.child.mockImplementation(() => mocked)
    globalStore.__omTestLoggerMock = mocked
  }
  return { createLogger: jest.fn(() => globalStore.__omTestLoggerMock) }
})

import {
  invalidateTaxProviderSelection,
  readTaxProviderSelection,
  taxProviderSelectionCacheKey,
  taxProviderSelectionCacheTags,
  TAX_PROVIDER_SELECTION_TTL_SECONDS,
} from '../taxProviderSelection'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function makeEm(row: Record<string, unknown> | null) {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    async findOne(_entity: unknown, where: Record<string, unknown>) {
      calls.push(where)
      return row
    },
  } as never as Parameters<typeof readTaxProviderSelection>[0]['em'] & {
    calls: Array<Record<string, unknown>>
  }
}

function makeCache() {
  const store = new Map<string, unknown>()
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    delete: jest.fn(async (key: string) => store.delete(key)),
    deleteByTags: jest.fn(async () => 0),
  }
}

function containerWith(cache: unknown) {
  return { resolve: (key: string) => (key === 'cache' ? cache : undefined) }
}

describe('tax provider selection cache key', () => {
  it('always carries both scope ids, so no organization can read another', () => {
    expect(taxProviderSelectionCacheKey(scope)).toBe('sales:tax-provider:tenant-1:org-1')
    expect(taxProviderSelectionCacheKey({ tenantId: 'tenant-2', organizationId: 'org-1' })).not.toBe(
      taxProviderSelectionCacheKey(scope)
    )
    expect(taxProviderSelectionCacheKey({ tenantId: 'tenant-1', organizationId: 'org-2' })).not.toBe(
      taxProviderSelectionCacheKey(scope)
    )
  })

  it('tags the entry for tenant, organization and settings invalidation', () => {
    expect(taxProviderSelectionCacheTags(scope)).toEqual([
      'tenant:tenant-1',
      'org:org-1',
      'sales:settings',
    ])
  })
})

describe('readTaxProviderSelection', () => {
  it('reads the row and caches it with both scope ids in the key', async () => {
    const em = makeEm({
      taxProviderKey: 'external-tax',
      taxProviderSettings: { rate: 5 },
      taxProviderTimeoutMs: 2000,
      shipFromAddress: { city: 'Austin' },
    })
    const cache = makeCache()
    const row = await readTaxProviderSelection({ em, container: containerWith(cache), ...scope })

    expect(row).toEqual({
      providerKey: 'external-tax',
      providerSettings: { rate: 5 },
      timeoutMs: 2000,
      shipFromAddress: { city: 'Austin' },
    })
    expect(em.calls[0]).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(cache.set).toHaveBeenCalledWith(
      'sales:tax-provider:tenant-1:org-1',
      row,
      expect.objectContaining({ ttl: TAX_PROVIDER_SELECTION_TTL_SECONDS })
    )
  })

  it('serves a second read from the cache without touching the database', async () => {
    const em = makeEm({ taxProviderKey: 'external-tax' })
    const cache = makeCache()
    await readTaxProviderSelection({ em, container: containerWith(cache), ...scope })
    await readTaxProviderSelection({ em, container: containerWith(cache), ...scope })
    expect(em.calls).toHaveLength(1)
  })

  it('returns the empty selection when the organization has no settings row', async () => {
    const em = makeEm(null)
    const row = await readTaxProviderSelection({ em, container: null, ...scope })
    expect(row).toEqual({
      providerKey: null,
      providerSettings: null,
      timeoutMs: null,
      shipFromAddress: null,
    })
  })

  it('falls through to the row when no cache is registered', async () => {
    const em = makeEm({ taxProviderKey: 'external-tax' })
    const row = await readTaxProviderSelection({ em, container: { resolve: () => undefined }, ...scope })
    expect(row.providerKey).toBe('external-tax')
    expect(em.calls).toHaveLength(1)
  })

  it('falls through to the row when the cache read throws', async () => {
    const em = makeEm({ taxProviderKey: 'external-tax' })
    const cache = makeCache()
    cache.get.mockRejectedValueOnce(new Error('cache down'))
    // A tax calculation must never fail because a cache is unavailable.
    const row = await readTaxProviderSelection({ em, container: containerWith(cache), ...scope })
    expect(row.providerKey).toBe('external-tax')
  })

  it('falls through to the row when resolving the cache throws', async () => {
    const em = makeEm({ taxProviderKey: 'external-tax' })
    const container = {
      resolve: () => {
        throw new Error('not registered')
      },
    }
    const row = await readTaxProviderSelection({ em, container, ...scope })
    expect(row.providerKey).toBe('external-tax')
  })
})

describe('invalidateTaxProviderSelection', () => {
  it('drops the scoped key and the settings tag', async () => {
    const cache = makeCache()
    await invalidateTaxProviderSelection({ container: containerWith(cache), ...scope })
    expect(cache.delete).toHaveBeenCalledWith('sales:tax-provider:tenant-1:org-1')
    expect(cache.deleteByTags).toHaveBeenCalledWith(['sales:settings'])
  })

  it('is a no-op without a cache', async () => {
    await expect(
      invalidateTaxProviderSelection({ container: null, ...scope })
    ).resolves.toBeUndefined()
  })

  it('swallows a failing invalidation rather than failing the write that already committed', async () => {
    const cache = makeCache()
    cache.delete.mockRejectedValueOnce(new Error('cache down'))
    await expect(
      invalidateTaxProviderSelection({ container: containerWith(cache), ...scope })
    ).resolves.toBeUndefined()
  })
})
