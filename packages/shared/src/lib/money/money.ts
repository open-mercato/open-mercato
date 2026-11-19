import BigConstructor from 'big.js'
import {
  addDecimals,
  countDecimalPlaces,
  multiplyDecimals,
  subtractDecimals,
  toDecimal,
  type DecimalInput,
  type DecimalValue,
} from '../decimal'
import { assertSameCurrency, currenciesEqual } from './currency'
import { CurrencyMismatchError, InvalidAllocationError } from './errors'
import { brandMoney, isValidMoneyDecimalPlaces, resolveBigRounding } from './internal'
import { MAX_MONEY_DECIMAL_PLACES, type Currency, type Money, type MoneyRounding } from './types'

const RoundedDivision = BigConstructor()

const ROUND_DOWN = 0

/**
 * One big.js division rounded once to `decimalPlaces` with `mode`. `div` reads
 * `DP`/`RM` from the dividend's constructor, so a private constructor keeps the
 * shared `Decimal` settings untouched even when the division throws.
 */
function divideOnce(dividend: DecimalValue, divisor: DecimalValue, decimalPlaces: number, mode: 0 | 1 | 2 | 3): DecimalValue {
  if (divisor.eq(0)) throw new Error('[internal] Division by zero')
  const previousDecimalPlaces = RoundedDivision.DP
  const previousRoundingMode = RoundedDivision.RM
  RoundedDivision.DP = decimalPlaces
  RoundedDivision.RM = mode
  try {
    const quotient = new RoundedDivision(dividend.toFixed()).div(divisor.toFixed())
    return toDecimal(quotient.toFixed())
  } finally {
    RoundedDivision.DP = previousDecimalPlaces
    RoundedDivision.RM = previousRoundingMode
  }
}

export function createMoney(amount: DecimalInput, currency: Currency): Money {
  return brandMoney(toDecimal(amount), currency)
}

export function zeroMoney(currency: Currency): Money {
  return brandMoney(toDecimal(0), currency)
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left.currency, right.currency)
  return brandMoney(addDecimals(left.amount, right.amount), left.currency)
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left.currency, right.currency)
  return brandMoney(subtractDecimals(left.amount, right.amount), left.currency)
}

/** The currency is required so an empty list sums to a well-defined zero. */
export function sumMoney(currency: Currency, values: readonly Money[]): Money {
  return values.reduce((total, value) => addMoney(total, value), zeroMoney(currency))
}

export function multiplyMoney(money: Money, factor: DecimalInput): Money {
  return brandMoney(multiplyDecimals(money.amount, factor), money.currency)
}

/** Divides and rounds the quotient once, to the caller's rounding (no hidden 50-place cut). */
export function divideMoney(money: Money, divisor: DecimalInput, rounding: MoneyRounding): Money {
  const { decimalPlaces, mode } = resolveBigRounding(rounding)
  return brandMoney(divideOnce(money.amount, toDecimal(divisor), decimalPlaces, mode), money.currency)
}

export function roundMoney(money: Money, rounding: MoneyRounding): Money {
  const { decimalPlaces, mode } = resolveBigRounding(rounding)
  return brandMoney(money.amount.round(decimalPlaces, mode), money.currency)
}

export function negateMoney(money: Money): Money {
  return brandMoney(money.amount.neg(), money.currency)
}

export function absMoney(money: Money): Money {
  return brandMoney(money.amount.abs(), money.currency)
}

/**
 * Converts to another currency at `rate` target units per one source unit: an
 * exact multiplication followed by one rounding. Rates are never looked up here.
 */
export function convertMoney(money: Money, rate: DecimalInput, target: Currency, rounding: MoneyRounding): Money {
  const { decimalPlaces, mode } = resolveBigRounding(rounding)
  const exchangeRate = toDecimal(rate)
  if (!exchangeRate.gt(0)) throw new Error('[internal] Exchange rate must be positive')
  if (money.currency.code === target.code) {
    throw new CurrencyMismatchError(
      money.currency,
      target,
      `[internal] convertMoney needs a different currency code (${target.code}); use rescaleMoney`,
    )
  }
  return brandMoney(multiplyDecimals(money.amount, exchangeRate).round(decimalPlaces, mode), target)
}

/** Moves an amount between two currencies with the same code and different decimal places. */
export function rescaleMoney(money: Money, target: Currency, rounding: MoneyRounding): Money {
  const { decimalPlaces, mode } = resolveBigRounding(rounding)
  if (money.currency.code !== target.code) {
    throw new CurrencyMismatchError(
      money.currency,
      target,
      `[internal] rescaleMoney needs the same currency code (${money.currency.code} vs ${target.code}); use convertMoney`,
    )
  }
  return brandMoney(money.amount.round(decimalPlaces, mode), target)
}

