import type { DecimalValue } from '../decimal'

declare const currencyBrand: unique symbol
declare const moneyBrand: unique symbol

/**
 * A tenant's currency: ISO code, the tenant's decimal places and an optional
 * display symbol. Two currencies are equal when code and decimal places match.
 * Obtain one from `resolveCurrency` (or `restoreMoney` for a trusted snapshot).
 */
export type Currency = Readonly<{
  code: string
  decimalPlaces: number
  symbol: string | null
}> & { readonly [currencyBrand]: true }

/** An exact, deep-frozen decimal amount in one `Currency`. Create it with `createMoney`. */
export type Money = Readonly<{
  amount: DecimalValue
  currency: Currency
}> & { readonly [moneyBrand]: true }

/** `down` and `up` round toward and away from zero. */
export type MoneyRoundingMode = 'down' | 'halfUp' | 'halfEven' | 'up'

export type MoneyRounding = Readonly<{ decimalPlaces: number; mode: MoneyRoundingMode }>

export const MAX_MONEY_DECIMAL_PLACES = 50
