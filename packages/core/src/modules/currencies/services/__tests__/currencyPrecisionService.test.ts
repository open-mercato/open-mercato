import { describe, it, expect, jest } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CurrencyPrecisionService } from '../currencyPrecisionService'

function createService(record: { decimalPlaces: number } | null) {
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
})
