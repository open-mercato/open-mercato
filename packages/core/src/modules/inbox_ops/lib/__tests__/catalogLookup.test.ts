/** @jest-environment node */

import { fetchCatalogProductsForExtraction } from '../catalogLookup'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockEm = {} as any
const MockProductClass = class {} as any
const MockPriceClass = class {} as any

const scope = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const deps = { catalogProductClass: MockProductClass, catalogProductPriceClass: MockPriceClass }

describe('fetchCatalogProductsForExtraction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns products with prices mapped', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([
        { id: 'p-1', title: 'Widget A', sku: 'WA-001' },
        { id: 'p-2', title: 'Widget B', sku: null },
      ])
      .mockResolvedValueOnce([
        { product: 'p-1', unitPriceNet: '19.99', unitPriceGross: '23.99', createdAt: new Date() },
        { product: 'p-2', unitPriceNet: '9.50', unitPriceGross: null, createdAt: new Date() },
      ])

    const result = await fetchCatalogProductsForExtraction(mockEm, scope, deps)

    expect(result).toEqual([
      { id: 'p-1', name: 'Widget A', sku: 'WA-001', price: '19.99' },
      { id: 'p-2', name: 'Widget B', sku: undefined, price: '9.50' },
    ])
  })

  it('returns empty array when catalog is empty', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])

    const result = await fetchCatalogProductsForExtraction(mockEm, scope, deps)

    expect(result).toEqual([])
    expect(mockFindWithDecryption).toHaveBeenCalledTimes(1)
  })

  it('returns undefined price for products without matching prices', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([
        { id: 'p-1', title: 'No Price Product', sku: 'NP-1' },
      ])
      .mockResolvedValueOnce([]) // no prices found

    const result = await fetchCatalogProductsForExtraction(mockEm, scope, deps)

    expect(result).toEqual([
      { id: 'p-1', name: 'No Price Product', sku: 'NP-1', price: undefined },
    ])
  })

  it('returns empty array on DB error (graceful fallback)', async () => {
    mockFindWithDecryption.mockRejectedValue(new Error('DB connection failed'))

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

    const result = await fetchCatalogProductsForExtraction(mockEm, scope, deps)

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(
      '[inbox_ops:catalogLookup] Failed to fetch catalog products:',
      expect.any(Error),
    )

    consoleSpy.mockRestore()
  })

  it('limits to 50 products', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([]) // products
    // no second call expected when 0 products

    await fetchCatalogProductsForExtraction(mockEm, scope, deps)

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ limit: 50 }),
      scope,
    )
  })

  it('prefers unitPriceNet over unitPriceGross', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([
        { id: 'p-1', title: 'Product', sku: null },
      ])
      .mockResolvedValueOnce([
        { product: 'p-1', unitPriceNet: '10.00', unitPriceGross: '12.00', createdAt: new Date() },
      ])

    const result = await fetchCatalogProductsForExtraction(mockEm, scope, deps)

    expect(result[0].price).toBe('10.00')
  })

  it('falls back to unitPriceGross when unitPriceNet is null', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([
        { id: 'p-1', title: 'Product', sku: null },
      ])
      .mockResolvedValueOnce([
        { product: 'p-1', unitPriceNet: null, unitPriceGross: '12.00', createdAt: new Date() },
      ])

    const result = await fetchCatalogProductsForExtraction(mockEm, scope, deps)

    expect(result[0].price).toBe('12.00')
  })

  it('uses first price per product (ordered by createdAt DESC)', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([
        { id: 'p-1', title: 'Product', sku: null },
      ])
      .mockResolvedValueOnce([
        { product: 'p-1', unitPriceNet: '15.00', unitPriceGross: null, createdAt: new Date('2026-02-01') },
        { product: 'p-1', unitPriceNet: '10.00', unitPriceGross: null, createdAt: new Date('2026-01-01') },
      ])

    const result = await fetchCatalogProductsForExtraction(mockEm, scope, deps)

    expect(result[0].price).toBe('15.00')
  })
})
