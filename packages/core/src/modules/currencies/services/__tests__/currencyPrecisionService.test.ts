import { describe, it, expect, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CurrencyPrecisionService } from '../currencyPrecisionService'

type CurrencyRecord = { code?: string; decimalPlaces: number; symbol?: string | null }

function createService(record: CurrencyRecord | null) {
  const findOne = jest.fn(async () => record)
  const service = new CurrencyPrecisionService({ findOne } as unknown as EntityManager)
  return { service, findOne }
}

describe('CurrencyPrecisionService', () => {
  it('returns the currency decimal places scoped to the organization', async () => {
    const { service, findOne } = createService({ decimalPlaces: 18 })
    await expect(service.getDecimalPlaces({ code: ' eth ', tenantId: 't1', organizationId: 'o1' })).resolves.toBe(18)
    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      { code: 'ETH', tenantId: 't1', organizationId: 'o1', deletedAt: null },
      expect.anything(),
    )
  })

  it('never looks a currency up without an organization', async () => {
    const { service, findOne } = createService({ decimalPlaces: 18 })
    await expect(service.getDecimalPlaces({ code: 'ETH', tenantId: 't1' })).resolves.toBeNull()
    await expect(service.getDecimalPlaces({ code: '', tenantId: 't1', organizationId: 'o1' })).resolves.toBeNull()
    expect(findOne).not.toHaveBeenCalled()
  })

  it('returns null for an unknown currency', async () => {
    const { service } = createService(null)
    await expect(service.getDecimalPlaces({ code: 'ETH', tenantId: 't1', organizationId: 'o1' })).resolves.toBeNull()
  })

  it('looks each currency up once per service instance', async () => {
    const { service, findOne } = createService({ decimalPlaces: 8 })
    const lookup = { code: 'BTC', tenantId: 't1', organizationId: 'o1' }
    await expect(Promise.all([service.getDecimalPlaces(lookup), service.getDecimalPlaces(lookup)])).resolves.toEqual([8, 8])
    await expect(service.getDecimalPlaces({ ...lookup, code: 'btc' })).resolves.toBe(8)
    expect(findOne).toHaveBeenCalledTimes(1)
  })

  it('returns the currency code, decimal places and symbol', async () => {
    const { service } = createService({ code: 'USD', decimalPlaces: 2, symbol: '$' })
    await expect(service.getCurrency({ code: 'usd', tenantId: 't1', organizationId: 'o1' })).resolves.toEqual({
      code: 'USD',
      decimalPlaces: 2,
      symbol: '$',
    })
  })

  it('returns a null symbol when the currency has none', async () => {
    const { service } = createService({ code: 'ETH', decimalPlaces: 18, symbol: '' })
    await expect(service.getCurrency({ code: 'ETH', tenantId: 't1', organizationId: 'o1' })).resolves.toEqual({
      code: 'ETH',
      decimalPlaces: 18,
      symbol: null,
    })
  })

  it('returns null currency details without an organization or for an unknown code', async () => {
    const { service, findOne } = createService({ code: 'ETH', decimalPlaces: 18 })
    await expect(service.getCurrency({ code: 'ETH', tenantId: 't1' })).resolves.toBeNull()
    expect(findOne).not.toHaveBeenCalled()
    const unknown = createService(null)
    await expect(unknown.service.getCurrency({ code: 'XYZ', tenantId: 't1', organizationId: 'o1' })).resolves.toBeNull()
  })

  it('shares one query between getCurrency and getDecimalPlaces', async () => {
    const { service, findOne } = createService({ code: 'JPY', decimalPlaces: 0, symbol: '¥' })
    const lookup = { code: 'JPY', tenantId: 't1', organizationId: 'o1' }
    await expect(service.getCurrency(lookup)).resolves.toEqual({ code: 'JPY', decimalPlaces: 0, symbol: '¥' })
    await expect(service.getDecimalPlaces(lookup)).resolves.toBe(0)
    expect(findOne).toHaveBeenCalledTimes(1)
  })
})
