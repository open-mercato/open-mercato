import type { EntityManager } from '@mikro-orm/postgresql'
import { DefaultTaxCalculationService } from '@open-mercato/core/modules/sales/services/taxCalculationService'
import { calculatePriceUnitAmounts, calculateUnitAmountsLocally } from '../priceUnitAmounts'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, fallback?: string) => `${key}|${fallback ?? ''}`,
  }),
}))

const scope = {
  organizationId: '33333333-3333-4333-8333-333333333333',
  tenantId: '22222222-2222-4222-8222-222222222222',
}

const containerWithoutSales = {
  resolve: <R,>(name: string): R => {
    throw new Error(`[internal] Could not resolve '${name}'`)
  },
}

describe('calculateUnitAmountsLocally', () => {
  const salesService = new DefaultTaxCalculationService({} as EntityManager, null)
  const cases: Array<Parameters<typeof calculateUnitAmountsLocally>[0]> = [
    { amount: 100, mode: 'net', taxRate: 23 },
    { amount: 123, mode: 'gross', taxRate: 23 },
    { amount: 19.99, mode: 'gross', taxRate: '8.5' },
    { amount: 0.3333, mode: 'net', taxRate: 7 },
    { amount: 50, mode: 'gross', taxRate: 0 },
    { amount: 50, mode: 'net', taxRate: null },
    { amount: 50, mode: 'gross', taxRate: undefined },
    { amount: 50, mode: 'net', taxRate: 'not-a-number' },
    { amount: 50, mode: 'gross', taxRate: -5 },
    { amount: 50, mode: 'net', taxRate: '' },
  ]

  it.each(cases)('matches the sales tax calculation for %o', async (input) => {
    const expected = await salesService.calculateUnitAmounts({ ...input, ...scope })
    expect(calculateUnitAmountsLocally(input)).toEqual(expected)
  })
})

describe('calculatePriceUnitAmounts', () => {
  it('delegates to the sales tax calculation service when it is registered', async () => {
    const result = { netAmount: 1, grossAmount: 2, taxAmount: 1, taxRate: 100 }
    const calculateUnitAmounts = jest.fn().mockResolvedValue(result)
    const container = {
      resolve: <R,>(name: string): R => {
        if (name !== 'taxCalculationService') throw new Error(`[internal] unexpected ${name}`)
        return { calculateUnitAmounts } as R
      },
    }
    const input = { amount: 1, mode: 'net' as const, taxRateId: '55555555-5555-4555-8555-555555555555', ...scope }
    await expect(calculatePriceUnitAmounts(container, input)).resolves.toBe(result)
    expect(calculateUnitAmounts).toHaveBeenCalledWith(input)
  })

  it('calculates locally when the sales module is disabled', async () => {
    await expect(
      calculatePriceUnitAmounts(containerWithoutSales, { amount: 100, mode: 'net', taxRate: 23, taxRateId: null, ...scope }),
    ).resolves.toEqual({ netAmount: 100, grossAmount: 123, taxAmount: 23, taxRate: 23 })
  })

  it('rejects a tax class with a translated 400 when the sales module is disabled', async () => {
    await expect(
      calculatePriceUnitAmounts(containerWithoutSales, {
        amount: 100,
        mode: 'net',
        taxRateId: '55555555-5555-4555-8555-555555555555',
        ...scope,
      }),
    ).rejects.toMatchObject({
      status: 400,
      body: { error: 'catalog.prices.errors.taxClassUnavailable|Tax classes are not available.' },
    })
  })
})
