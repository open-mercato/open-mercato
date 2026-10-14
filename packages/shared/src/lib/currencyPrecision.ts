import {
  countDecimalPlaces,
  decimalToString,
  parseDecimal,
  resolveAmountDecimalPlaces,
  resolveIsoCurrencyDecimalPlaces,
} from './decimal'

export function findCurrencyAmountPrecisionError(input: {
  amount: number | string | null | undefined
  currencyCode: string | null | undefined
  decimalPlaces: number | null
}): { amount: string; currencyCode: string; decimalPlaces: number } | null {
  const amount = parseDecimal(input.amount)
  const currencyCode = input.currencyCode?.trim().toUpperCase()
  if (amount === null || !currencyCode) return null
  const isoDecimalPlaces = resolveIsoCurrencyDecimalPlaces(currencyCode)
  const decimalPlaces = input.decimalPlaces !== null && isoDecimalPlaces !== null
    ? Math.min(input.decimalPlaces, isoDecimalPlaces)
    : input.decimalPlaces
  if (decimalPlaces === null || countDecimalPlaces(amount) <= decimalPlaces) return null
  return { amount: decimalToString(amount), currencyCode, decimalPlaces }
}

export type CurrencyPrecisionLookup = {
  code: string
  tenantId: string
  organizationId?: string | null
}

export type CurrencyPrecisionResolver = {
  getDecimalPlaces(lookup: CurrencyPrecisionLookup): Promise<number | null>
}

type ServiceContainer = {
  resolve<T = unknown>(name: string): T
}

/**
 * The currency's own decimal places: the tenant's currency precision (via the
 * optional `currencyPrecisionService`), else the ISO 4217 digits, else `null`.
 */
export async function resolveCurrencyDecimalPlaces(
  container: ServiceContainer,
  lookup: CurrencyPrecisionLookup,
): Promise<number | null> {
  if (!lookup.code) return null
  let resolver: CurrencyPrecisionResolver | null = null
  try {
    resolver = container.resolve<CurrencyPrecisionResolver>('currencyPrecisionService')
  } catch {
    resolver = null
  }
  let decimalPlaces: number | null = null
  if (resolver) {
    try {
      decimalPlaces = await resolver.getDecimalPlaces(lookup)
    } catch {
      decimalPlaces = null
    }
  }
  return decimalPlaces ?? resolveIsoCurrencyDecimalPlaces(lookup.code)
}

/**
 * Decimal places money amounts in `code` are rounded to after a division:
 * the tenant's currency precision (via the optional `currencyPrecisionService`),
 * else the ISO 4217 digits, never fewer than DEFAULT_AMOUNT_DECIMAL_PLACES.
 */
export async function resolveCurrencyAmountDecimalPlaces(
  container: ServiceContainer,
  lookup: CurrencyPrecisionLookup,
): Promise<number> {
  return resolveAmountDecimalPlaces(await resolveCurrencyDecimalPlaces(container, lookup))
}
