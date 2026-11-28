import BigConstructor from 'big.js'
import type { BigConstructor as DecimalConstructor } from 'big.js'
import {
  countDecimalPlaces,
  MAX_DECIMAL_INTEGER_DIGITS,
  toDecimal,
  type DecimalInput,
  type DecimalValue,
} from '../decimal'
import { assertSameCurrency, currenciesEqual } from './currency'
import { CurrencyMismatchError, InvalidAllocationError } from './errors'
import { brandMoney, isValidMoneyDecimalPlaces, resolveBigRounding, toExactDecimal } from './internal'
import { MAX_MONEY_DECIMAL_PLACES, type Currency, type Money, type MoneyRounding } from './types'

const RoundedDivision = BigConstructor()

const ROUND_DOWN = 0

const MAX_ALLOCATION_RATIOS = 1000

const MAX_RATIO_INTEGER_DIGITS = 50

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
    if (!quotient.eq(0) && quotient.e >= MAX_DECIMAL_INTEGER_DIGITS) throw new Error('[internal] Decimal result out of range')
    return toDecimal(quotient.toFixed())
  } finally {
    RoundedDivision.DP = previousDecimalPlaces
    RoundedDivision.RM = previousRoundingMode
  }
}

function integerQuotient(dividend: DecimalValue, divisor: DecimalValue): DecimalValue {
  const previousDecimalPlaces = RoundedDivision.DP
  const previousRoundingMode = RoundedDivision.RM
  RoundedDivision.DP = 0
  RoundedDivision.RM = ROUND_DOWN
  try {
    const quotient = new RoundedDivision(dividend.toFixed()).div(divisor.toFixed())
    const ExactDecimal = dividend.constructor as DecimalConstructor
    return new ExactDecimal(quotient.toFixed())
  } finally {
    RoundedDivision.DP = previousDecimalPlaces
    RoundedDivision.RM = previousRoundingMode
  }
}

export function createMoney(amount: DecimalInput, currency: Currency): Money {
  return brandMoney(toExactDecimal(amount), currency)
}

export function zeroMoney(currency: Currency): Money {
  return brandMoney(toDecimal(0), currency)
}

/** Exact. A sum that would need rounding to fit the stored-amount range throws. */
export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left.currency, right.currency)
  return brandMoney(left.amount.plus(right.amount), left.currency)
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left.currency, right.currency)
  return brandMoney(left.amount.minus(right.amount), left.currency)
}

/** The currency is required so an empty list sums to a well-defined zero. */
export function sumMoney(currency: Currency, values: readonly Money[]): Money {
  return values.reduce((total, value) => addMoney(total, value), zeroMoney(currency))
}

/** Exact. A product that would need rounding to fit the stored-amount range throws. */
export function multiplyMoney(money: Money, factor: DecimalInput): Money {
  return brandMoney(money.amount.times(toExactDecimal(factor)), money.currency)
}

/** Divides and rounds the quotient once, to the caller's rounding (no hidden 50-place cut). */
export function divideMoney(money: Money, divisor: DecimalInput, rounding: MoneyRounding): Money {
  const { decimalPlaces, mode } = resolveBigRounding(rounding)
  return brandMoney(divideOnce(money.amount, toExactDecimal(divisor), decimalPlaces, mode), money.currency)
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
 * exact multiplication (no intermediate cap or rounding) followed by one
 * rounding. Rates are never looked up here.
 */
export function convertMoney(money: Money, rate: DecimalInput, target: Currency, rounding: MoneyRounding): Money {
  const { decimalPlaces, mode } = resolveBigRounding(rounding)
  const exchangeRate = toExactDecimal(rate)
  if (!exchangeRate.gt(0)) throw new Error('[internal] Exchange rate must be positive')
  if (money.currency.code === target.code) {
    throw new CurrencyMismatchError(
      money.currency,
      target,
      `[internal] convertMoney needs a different currency code (${target.code}); use rescaleMoney`,
    )
  }
  return brandMoney(money.amount.times(exchangeRate).round(decimalPlaces, mode), target)
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

/**
 * Whether the amount has at most the currency's decimal places (no sub-cent
 * USD). `resolveMoney` keeps client amounts exact, so a request handler whose
 * field must be in minor units checks this and rejects the input with a 400.
 */
export function fitsCurrencyPrecision(money: Money): boolean {
  return countDecimalPlaces(money.amount) <= money.currency.decimalPlaces
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
    value = toExactDecimal(ratio)
  } catch {
    throw new InvalidAllocationError(`ratio ${index} is not a decimal within the supported range`)
  }
  if (value.lt(0)) throw new InvalidAllocationError(`ratio ${index} is negative`)
  if (countDecimalPlaces(value) > MAX_MONEY_DECIMAL_PLACES) {
    throw new InvalidAllocationError(`ratio ${index} has more than ${MAX_MONEY_DECIMAL_PLACES} decimal places`)
  }
  if (value.e >= MAX_RATIO_INTEGER_DIGITS) {
    throw new InvalidAllocationError(`ratio ${index} has more than ${MAX_RATIO_INTEGER_DIGITS} integer digits`)
  }
  return value
}

/**
 * Exact integer arithmetic on scaled units: no intermediate value is capped or
 * rounded, so only the returned parts have to fit the stored-amount range.
 */
function splitUnits(units: DecimalValue, ratios: DecimalValue[]): DecimalValue[] {
  const ratioScale = toDecimal(10).pow(Math.max(...ratios.map(countDecimalPlaces)))
  const integerRatios = ratios.map((ratio) => ratio.times(ratioScale))
  const ratioTotal = integerRatios.reduce((total, ratio) => total.plus(ratio), toDecimal(0))
  const shares = integerRatios.map((ratio, index) => {
    const product = units.times(ratio)
    const quotient = integerQuotient(product, ratioTotal)
    return { index, units: quotient, remainder: product.minus(quotient.times(ratioTotal)) }
  })
  const allocatedUnits = shares.reduce((total, share) => total.plus(share.units), toDecimal(0))
  const leftoverUnits = Number(units.minus(allocatedUnits).toFixed())
  const ranked = [...shares].sort((left, right) => right.remainder.cmp(left.remainder) || left.index - right.index)
  for (const share of ranked.slice(0, leftoverUnits)) {
    share.units = share.units.plus(1)
  }
  return shares.map((share) => share.units)
}

/**
 * Splits `money` by `ratios` into parts that sum exactly to `money`, using the
 * largest-remainder method on exact integer remainders (ties go to the lower
 * index). The amount must already have at most `decimalPlaces` decimals; each
 * ratio may have at most 50 integer digits and 50 decimals, and there may be at
 * most 1000 ratios, which bounds the exact integer work.
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
  if (ratios.length > MAX_ALLOCATION_RATIOS) {
    throw new InvalidAllocationError(`more than ${MAX_ALLOCATION_RATIOS} ratios`)
  }
  const parsedRatios = ratios.map(parseRatio)
  if (parsedRatios.every((ratio) => ratio.eq(0))) throw new InvalidAllocationError('all ratios are zero')

  const unitScale = toDecimal(10).pow(decimalPlaces)
  const shares = splitUnits(money.amount.abs().times(unitScale), parsedRatios)
  const negative = money.amount.lt(0)
  return shares.map((shareUnits) => {
    const amount = shareUnits.div(unitScale)
    return brandMoney(negative ? amount.neg() : amount, money.currency)
  })
}
