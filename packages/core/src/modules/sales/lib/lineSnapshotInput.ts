/**
 * Numeric line fields whose explicit `null` the sales line validators coerce to
 * `0` (`z.coerce.number()`), on document creation and line writes alike.
 */
export const SALES_LINE_NUMERIC_INPUT_FIELDS = [
  'normalizedQuantity',
  'unitPriceNet',
  'unitPriceGross',
  'discountAmount',
  'discountPercent',
  'taxRate',
  'taxAmount',
  'totalNetAmount',
  'totalGrossAmount',
] as const

export type SalesLineNumericInputField = (typeof SALES_LINE_NUMERIC_INPUT_FIELDS)[number]

type WithoutNullNumerics<T> = {
  [K in keyof T]: K extends SalesLineNumericInputField ? Exclude<T[K], null> : T[K]
}

/**
 * Prepare a SalesLineSnapshot (or any snapshot-shaped line) for
 * `sales.orders.create` / `sales.quotes.create`. In a snapshot, a numeric `null`
 * means "no value"; on the create input it means `0`. Dropping those keys gives
 * the snapshot's meaning: the field is computed or inherited as if omitted.
 * Non-numeric `null`s are kept, since the line validators already read them as
 * omitted.
 */
export function omitNullLineNumerics<T extends object>(line: T): WithoutNullNumerics<T> {
  const result: Record<string, unknown> = { ...(line as Record<string, unknown>) }
  for (const field of SALES_LINE_NUMERIC_INPUT_FIELDS) {
    if (result[field] === null) delete result[field]
  }
  return result as WithoutNullNumerics<T>
}
