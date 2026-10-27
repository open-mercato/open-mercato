import { resolveCurrencyDecimalPlaces } from '@open-mercato/shared/lib/currencyPrecision'
import { decimalToString, parseDecimal } from '@open-mercato/shared/lib/decimal'
import type { Cart } from '../data/entities'

type ServiceContainer = { resolve: <T = unknown>(name: string) => T }

/** Exact decimal string of a resolved price: the exact sibling wins, the float copy is the fallback. */
export function resolvedPriceString(exact: string | null | undefined, legacy: number | null | undefined): string | null {
  const parsed = parseDecimal(exact ?? legacy)
  return parsed ? decimalToString(parsed) : null
}

/** The tenant's decimal places for the cart currency, falling back to the ISO 4217 minor units. */
export function resolveCartCurrencyDecimalPlaces(container: ServiceContainer, cart: Cart): Promise<number | null> {
  return resolveCurrencyDecimalPlaces(container, {
    code: cart.currencyCode,
    tenantId: cart.tenantId,
    organizationId: cart.organizationId,
  })
}
