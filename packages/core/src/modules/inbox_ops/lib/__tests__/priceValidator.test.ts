/** @jest-environment node */

import { validatePrices } from '../priceValidator'

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

const mockEm = {} as any
const MockPriceClass = class {} as any

const scope = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const deps = { catalogProductPriceClass: MockPriceClass }

describe('validatePrices', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD
  })

  it('returns empty array for non-order actions', async () => {
    const result = await validatePrices(mockEm, [
      { actionType: 'create_contact', payload: {}, index: 0 },
      { actionType: 'log_activity', payload: {}, index: 1 },
    ], scope, deps)

    expect(result).toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('detects warning-level price mismatch (5-20%)', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { unitPriceNet: '100.00', currencyCode: 'EUR' },
    ])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '110', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('price_mismatch')
    expect(result[0].severity).toBe('warning')
    expect(result[0].expectedValue).toBe('100.00')
    expect(result[0].foundValue).toBe('110')
    expect(result[0].actionIndex).toBe(0)
  })

  it('detects error-level price mismatch (>20%)', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { unitPriceNet: '100.00', currencyCode: 'EUR' },
    ])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_quote',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '150', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toHaveLength(1)
    expect(result[0].severity).toBe('error')
  })

  it('detects currency mismatch between order and catalog', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { unitPriceNet: '100.00', currencyCode: 'USD' },
    ])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '100', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('currency_mismatch')
    expect(result[0].severity).toBe('warning')
    expect(result[0].expectedValue).toBe('USD')
    expect(result[0].foundValue).toBe('EUR')
  })

  it('skips line items without productId', async () => {
    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          lineItems: [
            { productName: 'Unknown item', unitPrice: '50', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('skips line items without unitPrice', async () => {
    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('skips when catalog price is not found', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '50', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
  })

  it('passes when price is within threshold', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { unitPriceNet: '100.00', currencyCode: 'EUR' },
    ])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '102', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
  })

  it('uses custom threshold from environment variable', async () => {
    process.env.INBOX_OPS_PRICE_MISMATCH_THRESHOLD = '0.10'

    mockFindWithDecryption.mockResolvedValueOnce([
      { unitPriceNet: '100.00', currencyCode: 'EUR' },
    ])

    // 8% diff - under 10% custom threshold
    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '108', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
  })

  it('handles multiple line items and multiple actions', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([{ unitPriceNet: '10', currencyCode: 'EUR' }])   // prod-1: 10 vs 10 = ok
      .mockResolvedValueOnce([{ unitPriceNet: '50', currencyCode: 'EUR' }])   // prod-2: 50 vs 100 = 100% diff

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '10', quantity: '5' },
            { productName: 'Widget B', productId: 'prod-2', unitPrice: '100', quantity: '2' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toHaveLength(1)
    expect(result[0].description).toContain('Widget B')
  })

  it('handles lookup errors gracefully', async () => {
    mockFindWithDecryption.mockRejectedValueOnce(new Error('DB error'))

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '50', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
  })

  it('handles empty lineItems array', async () => {
    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: { lineItems: [] },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
  })
})