/** Usable as an `Array.sort` comparator; throws for different currencies. */
export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left.currency, right.currency)
  return left.amount.cmp(right.amount) as -1 | 0 | 1
}

/** `false` for different currencies: equality is not arithmetic, so it never throws. */
export function moneyEquals(left: Money, right: Money): boolean {
  return currenciesEqual(left.currency, right.currency) && left.amount.eq(right.amount)
}

export function isZeroMoney(money: Money): boolean {
  return money.amount.eq(0)
}

export function isNegativeMoney(money: Money): boolean {
  return money.amount.lt(0)
}

export function isPositiveMoney(money: Money): boolean {
  return money.amount.gt(0)
}

function pickMoney(values: readonly Money[], name: string, prefer: (candidate: Money, current: Money) => boolean): Money {
  if (values.length === 0) throw new Error(`[internal] ${name} requires at least one value`)
  return values.reduce((current, candidate) => {
    assertSameCurrency(current.currency, candidate.currency)
    return prefer(candidate, current) ? candidate : current
  })
}

export function minMoney(...values: Money[]): Money {
  return pickMoney(values, 'minMoney', (candidate, current) => candidate.amount.lt(current.amount))
}

export function maxMoney(...values: Money[]): Money {
  return pickMoney(values, 'maxMoney', (candidate, current) => candidate.amount.gt(current.amount))
}

function parseRatio(ratio: DecimalInput, index: number): DecimalValue {
  let value: DecimalValue
  try {
    value = toDecimal(ratio)
  } catch {
    throw new InvalidAllocationError(`ratio ${index} is not a decimal`)
  }
  if (value.lt(0)) throw new InvalidAllocationError(`ratio ${index} is negative`)
  return value
}

/**
 * Splits `money` by `ratios` into parts that sum exactly to `money`, using the
 * largest-remainder method on exact integer remainders (ties go to the lower
 * index). The amount must already have at most `decimalPlaces` decimals.
 */
export function allocateMoney(
  money: Money,
  ratios: readonly DecimalInput[],
  options: { decimalPlaces: number },
): Money[] {
  const decimalPlaces = options?.decimalPlaces
  if (!isValidMoneyDecimalPlaces(decimalPlaces)) {
    throw new InvalidAllocationError(`decimal places must be an integer from 0 to ${MAX_MONEY_DECIMAL_PLACES}`)
  }
  if (countDecimalPlaces(money.amount) > decimalPlaces) {
    throw new InvalidAllocationError(`amount has more than ${decimalPlaces} decimal places; round it first`)
  }
  if (!Array.isArray(ratios) || ratios.length === 0) throw new InvalidAllocationError('ratios are empty')
  const parsedRatios = ratios.map(parseRatio)
  if (parsedRatios.every((ratio) => ratio.eq(0))) throw new InvalidAllocationError('all ratios are zero')

  const ratioScale = toDecimal(`1e${Math.max(...parsedRatios.map(countDecimalPlaces))}`)
  const integerRatios = parsedRatios.map((ratio) => multiplyDecimals(ratio, ratioScale))
  const ratioTotal = integerRatios.reduce((total, ratio) => addDecimals(total, ratio), toDecimal(0))
  const units = multiplyDecimals(money.amount.abs(), `1e${decimalPlaces}`)

  const shares = integerRatios.map((ratio, index) => {
    const product = multiplyDecimals(units, ratio)
    const quotient = divideOnce(product, ratioTotal, 0, ROUND_DOWN)
    return { index, units: quotient, remainder: subtractDecimals(product, multiplyDecimals(quotient, ratioTotal)) }
  })
  const allocatedUnits = shares.reduce((total, share) => addDecimals(total, share.units), toDecimal(0))
  const leftoverUnits = Number(subtractDecimals(units, allocatedUnits).toFixed())
  const ranked = [...shares].sort((left, right) => right.remainder.cmp(left.remainder) || left.index - right.index)
  for (const share of ranked.slice(0, leftoverUnits)) {
    share.units = addDecimals(share.units, 1)
  }

  const unitSize = `1e-${decimalPlaces}`
  const negative = money.amount.lt(0)
  return shares.map((share) => {
    const amount = multiplyDecimals(share.units, unitSize)
    return brandMoney(negative ? amount.neg() : amount, money.currency)
  })
}
