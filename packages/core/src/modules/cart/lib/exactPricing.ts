import { resolveCurrencyDecimalPlaces } from '@open-mercato/shared/lib/currencyPrecision'
import { decimalToString, decimalsEqual, parseDecimal } from '@open-mercato/shared/lib/decimal'
import type { Cart } from '../data/entities'

type ServiceContainer = { resolve: <T = unknown>(name: string) => T }

/** Exact decimal string of a resolved price: the exact sibling wins, the float copy is the fallback. */
export function resolvedPriceString(exact: string | null | undefined, legacy: number | null | undefined): string | null {
  const parsed = parseDecimal(exact ?? legacy)
  return parsed ? decimalToString(parsed) : null
}

/** Whether two stored prices are the same amount (`10.0000` equals `10`); `null` only equals `null`. */
export function samePrice(left: string | null, right: string | null): boolean {
  const leftDecimal = parseDecimal(left)
  const rightDecimal = parseDecimal(right)
  if (!leftDecimal || !rightDecimal) return left === right
  return decimalsEqual(leftDecimal, rightDecimal)
}

/** The tenant's decimal places for the cart currency, falling back to the ISO 4217 minor units. */
export function resolveCartCurrencyDecimalPlaces(container: ServiceContainer, cart: Cart): Promise<number | null> {
  return resolveCurrencyDecimalPlaces(container, {
    code: cart.currencyCode,
    tenantId: cart.tenantId,
    organizationId: cart.organizationId,
  })
}
