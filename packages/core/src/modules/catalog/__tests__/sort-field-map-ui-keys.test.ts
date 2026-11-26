/** @jest-environment node */

type CrudConfig = { list?: { sortFieldMap?: Record<string, string> } }

const mockMakeCrudRoute = jest.fn((_config: CrudConfig) => ({
  metadata: {},
  GET: jest.fn(),
  POST: jest.fn(),
  PUT: jest.fn(),
  DELETE: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (config: CrudConfig) => mockMakeCrudRoute(config),
}))

async function loadSortFieldMap(routePath: string): Promise<Record<string, string>> {
  jest.resetModules()
  mockMakeCrudRoute.mockClear()
  await import(routePath)
  const config = mockMakeCrudRoute.mock.calls[0]?.[0]
  return config?.list?.sortFieldMap ?? {}
}

describe('catalog sortFieldMap covers the sort keys UI callers send', () => {
  it('products route accepts title (ProductsDataTable, LineItemDialog), updatedAt and updated_at (catalog-seo-report widget)', async () => {
    const map = await loadSortFieldMap('../api/products/route')
    expect(map.title).toBe('title')
    expect(map.updatedAt).toBe('updated_at')
    expect(map.updated_at).toBe('updated_at')
  })

  it('offers route accepts updatedAt (sales channel offers page default sort)', async () => {
    const map = await loadSortFieldMap('../api/offers/route')
    expect(map.updatedAt).toBe('updated_at')
  })
})
