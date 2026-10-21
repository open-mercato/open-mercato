/**
 * Withholding tax as a jurisdiction capability. Types only.
 *
 * The AP payment path asks the country plugin for the category catalogue and the
 * net-of-tax arithmetic; the engine never hard-codes a rate or an account. A
 * jurisdiction without withholding simply does not register the capability, and
 * a payment that names a withholding code is refused rather than silently paid
 * gross.
 */

export type WithholdingCategory = {
  code: string
  label: string
  /** Fraction, not percent: 5% is `0.05`. */
  rate: number
  /** Ledger account the withheld amount is held in until it is remitted. */
  payableAccountCode: string
}

export type WithholdingComputation = {
  categoryCode: string
  rate: number
  gross: string
  withholding: string
  netPayable: string
  payableAccountCode: string
}

export type WithholdingContract = {
  readonly countryCode: string
  listCategories(): readonly WithholdingCategory[]
  findCategory(code: string | null | undefined): WithholdingCategory | null
  compute(input: { gross: string; code: string }): WithholdingComputation
}
