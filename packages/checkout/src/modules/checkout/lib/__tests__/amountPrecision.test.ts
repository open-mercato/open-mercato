import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import enDictionary from '../../i18n/en.json'
import plDictionary from '../../i18n/pl.json'
import { findCheckoutChargePrecisionError, roundCheckoutConfiguredAmounts, toStoredCheckoutAmounts } from '../amountPrecision'

const mockResolveTranslations = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: () => mockResolveTranslations(),
}))

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }

const CURRENCY_DECIMALS: Record<string, number> = { USD: 2, JPY: 0, ETH: 18 }

function makeContainer() {
  const getDecimalPlaces = jest.fn(async ({ code }: { code: string }) => CURRENCY_DECIMALS[code] ?? null)
  return {
    getDecimalPlaces,
    container: {
      resolve: <T,>(name: string): T => {
        if (name !== 'currencyPrecisionService') throw new Error(`[internal] missing ${name}`)
        return { getDecimalPlaces } as T
      },
    },
  }
}

describe('roundCheckoutConfiguredAmounts', () => {
  it('rounds fixed and custom amounts half-up to a 2-decimal currency', async () => {
    const { container } = makeContainer()
    const rounded = await roundCheckoutConfiguredAmounts(container, SCOPE, {
      fixedPriceAmount: 10.005,
      fixedPriceAmountExact: '10.005',
      fixedPriceOriginalAmount: 12.344,
      fixedPriceOriginalAmountExact: '12.344',
      fixedPriceCurrencyCode: 'USD',
      customAmountMin: 10.001,
      customAmountMinExact: '10.001',
      customAmountMax: 10.005,
      customAmountMaxExact: '10.005',
      customAmountCurrencyCode: 'USD',
    })

    expect(rounded).toMatchObject({
      fixedPriceAmount: 10.01,
      fixedPriceAmountExact: '10.01',
      fixedPriceOriginalAmount: 12.34,
      fixedPriceOriginalAmountExact: '12.34',
      customAmountMin: 10,
      customAmountMinExact: '10',
      customAmountMax: 10.01,
      customAmountMaxExact: '10.01',
    })
    expect(toStoredCheckoutAmounts(rounded)).toEqual({
      fixedPriceAmount: '10.01',
      fixedPriceOriginalAmount: '12.34',
      customAmountMin: '10',
      customAmountMax: '10.01',
    })
  })

  it('rounds to whole units for a 0-decimal currency, including price-list items', async () => {
    const { container } = makeContainer()
    const rounded = await roundCheckoutConfiguredAmounts(container, SCOPE, {
      fixedPriceAmount: 1234.5,
      fixedPriceAmountExact: '1234.5',
      fixedPriceCurrencyCode: 'JPY',
      priceListItems: [
        { id: 'a', description: 'A', amount: 99.4, amountExact: '99.4', currencyCode: 'JPY' },
        { id: 'b', description: 'B', amount: 99.5, currencyCode: 'JPY' },
      ],
    })

    expect(rounded.fixedPriceAmount).toBe(1235)
    expect(rounded.fixedPriceAmountExact).toBe('1235')
    expect(rounded.priceListItems).toEqual([
      { id: 'a', description: 'A', amount: 99, amountExact: '99', currencyCode: 'JPY' },
      { id: 'b', description: 'B', amount: 100, amountExact: '100', currencyCode: 'JPY' },
    ])
  })

  it('keeps every digit for an 18-decimal currency', async () => {
    const { container } = makeContainer()
    const rounded = await roundCheckoutConfiguredAmounts(container, SCOPE, {
      fixedPriceAmount: Number('1234.567890123456789012'),
      fixedPriceAmountExact: '1234.567890123456789012',
      fixedPriceCurrencyCode: 'ETH',
      customAmountMin: Number('1.000000000000000001'),
      customAmountMinExact: '1.000000000000000001',
      customAmountCurrencyCode: 'ETH',
      priceListItems: [
        { id: 'a', description: 'A', amount: Number('0.000000000000000001'), amountExact: '0.000000000000000001', currencyCode: 'ETH' },
      ],
    })

    expect(rounded.fixedPriceAmountExact).toBe('1234.567890123456789012')
    expect(rounded.customAmountMinExact).toBe('1.000000000000000001')
    expect(rounded.priceListItems?.[0]?.amountExact).toBe('0.000000000000000001')
  })

  it('falls back to 2 decimals without a currency and leaves absent fields untouched', async () => {
    const { container, getDecimalPlaces } = makeContainer()
    const rounded = await roundCheckoutConfiguredAmounts(container, SCOPE, {
      fixedPriceAmount: 5.555,
      customAmountMin: null,
    })

    expect(rounded).toEqual({
      fixedPriceAmount: 5.56,
      fixedPriceAmountExact: '5.56',
      customAmountMin: null,
      customAmountMinExact: null,
    })
    expect(getDecimalPlaces).not.toHaveBeenCalled()
  })

  it('looks each currency up once per call', async () => {
    const { container, getDecimalPlaces } = makeContainer()
    await roundCheckoutConfiguredAmounts(container, SCOPE, {
      fixedPriceAmount: 1,
      fixedPriceOriginalAmount: 2,
      fixedPriceCurrencyCode: 'USD',
      priceListItems: [
        { id: 'a', description: 'A', amount: 1, currencyCode: 'USD' },
        { id: 'b', description: 'B', amount: 2, currencyCode: 'USD' },
      ],
    })

    expect(getDecimalPlaces).toHaveBeenCalledTimes(1)
    expect(getDecimalPlaces).toHaveBeenCalledWith({ code: 'USD', tenantId: 'tenant-1', organizationId: 'org-1' })
  })
})

