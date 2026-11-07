import {
  decimalToNumber,
  decimalToString,
  parseDecimal,
  resolveExactDecimal,
  roundDecimal,
} from '@open-mercato/shared/lib/decimal'
import { findCurrencyAmountPrecisionError, resolveCurrencyDecimalPlaces } from '@open-mercato/shared/lib/currencyPrecision'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import enDictionary from '@open-mercato/checkout/modules/checkout/i18n/en.json'

export const DEFAULT_CHECKOUT_DECIMAL_PLACES = 2

type CurrencyContainer = Parameters<typeof resolveCurrencyDecimalPlaces>[0]

type CheckoutAmountScope = {
  tenantId: string
  organizationId: string
}

type ConfiguredPriceListItem = {
  amount: number
  amountExact?: string | null
  currencyCode: string
}

export type CheckoutConfiguredAmounts = {
  fixedPriceAmount?: number | null
  fixedPriceAmountExact?: string | null
  fixedPriceOriginalAmount?: number | null
  fixedPriceOriginalAmountExact?: string | null
  fixedPriceCurrencyCode?: string | null
  customAmountMin?: number | null
  customAmountMinExact?: string | null
  customAmountMax?: number | null
  customAmountMaxExact?: string | null
  customAmountCurrencyCode?: string | null
  priceListItems?: ReadonlyArray<ConfiguredPriceListItem> | null
}

const CONFIGURED_MONEY_FIELDS = [
  { field: 'fixedPriceAmount', exactField: 'fixedPriceAmountExact', currencyField: 'fixedPriceCurrencyCode' },
  { field: 'fixedPriceOriginalAmount', exactField: 'fixedPriceOriginalAmountExact', currencyField: 'fixedPriceCurrencyCode' },
  { field: 'customAmountMin', exactField: 'customAmountMinExact', currencyField: 'customAmountCurrencyCode' },
  { field: 'customAmountMax', exactField: 'customAmountMaxExact', currencyField: 'customAmountCurrencyCode' },
] as const

function roundMoneyPair(
  legacy: unknown,
  exact: unknown,
  decimalPlaces: number,
): { amount: number; amountExact: string } | null {
  const resolved = resolveExactDecimal(exact, legacy)
  if (resolved == null) return null
  const rounded = roundDecimal(resolved, decimalPlaces)
  return { amount: decimalToNumber(rounded), amountExact: decimalToString(rounded) }
}

/**
 * Rounds configured checkout amounts (fixed price, original price, custom amount
 * bounds and price-list items) half-up to the currency's own decimals, keeping
 * each `<field>` number and `<field>Exact` string in sync. Fields absent from
 * `values` are left untouched.
 */
export async function roundCheckoutConfiguredAmounts<T extends CheckoutConfiguredAmounts>(
  container: CurrencyContainer,
  scope: CheckoutAmountScope,
  values: T,
): Promise<T> {
  const decimalPlacesByCurrency: Record<string, number> = {}
  const resolveDecimalPlaces = async (code: string | null | undefined): Promise<number> => {
    const normalizedCode = code ?? ''
    if (!(normalizedCode in decimalPlacesByCurrency)) {
      const resolved = await resolveCurrencyDecimalPlaces(container, {
        code: normalizedCode,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })
      decimalPlacesByCurrency[normalizedCode] = resolved ?? DEFAULT_CHECKOUT_DECIMAL_PLACES
    }
    return decimalPlacesByCurrency[normalizedCode]
  }

  const next: CheckoutConfiguredAmounts = { ...values }
  for (const { field, exactField, currencyField } of CONFIGURED_MONEY_FIELDS) {
    if (values[field] === undefined && values[exactField] === undefined) continue
    const rounded = roundMoneyPair(values[field], values[exactField], await resolveDecimalPlaces(values[currencyField]))
    next[field] = rounded?.amount ?? null
    next[exactField] = rounded?.amountExact ?? null
  }

  if (Array.isArray(values.priceListItems)) {
    const items: ConfiguredPriceListItem[] = []
    for (const item of values.priceListItems) {
      const rounded = roundMoneyPair(item.amount, item.amountExact, await resolveDecimalPlaces(item.currencyCode))
      items.push(rounded ? { ...item, amount: rounded.amount, amountExact: rounded.amountExact } : item)
    }
    next.priceListItems = items
  }

  return next as T
}

/** Exact decimal strings for the configured money columns of a template or link. */
export function toStoredCheckoutAmounts(values: CheckoutConfiguredAmounts) {
  return {
    fixedPriceAmount: resolveExactDecimal(values.fixedPriceAmountExact, values.fixedPriceAmount),
    fixedPriceOriginalAmount: resolveExactDecimal(values.fixedPriceOriginalAmountExact, values.fixedPriceOriginalAmount),
    customAmountMin: resolveExactDecimal(values.customAmountMinExact, values.customAmountMin),
    customAmountMax: resolveExactDecimal(values.customAmountMaxExact, values.customAmountMax),
  }
}

/**
 * Rounds a checkout charge to the currency's own decimals (as
 * `checkout.transaction.create` stores it) and checks it against the precision
 * payment providers charge in, so a link amount like `10.0051` USD is rejected
 * before a reservation or provider session instead of being charged as `10.01`.
 */
export async function findCheckoutChargePrecisionError(
  container: CurrencyContainer,
  scope: CheckoutAmountScope,
  input: { amount: string | number | null | undefined; currencyCode: string | null | undefined },
): Promise<{ error: string } | null> {
  const resolved = parseDecimal(input.amount)
  if (!resolved || !input.currencyCode) return null
  const decimalPlaces = (await resolveCurrencyDecimalPlaces(container, {
    code: input.currencyCode,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })) ?? DEFAULT_CHECKOUT_DECIMAL_PLACES
  const precisionError = findCurrencyAmountPrecisionError({
    amount: decimalToString(roundDecimal(resolved, decimalPlaces)),
    currencyCode: input.currencyCode,
    decimalPlaces,
  })
  if (!precisionError) return null
  let translate = createFallbackTranslator(enDictionary)
  try {
    translate = (await resolveTranslations()).translate
  } catch {
    translate = createFallbackTranslator(enDictionary)
  }
  return {
    error: translate(
      'checkout.errors.amountPrecisionExceeded',
      enDictionary['checkout.errors.amountPrecisionExceeded'],
      precisionError,
    ),
  }
}
