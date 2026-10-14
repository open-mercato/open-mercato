import { findCurrencyAmountPrecisionError, resolveCurrencyAmountDecimalPlaces, resolveCurrencyDecimalPlaces } from '../currencyPrecision'

function containerWith(service: unknown) {
  return {
    resolve<T>(name: string): T {
      if (name === 'currencyPrecisionService' && service) return service as T
      throw new Error(`[internal] missing ${name}`)
    },
  }
}

describe('resolveCurrencyAmountDecimalPlaces', () => {
  const lookup = { code: 'ETH', tenantId: 'tenant-1', organizationId: 'org-1' }

  it('uses the tenant currency precision when it is higher than the floor', async () => {
    const service = { getDecimalPlaces: jest.fn(async () => 18) }
    await expect(resolveCurrencyAmountDecimalPlaces(containerWith(service), lookup)).resolves.toBe(18)
    expect(service.getDecimalPlaces).toHaveBeenCalledWith(lookup)
  })

  it('never goes below 4 decimal places', async () => {
    const service = { getDecimalPlaces: async () => 0 }
    await expect(resolveCurrencyAmountDecimalPlaces(containerWith(service), { ...lookup, code: 'JPY' })).resolves.toBe(4)
  })

  it('falls back to ISO digits when the service is missing or fails', async () => {
    await expect(resolveCurrencyAmountDecimalPlaces(containerWith(null), { ...lookup, code: 'USD' })).resolves.toBe(4)
    const failing = { getDecimalPlaces: async () => { throw new Error('[internal] db down') } }
    await expect(resolveCurrencyAmountDecimalPlaces(containerWith(failing), { ...lookup, code: 'USD' })).resolves.toBe(4)
  })

  it('falls back to the floor for unknown currency codes', async () => {
    const service = { getDecimalPlaces: async () => null }
    await expect(resolveCurrencyAmountDecimalPlaces(containerWith(service), { ...lookup, code: 'XYZW' })).resolves.toBe(4)
  })

  it('returns null for well-formed codes the runtime does not know', async () => {
    const service = { getDecimalPlaces: async () => null }
    await expect(resolveCurrencyDecimalPlaces(containerWith(service), { ...lookup, code: 'ETH' })).resolves.toBeNull()
    await expect(resolveCurrencyDecimalPlaces(containerWith(null), { ...lookup, code: 'XYZ' })).resolves.toBeNull()
    await expect(resolveCurrencyDecimalPlaces(containerWith(null), { ...lookup, code: 'KWD' })).resolves.toBe(3)
  })
})

describe('findCurrencyAmountPrecisionError', () => {
  it('returns precision details with canonical amounts and currency codes', () => {
    expect(findCurrencyAmountPrecisionError({ amount: '10.0050', currencyCode: ' usd ', decimalPlaces: 2 })).toEqual({
      amount: '10.005', currencyCode: 'USD', decimalPlaces: 2,
    })
  })

  it('caps configured precision at ISO minor units', () => {
    expect(findCurrencyAmountPrecisionError({ amount: '10.005', currencyCode: 'USD', decimalPlaces: 4 }))
      .toEqual({ amount: '10.005', currencyCode: 'USD', decimalPlaces: 2 })
    expect(findCurrencyAmountPrecisionError({ amount: '10.5', currencyCode: 'USD', decimalPlaces: 0 }))
      .toEqual({ amount: '10.5', currencyCode: 'USD', decimalPlaces: 0 })
  })

  it('preserves configured precision for non-ISO currencies', () => {
    expect(findCurrencyAmountPrecisionError({ amount: '0.000000000000000001', currencyCode: 'ETH', decimalPlaces: 18 })).toBeNull()
    expect(findCurrencyAmountPrecisionError({ amount: '0.0000000000000000001', currencyCode: 'ETH', decimalPlaces: 18 }))
      .toEqual({ amount: '0.0000000000000000001', currencyCode: 'ETH', decimalPlaces: 18 })
  })

  it('accepts trailing zeros and skips unknown precision or invalid inputs', () => {
    expect(findCurrencyAmountPrecisionError({ amount: '10.0500', currencyCode: 'USD', decimalPlaces: 2 })).toBeNull()
    expect(findCurrencyAmountPrecisionError({ amount: '1.123456', currencyCode: 'XYZ', decimalPlaces: null })).toBeNull()
    expect(findCurrencyAmountPrecisionError({ amount: 'invalid', currencyCode: 'USD', decimalPlaces: 2 })).toBeNull()
    expect(findCurrencyAmountPrecisionError({ amount: '10.005', currencyCode: null, decimalPlaces: 2 })).toBeNull()
  })
})
