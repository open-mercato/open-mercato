import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { countDecimalPlaces, parseDecimal } from '@open-mercato/shared/lib/decimal'

export const CART_QUANTITY_STORAGE_MAX = '999999999999.9999'
export const CART_QUANTITY_ERROR_KEY = 'cart.errors.quantity_invalid'

function parseStoredQuantity(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const quantity = parseDecimal(value)
  if (!quantity || quantity.abs().gt(CART_QUANTITY_STORAGE_MAX) || countDecimalPlaces(quantity) > 4) return null
  return quantity
}

export function fitsCartQuantityStorage(value: unknown): boolean {
  return parseStoredQuantity(value) !== null
}

export function assertCartQuantity(value: string | number, { allowZero = false } = {}): string {
  const quantity = parseStoredQuantity(value)
  if (!quantity || quantity.lt(0) || (!allowZero && quantity.eq(0))) {
    throw new CrudHttpError(400, { error: CART_QUANTITY_ERROR_KEY, code: 'cart_quantity_invalid' })
  }
  return quantity.toFixed()
}

export function toWritableCartQuantity(value: string | number): string {
  const exact = assertCartQuantity(value, { allowZero: true })
  return assertCartQuantity(Number(exact), { allowZero: true })
}
