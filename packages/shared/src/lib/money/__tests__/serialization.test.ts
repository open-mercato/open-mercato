import { describe, expect, it } from '@jest/globals'
import { resolveCurrency } from '../currency'
import { ZodError } from 'zod'
import { CurrencyMismatchError, CurrencyNotResolvedError, InvalidMoneyInputError, InvalidMoneySnapshotError } from '../errors'
import { addMoney, createMoney, fitsCurrencyPrecision, moneyEquals, rescaleMoney } from '../money'
import {
  moneyInputSchema,
  moneySnapshotSchema,
  resolveMoney,
  restoreMoney,
  serializeMoney,
  snapshotMoney,
  type MoneyInput,
  type MoneySnapshot,
} from '../serialization'
import { createContainer, createResolver, currencyOf, defaultTable, scope, type CurrencyTable } from './helpers'

describe('MoneyInput (untrusted)', () => {
  it('round-trips through serializeMoney and resolveMoney', async () => {
    const container = createContainer(createResolver(defaultTable))
    const original = createMoney('1234.5678', await currencyOf('USD'))
    const wire = JSON.parse(JSON.stringify(serializeMoney(original)))
    expect(wire).toEqual({ amount: '1234.5678', currencyCode: 'USD' })
    const restored = await resolveMoney(container, scope, moneyInputSchema.parse(wire))
    expect(moneyEquals(restored, original)).toBe(true)
    expect(restored.currency.symbol).toBe('$')
  })

  it('normalizes the code and amount and strips a client-sent precision', () => {
    const parsed = moneyInputSchema.parse({ amount: ' 12.50 ', currencyCode: ' usd ', currencyDecimalPlaces: 8 })
    expect(parsed).toEqual({ amount: '12.5', currencyCode: 'USD' })
    expect('currencyDecimalPlaces' in parsed).toBe(false)
  })

  it('rejects JSON numbers, which may have lost digits before the schema sees them', () => {
    expect(JSON.parse('{"amount":90071992547409.93}').amount).toBe(90071992547409.94)
    expect(moneyInputSchema.safeParse({ amount: 90071992547409.93, currencyCode: 'USD' }).success).toBe(false)
    expect(moneyInputSchema.safeParse({ amount: 12.5, currencyCode: 'USD' }).success).toBe(false)
    expect(moneyInputSchema.parse({ amount: '90071992547409.93', currencyCode: 'USD' }).amount).toBe('90071992547409.93')
  })

  it('rejects invalid input', () => {
    expect(moneyInputSchema.safeParse({ amount: 'abc', currencyCode: 'USD' }).success).toBe(false)
    expect(moneyInputSchema.safeParse({ amount: '1e5000', currencyCode: 'USD' }).success).toBe(false)
    expect(moneyInputSchema.safeParse({ amount: '1', currencyCode: 'US' }).success).toBe(false)
    expect(moneyInputSchema.safeParse({ currencyCode: 'USD' }).success).toBe(false)
  })

  it('keeps over-precise client amounts exact and lets the caller detect them', async () => {
    const container = createContainer(createResolver(defaultTable))
    const subCent = await resolveMoney(container, scope, { amount: '0.001', currencyCode: 'USD' })
    expect(subCent.amount.toFixed()).toBe('0.001')
    expect(fitsCurrencyPrecision(subCent)).toBe(false)
    expect(fitsCurrencyPrecision(await resolveMoney(container, scope, { amount: '0.10', currencyCode: 'USD' }))).toBe(true)
    expect(fitsCurrencyPrecision(await resolveMoney(container, scope, { amount: '5', currencyCode: 'JPY' }))).toBe(true)
    expect(fitsCurrencyPrecision(await resolveMoney(container, scope, { amount: '5.5', currencyCode: 'JPY' }))).toBe(false)
  })

  it('throws a typed InvalidMoneyInputError carrying the ZodError for invalid input', async () => {
    const container = createContainer(createResolver(defaultTable))
    const error = await resolveMoney(container, scope, { amount: 'abc', currencyCode: 'USD' }).catch((err) => err)
    expect(error).toBeInstanceOf(InvalidMoneyInputError)
    expect((error as Error).message).toBe('[internal] Invalid money input')
    expect((error as Error).cause).toBeInstanceOf(ZodError)
    await expect(
      resolveMoney(container, scope, { amount: 12.5, currencyCode: 'USD' } as unknown as MoneyInput),
    ).rejects.toBeInstanceOf(InvalidMoneyInputError)
  })

  it('resolves against the current tenant precision and throws for an unknown currency', async () => {
    const container = createContainer(createResolver({ USD: { decimalPlaces: 4 } }))
    const money = await resolveMoney(container, scope, { amount: '1', currencyCode: 'USD' })
    expect(money.currency.decimalPlaces).toBe(4)
    await expect(resolveMoney(container, scope, { amount: '1', currencyCode: 'EUR' })).rejects.toBeInstanceOf(
      CurrencyNotResolvedError,
    )
  })
})

