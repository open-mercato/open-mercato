/** @jest-environment node */

import { validatePrices } from '../priceValidator'
import { selectBestPrice } from '@open-mercato/core/modules/catalog/lib/pricing'

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

// Mirror the production wiring: prices are resolved through the catalog pricing
// engine (selectBestPrice + resolver pipeline) via the `catalogPricingService` DI
// token, never a bespoke "newest row" heuristic. Delegating to the real
// selectBestPrice exercises the actual channel/customer/quantity/time scoring.
const catalogPricingService = {
  resolvePrice: (rows: any[], context: any) => Promise.resolve(selectBestPrice(rows, context)),
}

const deps = { catalogProductPriceClass: MockPriceClass, catalogPricingService }

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

  it('returns empty array when the catalog pricing service is unavailable', async () => {
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
    ], scope, { catalogProductPriceClass: MockPriceClass } as any)

    expect(result).toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })

  it('detects warning-level price mismatch (5-20%)', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'EUR' },
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
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'EUR' },
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
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'USD' },
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
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'EUR' },
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
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'EUR' },
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
      .mockResolvedValueOnce([{ kind: 'regular', unitPriceNet: '10', currencyCode: 'EUR' }])   // prod-1: 10 vs 10 = ok
      .mockResolvedValueOnce([{ kind: 'regular', unitPriceNet: '50', currencyCode: 'EUR' }])   // prod-2: 50 vs 100 = 100% diff

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

  // --- Regression: validator must resolve prices through the catalog pricing engine,
  // honoring every pricing dimension instead of "most recently created row" (#2737). ---

  it('ignores an expired promotional price and compares against the valid base price', async () => {
    // Rows ordered promo-first to emulate the buggy "newest row wins" path.
    mockFindWithDecryption.mockResolvedValueOnce([
      { kind: 'promotion', unitPriceNet: '50.00', currencyCode: 'EUR', endsAt: new Date('2020-01-01T00:00:00Z') },
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'EUR' },
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

    expect(result).toEqual([])
  })

  it('ignores a price scoped to a different sales channel when the order has no channel', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { kind: 'regular', unitPriceNet: '70.00', currencyCode: 'EUR', channelId: 'channel-x' },
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'EUR' },
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

    expect(result).toEqual([])
  })

  it('respects quantity tiers when selecting the applicable price', async () => {
    // Below-tier quantity: the bulk tier must not apply, so the base price wins.
    mockFindWithDecryption.mockResolvedValueOnce([
      { kind: 'tier', unitPriceNet: '8.00', currencyCode: 'EUR', minQuantity: 100 },
      { kind: 'regular', unitPriceNet: '10.00', currencyCode: 'EUR', minQuantity: 1 },
    ])
    // At/above tier quantity: the bulk tier applies.
    mockFindWithDecryption.mockResolvedValueOnce([
      { kind: 'tier', unitPriceNet: '8.00', currencyCode: 'EUR', minQuantity: 100 },
      { kind: 'regular', unitPriceNet: '10.00', currencyCode: 'EUR', minQuantity: 1 },
    ])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            { productName: 'Below tier', productId: 'prod-1', unitPrice: '10', quantity: '5' },
            { productName: 'At tier', productId: 'prod-2', unitPrice: '8', quantity: '100' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
  })

  it('uses a customer-specific price when the order carries the customer reference', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'EUR' },
      { kind: 'custom', unitPriceNet: '80.00', currencyCode: 'EUR', customerId: 'cust-1' },
    ])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          customerEntityId: 'cust-1',
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '80', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
  })

  it('does not treat a customer-specific price as the default when the order omits the customer', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { kind: 'custom', unitPriceNet: '80.00', currencyCode: 'EUR', customerId: 'cust-1' },
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'EUR' },
    ])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            // Order claims the discounted price but provides no customer reference,
            // so it must be compared against the base price and flagged.
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '80', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('price_mismatch')
    expect(result[0].expectedValue).toBe('100.00')
  })

  it('selects the price matching the order currency instead of an unrelated-currency row', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([
      { kind: 'regular', unitPriceNet: '100.00', currencyCode: 'USD' },
      { kind: 'regular', unitPriceNet: '90.00', currencyCode: 'EUR' },
    ])

    const result = await validatePrices(mockEm, [
      {
        actionType: 'create_order',
        payload: {
          currencyCode: 'EUR',
          lineItems: [
            { productName: 'Widget A', productId: 'prod-1', unitPrice: '90', quantity: '1' },
          ],
        },
        index: 0,
      },
    ], scope, deps)

    expect(result).toEqual([])
  })
})
