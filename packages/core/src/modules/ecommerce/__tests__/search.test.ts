jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

import searchConfig from '../search'

function getStoreEntity() {
  const entity = searchConfig.entities.find((entry) => entry.entityId === 'ecommerce:ecommerce_store')
  if (!entity) throw new Error('ecommerce:ecommerce_store missing from search config')
  return entity
}

describe('ecommerce search config', () => {
  it('declares ACL, enablement and field policy', () => {
    const entity = getStoreEntity()
    expect(entity.aclFeatures).toEqual(['ecommerce.stores.view'])
    expect(entity.enabled).toBe(true)
    expect(entity.fieldPolicy?.searchable).toEqual(['name', 'code', 'slug'])
    expect(entity.fieldPolicy?.excluded).toEqual(['settings'])
  })

  it('builds an index source from name, code and slug without status or settings', async () => {
    const entity = getStoreEntity()
    const source = await entity.buildSource?.({
      record: { id: 's1', name: 'Main store', code: 'main', slug: 'main-store', status: 'active', settings: { secret: 'x' } },
      customFields: {},
    } as never)
    expect(source?.text).toEqual(['Name: Main store', 'Code: main', 'Slug: main-store'])
    expect(source?.presenter?.title).toBe('Main store')
    expect(source?.presenter?.subtitle).toBe('main · main-store · Active')
  })

  it('returns null when there is nothing searchable', async () => {
    const entity = getStoreEntity()
    const source = await entity.buildSource?.({ record: { id: 's1', status: 'draft' }, customFields: {} } as never)
    expect(source).toBeNull()
  })

  it('formats a result with name title and code, slug, status subtitle', async () => {
    const entity = getStoreEntity()
    const presenter = await entity.formatResult?.({
      record: { id: 's1', name: 'Outlet', code: 'outlet', slug: 'outlet-eu', status: 'archived' },
      customFields: {},
    } as never)
    expect(presenter).toMatchObject({ title: 'Outlet', subtitle: 'outlet · outlet-eu · Archived', badge: 'Store' })
  })

  it('resolves the store configuration URL', async () => {
    const entity = getStoreEntity()
    expect(await entity.resolveUrl?.({ record: { id: 'abc-1' }, customFields: {} } as never)).toBe('/backend/config/ecommerce/abc-1')
    expect(await entity.resolveUrl?.({ record: {}, customFields: {} } as never)).toBeNull()
  })
})