describe('MoneySnapshot (trusted)', () => {
  it('round-trips with the precision at snapshot time and no symbol', async () => {
    const original = createMoney('-0.125', await currencyOf('BHD'))
    const snapshot = JSON.parse(JSON.stringify(snapshotMoney(original))) as MoneySnapshot
    expect(snapshot).toEqual({ amount: '-0.125', currencyCode: 'BHD', currencyDecimalPlaces: 3 })
    expect(moneySnapshotSchema.parse(snapshot)).toEqual(snapshot)
    const restored = restoreMoney(snapshot)
    expect(moneyEquals(restored, original)).toBe(true)
    expect(restored.currency.symbol).toBeNull()
    expect(Object.isFrozen(restored.amount.c)).toBe(true)
  })

  it('keeps the old precision after a precision change until the receiver rescales', async () => {
    const table: CurrencyTable = { JPY: { decimalPlaces: 2 } }
    const container = createContainer(createResolver(table))
    const sent = snapshotMoney(createMoney('100.25', await resolveCurrency(container, { code: 'JPY', ...scope })))
    table.JPY = { decimalPlaces: 4 }
    const received = restoreMoney(sent)
    expect(received.currency.decimalPlaces).toBe(2)
    const freshCurrency = await resolveCurrency(container, { code: 'JPY', ...scope })
    const fresh = createMoney('1', freshCurrency)
    expect(() => addMoney(received, fresh)).toThrow(CurrencyMismatchError)
    const rescaled = rescaleMoney(received, freshCurrency, { decimalPlaces: 4, mode: 'halfUp' })
    expect(addMoney(rescaled, fresh).amount.toFixed()).toBe('101.25')
  })

  it('still restores after the currency is soft-deleted', async () => {
    const table: CurrencyTable = { EUR: { decimalPlaces: 2 } }
    const container = createContainer(createResolver(table))
    const sent = snapshotMoney(createMoney('5', await resolveCurrency(container, { code: 'EUR', ...scope })))
    delete table.EUR
    expect(restoreMoney(sent).amount.toFixed()).toBe('5')
    await expect(resolveCurrency(container, { code: 'EUR', ...scope })).rejects.toBeInstanceOf(CurrencyNotResolvedError)
  })

  it.each([
    [{ amount: '1', currencyCode: 'usd', currencyDecimalPlaces: 2 }],
    [{ amount: '1', currencyCode: 'USDT', currencyDecimalPlaces: 2 }],
    [{ amount: '1', currencyCode: 'USD', currencyDecimalPlaces: 51 }],
    [{ amount: '1', currencyCode: 'USD', currencyDecimalPlaces: -1 }],
    [{ amount: '1', currencyCode: 'USD', currencyDecimalPlaces: 1.5 }],
    [{ amount: 'abc', currencyCode: 'USD', currencyDecimalPlaces: 2 }],
    [{ amount: '1e5000', currencyCode: 'USD', currencyDecimalPlaces: 2 }],
    [{ amount: null, currencyCode: 'USD', currencyDecimalPlaces: 2 }],
    [{ amount: '1', currencyCode: null, currencyDecimalPlaces: 2 }],
    [{ amount: '1', currencyCode: 'USD', currencyDecimalPlaces: null }],
  ])('rejects the invalid snapshot %p', (snapshot) => {
    expect(() => restoreMoney(snapshot as unknown as MoneySnapshot)).toThrow(InvalidMoneySnapshotError)
  })
})
