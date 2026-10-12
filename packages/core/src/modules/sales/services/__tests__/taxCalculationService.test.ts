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
      netAmountExact: '100',
      grossAmount: 120,
      grossAmountExact: '120',
      taxAmount: 20,
      taxAmountExact: '20',
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

  it('keeps exact amounts and rounds to the requested precision', async () => {
    const em = { findOne: jest.fn() }
    const service = new DefaultTaxCalculationService(em as any)
    const result = await service.calculateUnitAmounts({
      ...baseInput,
      amount: Number('0.000000000000000123'),
      amountExact: '0.000000000000000123',
      amountDecimalPlaces: 18,
      taxRate: 23,
    })

    expect(result.netAmountExact).toBe('0.000000000000000123')
    expect(result.taxAmountExact).toBe('0.000000000000000028')
    expect(result.grossAmountExact).toBe('0.000000000000000151')
  })

  it('keeps the entered net exact and rounds only the derived gross', async () => {
    const em = { findOne: jest.fn() }
    const service = new DefaultTaxCalculationService(em as never)
    const result = await service.calculateUnitAmounts({
      ...baseInput,
      amount: 12.34567,
      amountExact: '12.34567',
      taxRate: 23,
    })

    expect(result.netAmountExact).toBe('12.34567')
    expect(result.grossAmountExact).toBe('15.18517')
    expect(result.taxAmountExact).toBe('2.8395')
  })

  it('keeps the entered gross exact and rounds only the derived net', async () => {
    const em = { findOne: jest.fn() }
    const service = new DefaultTaxCalculationService(em as never)
    const result = await service.calculateUnitAmounts({
      ...baseInput,
      amount: 12.34567,
      amountExact: '12.34567',
      mode: 'gross',
      taxRate: 23,
    })

    expect(result.grossAmountExact).toBe('12.34567')
    expect(result.netAmountExact).toBe('10.03713')
    expect(result.taxAmountExact).toBe('2.30854')
  })

  it('does not round a tiny entered amount to zero', async () => {
    const em = { findOne: jest.fn() }
    const service = new DefaultTaxCalculationService(em as never)
    const untaxed = await service.calculateUnitAmounts({
      ...baseInput,
      amount: 0.00001,
      amountExact: '0.00001',
    })
    const taxed = await service.calculateUnitAmounts({
      ...baseInput,
      amount: 0.00001,
      amountExact: '0.00001',
      taxRate: 23,
    })

    expect(untaxed).toMatchObject({ netAmountExact: '0.00001', grossAmountExact: '0.00001', taxAmountExact: '0' })
    expect(taxed).toMatchObject({ netAmountExact: '0.00001', grossAmountExact: '0.00001', taxAmountExact: '0' })
  })

  it('does not widen the rounding to float noise when only a number was sent', async () => {
    const em = { findOne: jest.fn() }
    const service = new DefaultTaxCalculationService(em as never)
    const numberOnly = await service.calculateUnitAmounts({ ...baseInput, amount: 0.1 + 0.2, taxRate: 23 })
    const enteredString = await service.calculateUnitAmounts({
      ...baseInput,
      amount: 0.1 + 0.2,
      amountExact: '0.30000000000000004',
      taxRate: 23,
    })

    expect(numberOnly.grossAmountExact).toBe('0.369')
    expect(enteredString.grossAmountExact).toBe('0.36900000000000005')
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

    expect(result).toEqual({
      netAmount: 10,
      netAmountExact: '10',
      grossAmount: 11,
      grossAmountExact: '11',
      taxAmount: 1,
      taxAmountExact: '1',
      taxRate: 10,
    })
    expect(before).toHaveBeenCalled()
    expect(after).toHaveBeenCalled()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  describe('hook amount overrides', () => {
    type HookPayload = {
      input: Record<string, unknown>
      result?: Record<string, unknown>
      setInput?: (next: Record<string, unknown>) => void
      setResult: (next: Record<string, unknown>) => void
    }

    const serviceWithHooks = (hooks: {
      before?: (payload: HookPayload) => void
      after?: (payload: HookPayload) => void
    }) => {
      const eventBus = {
        emitEvent: jest.fn(async (event: string, payload: HookPayload) => {
          if (event === 'sales.tax.calculate.before') hooks.before?.(payload)
          if (event === 'sales.tax.calculate.after') hooks.after?.(payload)
        }),
      }
      return new DefaultTaxCalculationService({ findOne: jest.fn() } as never, eventBus as never)
    }

    const taxedInput = { ...baseInput, amount: 10, amountExact: '10', taxRate: 20 }

    it('keeps an exact-only change an after hook made in place', async () => {
      const service = serviceWithHooks({
        after: (payload) => {
          if (payload.result) payload.result.grossAmountExact = '12.5'
        },
      })

      const result = await service.calculateUnitAmounts(taxedInput)

      expect(result).toMatchObject({ grossAmount: 12.5, grossAmountExact: '12.5', netAmountExact: '10' })
    })

    it('keeps an exact-only change an after hook passed to setResult', async () => {
      const service = serviceWithHooks({
        after: (payload) => payload.setResult({ ...payload.result, taxAmountExact: '2.000000000000000001' }),
      })

      const result = await service.calculateUnitAmounts(taxedInput)

      expect(result).toMatchObject({ taxAmount: 2, taxAmountExact: '2.000000000000000001', grossAmountExact: '12' })
    })

    it('derives the exact value from a number-only after hook change at the amount precision', async () => {
      const service = serviceWithHooks({
        after: (payload) => payload.setResult({ ...payload.result, grossAmount: 12.123456789 }),
      })

      expect(await service.calculateUnitAmounts(taxedInput)).toMatchObject({
        grossAmount: 12.1235,
        grossAmountExact: '12.1235',
        netAmountExact: '10',
      })
      expect(await service.calculateUnitAmounts({ ...taxedInput, amountDecimalPlaces: 6 })).toMatchObject({
        grossAmount: 12.123457,
        grossAmountExact: '12.123457',
      })
    })

    it('keeps an exact-only amount change a before hook made', async () => {
      const service = serviceWithHooks({
        before: (payload) => payload.setInput?.({ amountExact: '10.5' }),
      })

      const result = await service.calculateUnitAmounts(taxedInput)

      expect(result).toMatchObject({ netAmountExact: '10.5', grossAmountExact: '12.6', taxAmountExact: '2.1' })
    })

    it('derives the exact amount from a number-only before hook change', async () => {
      const service = serviceWithHooks({
        before: (payload) => {
          payload.input.amount = 20
        },
      })

      const result = await service.calculateUnitAmounts(taxedInput)

      expect(result).toMatchObject({ netAmountExact: '20', grossAmountExact: '24', taxAmountExact: '4' })
    })

    it('leaves the amounts of hooks that change nothing untouched', async () => {
      const service = serviceWithHooks({ before: () => undefined, after: () => undefined })
      const plain = new DefaultTaxCalculationService({ findOne: jest.fn() } as never)
      const numberOnlyInput = { ...baseInput, amount: 0.1 + 0.2, taxRate: 23 }

      expect(await service.calculateUnitAmounts(numberOnlyInput)).toEqual(
        await plain.calculateUnitAmounts(numberOnlyInput),
      )
    })
  })
})
