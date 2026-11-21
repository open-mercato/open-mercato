import {
  decimalToNumber,
  multiplyDecimals,
  resolveIsoCurrencyDecimalPlaces,
  roundDecimal,
  sumDecimals,
  type DecimalInput,
} from '@open-mercato/shared/lib/decimal'

const TAX_RATE = '0.08'
const SHIPPING_FLAT_RATE_USD = '9.99'
const FALLBACK_DECIMAL_PLACES = 2

export type CheckoutCartItem = {
  id: string
  name: string
  price: number
  quantity: number
}

export type CheckoutTotals<TItem extends CheckoutCartItem> = {
  items: TItem[]
  subtotal: number
  tax: number
  shipping: number
  total: number
}

function resolveDecimalPlaces(currencyCode: string): number {
  return resolveIsoCurrencyDecimalPlaces(currencyCode) ?? FALLBACK_DECIMAL_PLACES
}

export function convertCheckoutPrice(price: number, exchangeRate: number, currencyCode: string): number {
  return decimalToNumber(roundDecimal(multiplyDecimals(price, exchangeRate), resolveDecimalPlaces(currencyCode)))
}

/**
 * Converts USD cart prices to the selected currency and computes the demo's
 * subtotal, 8% tax, flat shipping and total, each rounded to the currency's
 * ISO 4217 minor units, so the amounts sent to the order API are valid money
 * amounts and the total is exactly the sum of its rounded parts.
 */
export function computeCheckoutTotals<TItem extends CheckoutCartItem>(
  cart: TItem[],
  exchangeRate: number,
  currencyCode: string,
): CheckoutTotals<TItem> {
  const decimalPlaces = resolveDecimalPlaces(currencyCode)
  const round = (value: DecimalInput) => roundDecimal(value, decimalPlaces)
  const items = cart.map((item) => ({
    ...item,
    price: convertCheckoutPrice(item.price, exchangeRate, currencyCode),
  }))
  const subtotal = round(sumDecimals(items.map((item) => multiplyDecimals(item.price, item.quantity))))
  const tax = round(multiplyDecimals(subtotal, TAX_RATE))
  const shipping = round(multiplyDecimals(SHIPPING_FLAT_RATE_USD, exchangeRate))
  const total = round(sumDecimals([subtotal, tax, shipping]))
  return {
    items,
    subtotal: decimalToNumber(subtotal),
    tax: decimalToNumber(tax),
    shipping: decimalToNumber(shipping),
    total: decimalToNumber(total),
  }
}
