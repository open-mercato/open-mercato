/** @jest-environment node */

const mockMakeCrudRoute = jest.fn(() => ({
  metadata: {},
  GET: jest.fn(),
  POST: jest.fn(),
  PUT: jest.fn(),
  DELETE: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (...args: unknown[]) => mockMakeCrudRoute(...args),
}))

describe('catalog products route enricher config', () => {
  beforeEach(() => {
    jest.resetModules()
    mockMakeCrudRoute.mockClear()
  })

  it('opts the products route into catalog.product enrichers', async () => {
    await import('../products/route')

    expect(mockMakeCrudRoute).toHaveBeenCalled()
    expect(mockMakeCrudRoute.mock.calls[0]?.[0]?.enrichers).toEqual({
      entityId: 'catalog:catalog_product',
    })
  })
})
