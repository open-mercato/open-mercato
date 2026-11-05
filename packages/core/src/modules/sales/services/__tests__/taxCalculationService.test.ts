import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DefaultTaxCalculationService } from '../taxCalculationService'

describe('DefaultTaxCalculationService', () => {
  const baseInput = {
    amount: 100,
    mode: 'net' as const,
    organizationId: 'org-1',
    tenantId: 'tenant-1',
  }

  it('resolves rates via identifier and calculates gross amounts', async () => {
    const em = {
      findOne: jest.fn().mockResolvedValue({ rate: 20 }),
    }
    const service = new DefaultTaxCalculationService(em as any)
    const result = await service.calculateUnitAmounts({ ...baseInput, taxRateId: 'rate-1' })

    expect(result).toEqual({
      netAmount: 100,
      grossAmount: 120,
      taxAmount: 20,
      taxRate: 20,
    })
    expect(em.findOne).toHaveBeenCalled()
  })

  it('throws when the referenced tax class cannot be found', async () => {
    const em = { findOne: jest.fn().mockResolvedValue(null) }
    const service = new DefaultTaxCalculationService(em as any)

    await expect(service.calculateUnitAmounts({ ...baseInput, taxRateId: 'missing' })).rejects.toBeInstanceOf(CrudHttpError)
    expect(em.findOne).toHaveBeenCalled()
  })

  it('calculates net from gross amounts when rate provided inline', async () => {
    const em = { findOne: jest.fn() }
    const service = new DefaultTaxCalculationService(em as any)
    const result = await service.calculateUnitAmounts({ ...baseInput, amount: 120, mode: 'gross', taxRate: '5.5' })

    expect(result.netAmount).toBeCloseTo(113.7441, 4)
    expect(result.taxAmount).toBeCloseTo(6.2559, 4)
    expect(result.taxRate).toBe(5.5)
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('throws for invalid amount or mode', async () => {
    const em = { findOne: jest.fn() }
    const service = new DefaultTaxCalculationService(em as any)

    await expect(service.calculateUnitAmounts({ ...baseInput, amount: -1 })).rejects.toBeInstanceOf(CrudHttpError)
    await expect(service.calculateUnitAmounts({ ...baseInput, mode: 'unknown' as any })).rejects.toBeInstanceOf(CrudHttpError)
  })

  it('honors event bus hooks to mutate input and override results', async () => {
    const em = { findOne: jest.fn() }
    const before = jest.fn()
    const after = jest.fn()
    const eventBus = {
      emitEvent: jest.fn(async (event: string, payload: any) => {
        if (event === 'sales.tax.calculate.before') {
          before()
          payload.setInput({ taxRate: 10, taxRateId: null })
        } else if (event === 'sales.tax.calculate.after') {
          after()
          payload.setResult({ netAmount: 10, grossAmount: 11, taxAmount: 1, taxRate: 10 })
        }
      }),
    }
    const service = new DefaultTaxCalculationService(em as any, eventBus as any)

    const result = await service.calculateUnitAmounts({ ...baseInput, amount: 10, taxRateId: 'ignored' })

    expect(result).toEqual({ netAmount: 10, grossAmount: 11, taxAmount: 1, taxRate: 10 })
    expect(before).toHaveBeenCalled()
    expect(after).toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
  })
})
