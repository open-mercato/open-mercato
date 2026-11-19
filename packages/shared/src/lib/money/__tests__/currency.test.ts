import { describe, expect, it, jest } from '@jest/globals'
import type { CurrencyPrecisionResolver } from '../../currencyPrecision'
import { assertSameCurrency, currenciesEqual, resolveCurrency } from '../currency'
import { CurrencyMismatchError, CurrencyNotResolvedError } from '../errors'
import { createContainer, createResolver, currencyOf, defaultTable, scope } from './helpers'

describe('resolveCurrency', () => {
  it('reads code, decimal places and symbol through getCurrency', async () => {
    const resolver = createResolver(defaultTable)
    const getCurrency = jest.spyOn(resolver, 'getCurrency')
    const getDecimalPlaces = jest.spyOn(resolver, 'getDecimalPlaces')
    const currency = await resolveCurrency(createContainer(resolver), { code: ' usd ', ...scope })
    expect(currency).toEqual({ code: 'USD', decimalPlaces: 2, symbol: '$' })
    expect(getCurrency).toHaveBeenCalledWith({ code: 'USD', ...scope })
    expect(getDecimalPlaces).not.toHaveBeenCalled()
  })

  it('falls back to getDecimalPlaces with a null symbol when the resolver has no getCurrency', async () => {
    const resolver: CurrencyPrecisionResolver = { getDecimalPlaces: async () => 8 }
    await expect(resolveCurrency(createContainer(resolver), { code: 'BTC', ...scope })).resolves.toEqual({
      code: 'BTC',
      decimalPlaces: 8,
      symbol: null,
    })
  })

  it('throws when the precision service is not registered', async () => {
    await expect(resolveCurrency(createContainer(null), { code: 'USD', ...scope })).rejects.toBeInstanceOf(
      CurrencyNotResolvedError,
    )
  })

  it('throws instead of falling back to ISO when the resolver returns null', async () => {
    const resolver: CurrencyPrecisionResolver = { getDecimalPlaces: async () => null }
    const error = await resolveCurrency(createContainer(resolver), { code: 'USD', tenantId: 't1' }).catch((err) => err)
    expect(error).toBeInstanceOf(CurrencyNotResolvedError)
    expect((error as CurrencyNotResolvedError).code).toBe('USD')
    expect((error as Error).message.startsWith('[internal]')).toBe(true)
  })

  it('keeps the original error as cause when the resolver throws', async () => {
    const failure = new Error('db down')
    const resolver: CurrencyPrecisionResolver = {
      getDecimalPlaces: async () => {
        throw failure
      },
    }
    const error = await resolveCurrency(createContainer(resolver), { code: 'USD', ...scope }).catch((err) => err)
    expect(error).toBeInstanceOf(CurrencyNotResolvedError)
    expect((error as Error).cause).toBe(failure)
  })

  it.each(['US', 'USDT', '12A', '', 'u$d'])('rejects the invalid code %p', async (code) => {
    const resolver = createResolver(defaultTable)
    const getCurrency = jest.spyOn(resolver, 'getCurrency')
    await expect(resolveCurrency(createContainer(resolver), { code, ...scope })).rejects.toBeInstanceOf(
      CurrencyNotResolvedError,
    )
    expect(getCurrency).not.toHaveBeenCalled()
  })

  it.each([-1, 51, 2.5, Number.NaN])('rejects the invalid decimal places %p from the resolver', async (decimalPlaces) => {
    const resolver: CurrencyPrecisionResolver = { getDecimalPlaces: async () => decimalPlaces }
    await expect(resolveCurrency(createContainer(resolver), { code: 'USD', ...scope })).rejects.toBeInstanceOf(
      CurrencyNotResolvedError,
    )
  })

  it.each([
    ['tenant', { code: 'USD', tenantId: '', organizationId: 'o1' }],
    ['organization', { code: 'USD', tenantId: 't1' }],
    ['null organization', { code: 'USD', tenantId: 't1', organizationId: null }],
    ['blank organization', { code: 'USD', tenantId: 't1', organizationId: '  ' }],
  ])('rejects a lookup without a %s before calling either resolver variant', async (_label, lookup) => {
    const decimalPlacesOnly: CurrencyPrecisionResolver = { getDecimalPlaces: jest.fn(async () => 2) }
    await expect(resolveCurrency(createContainer(decimalPlacesOnly), lookup)).rejects.toBeInstanceOf(
      CurrencyNotResolvedError,
    )
    expect(decimalPlacesOnly.getDecimalPlaces).not.toHaveBeenCalled()
    const withDetails = createResolver(defaultTable)
    const getCurrency = jest.spyOn(withDetails, 'getCurrency')
    await expect(resolveCurrency(createContainer(withDetails), lookup)).rejects.toBeInstanceOf(CurrencyNotResolvedError)
    expect(getCurrency).not.toHaveBeenCalled()
  })

  it('returns a frozen currency', async () => {
    const currency = await currencyOf('USD')
    expect(Object.isFrozen(currency)).toBe(true)
    expect(() => {
      ;(currency as { decimalPlaces: number }).decimalPlaces = 4
    }).toThrow(TypeError)
    expect(currency.decimalPlaces).toBe(2)
  })
})

describe('currency equality', () => {
  it('compares code and decimal places and ignores the symbol', async () => {
    const usd = await currencyOf('USD')
    const usdWithoutSymbol = await currencyOf('USD', { USD: { decimalPlaces: 2 } })
    const usdFourPlaces = await currencyOf('USD', { USD: { decimalPlaces: 4 } })
    const eur = await currencyOf('EUR')
    expect(currenciesEqual(usd, usdWithoutSymbol)).toBe(true)
    expect(currenciesEqual(usd, usdFourPlaces)).toBe(false)
    expect(currenciesEqual(usd, eur)).toBe(false)
    expect(() => assertSameCurrency(usd, usdWithoutSymbol)).not.toThrow()
    expect(() => assertSameCurrency(usd, usdFourPlaces)).toThrow(CurrencyMismatchError)
  })

  it('carries both currencies on a mismatch error', async () => {
    const usd = await currencyOf('USD')
    const eur = await currencyOf('EUR')
    const error = (() => {
      try {
        assertSameCurrency(usd, eur)
      } catch (err) {
        return err
      }
    })() as CurrencyMismatchError
    expect(error.left).toBe(usd)
    expect(error.right).toBe(eur)
    expect(error.message.startsWith('[internal]')).toBe(true)
  })
})