describe('findCheckoutChargePrecisionError', () => {
  beforeEach(() => {
    mockResolveTranslations.mockResolvedValue({ translate: createFallbackTranslator(enDictionary) })
  })

  it('rejects charges exceeding ISO minor units when tenant precision is higher', async () => {
    const container = { resolve: <T,>(): T => ({ getDecimalPlaces: async () => 4 }) as T }

    await expect(findCheckoutChargePrecisionError(container, SCOPE, { amount: '10.0051', currencyCode: 'USD' }))
      .resolves.toEqual({ error: 'Amount 10.0051 has more decimal places than USD supports (2)' })
  })

  it('checks the rounded checkout amount at the configured currency precision', async () => {
    const { container } = makeContainer()

    await expect(findCheckoutChargePrecisionError(container, SCOPE, { amount: '10.005', currencyCode: 'USD' })).resolves.toBeNull()
    await expect(findCheckoutChargePrecisionError(container, SCOPE, { amount: '0.000000000000000001', currencyCode: 'ETH' })).resolves.toBeNull()
  })

  it('uses checkout translations without depending on the gateway dictionary', async () => {
    mockResolveTranslations.mockResolvedValue({ translate: createFallbackTranslator(plDictionary) })
    const container = { resolve: <T,>(): T => ({ getDecimalPlaces: async () => 4 }) as T }

    await expect(findCheckoutChargePrecisionError(container, SCOPE, { amount: '10.0051', currencyCode: 'USD' }))
      .resolves.toEqual({ error: 'Kwota 10.0051 ma więcej miejsc po przecinku, niż obsługuje waluta USD (2)' })
  })

  it('falls back to checkout English translations outside a request', async () => {
    mockResolveTranslations.mockRejectedValue(new Error('[internal] no request locale'))
    const container = { resolve: <T,>(): T => ({ getDecimalPlaces: async () => 4 }) as T }

    await expect(findCheckoutChargePrecisionError(container, SCOPE, { amount: '10.0051', currencyCode: 'USD' }))
      .resolves.toEqual({ error: 'Amount 10.0051 has more decimal places than USD supports (2)' })
  })
})
