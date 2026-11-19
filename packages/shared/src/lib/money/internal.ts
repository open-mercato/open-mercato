import { MAX_DECIMAL_EXPONENT, MAX_DECIMAL_INTEGER_DIGITS, MAX_DECIMAL_SIGNIFICANT_DIGITS, type DecimalValue } from '../decimal'
import { InvalidMoneyRoundingError } from './errors'
import { MAX_MONEY_DECIMAL_PLACES, type Currency, type Money, type MoneyRounding, type MoneyRoundingMode } from './types'

/**
 * Building blocks shared by the money files. Not part of the public
 * `@open-mercato/shared/lib/money` contract: import from `index`, never from here.
 */

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

type BigRoundingMode = 0 | 1 | 2 | 3

const BIG_ROUNDING_MODES: Record<MoneyRoundingMode, BigRoundingMode> = {
  down: 0,
  halfUp: 1,
  halfEven: 2,
  up: 3,
}

export function normalizeCurrencyCode(code: unknown): string | null {
  if (typeof code !== 'string') return null
  const normalized = code.trim().toUpperCase()
  return CURRENCY_CODE_PATTERN.test(normalized) ? normalized : null
}

export function isValidMoneyDecimalPlaces(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_MONEY_DECIMAL_PLACES
}

/** Freezes the coefficient array too: a shallow freeze leaves `value.c[0] = 9` writable. */
export function freezeDecimal(value: DecimalValue): DecimalValue {
  Object.freeze(value.c)
  return Object.freeze(value) as DecimalValue
}

export function brandCurrency(code: string, decimalPlaces: number, symbol: string | null): Currency {
  return Object.freeze({ code, decimalPlaces, symbol }) as Currency
}

function isStorableDecimal(amount: DecimalValue): boolean {
  if (amount.c.length === 1 && amount.c[0] === 0) return true
  return (
    amount.e < MAX_DECIMAL_INTEGER_DIGITS &&
    amount.c.length <= MAX_DECIMAL_SIGNIFICANT_DIGITS &&
    amount.c.length - 1 - amount.e <= MAX_DECIMAL_EXPONENT
  )
}

/**
 * `amount` MUST be a fresh instance nobody else holds; it is frozen in place.
 * Every `Money` stays within the decimal toolkit's caps, so `snapshotMoney` and
 * `restoreMoney` always round-trip; a result outside them throws.
 */
export function brandMoney(amount: DecimalValue, currency: Currency): Money {
  if (!isStorableDecimal(amount)) throw new Error('[internal] Decimal result out of range')
  if (amount.c.length === 1 && amount.c[0] === 0) amount.s = 1
  return Object.freeze({ amount: freezeDecimal(amount), currency }) as Money
}

export function resolveBigRounding(rounding: MoneyRounding): { decimalPlaces: number; mode: BigRoundingMode } {
  if (!rounding || typeof rounding !== 'object') throw new InvalidMoneyRoundingError('rounding is required')
  if (!isValidMoneyDecimalPlaces(rounding.decimalPlaces)) {
    throw new InvalidMoneyRoundingError(`decimal places must be an integer from 0 to ${MAX_MONEY_DECIMAL_PLACES}`)
  }
  if (typeof rounding.mode !== 'string' || !Object.hasOwn(BIG_ROUNDING_MODES, rounding.mode)) {
    throw new InvalidMoneyRoundingError(`unknown mode ${String(rounding.mode).slice(0, 20)}`)
  }
  return { decimalPlaces: rounding.decimalPlaces, mode: BIG_ROUNDING_MODES[rounding.mode] }
}
