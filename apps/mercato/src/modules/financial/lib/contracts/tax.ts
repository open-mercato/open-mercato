/**
 * How a jurisdiction computes tax. Types only — the engine imports nothing else
 * from a country plugin, which is what keeps `financial` jurisdiction-neutral.
 *
 * Amounts cross this boundary as **decimal strings**, never numbers: the ledger
 * stores `NUMERIC` and a jurisdiction's rounding rule is defined on the decimal
 * the operator wrote, so a float in the middle would reintroduce the halala drift
 * the ledger's own arithmetic exists to avoid (`lib/glService.ts`).
 */

/**
 * The ZATCA category vocabulary (`S` standard, `Z` zero-rated, `E` exempt,
 * `O` out of scope). A jurisdiction that reports by a different vocabulary maps
 * onto these four; the engine only ever reasons about the categories, because
 * they are what a tax return groups by.
 */
export const TAX_CATEGORIES = ['S', 'Z', 'E', 'O'] as const
export type TaxCategory = (typeof TAX_CATEGORIES)[number]

export type TaxRateDefinition = {
  /** Stable code stored on a journal line (`gl_journal_lines.tax_code`). */
  code: string
  label: string
  category: TaxCategory
  /** Fraction, not percent: 15% is `0.15`. */
  rate: number
  /** GL account the output side posts to (sales). */
  salesAccountCode?: string | null
  /** GL account the input side posts to (purchases). */
  purchaseAccountCode?: string | null
}

export type TaxComputation = {
  taxCode: string
  category: TaxCategory
  rate: number
  /** Decimal strings, each rounded to the jurisdiction's minor unit. */
  net: string
  tax: string
  gross: string
}

export type TaxComputeInput = {
  net: string | number
  taxCode: string
  /**
   * Set when the source stated which exemption applies. A zero-rate line with
   * no stated exemption is classified by `classify()` instead — never assumed
   * to be zero-rated, which is the rule the e-invoice side already follows.
   */
  statedCategory?: TaxCategory | null
}

export type TaxEngineContract = {
  readonly countryCode: string
  /** ISO 4217 code the jurisdiction taxes in. */
  readonly currencyCode: string
  /** Smallest unit a rounded amount may land on (halalas are 2 decimals). */
  readonly minorUnitScale: number
  listRates(): readonly TaxRateDefinition[]
  findRate(code: string): TaxRateDefinition | null
  /** Category of a tax code when the source did not state one. */
  classify(taxCode: string | null | undefined): TaxCategory
  compute(input: TaxComputeInput): TaxComputation
  /** Round a money value to the jurisdiction's minor unit, as a decimal string. */
  roundMoney(value: string | number): string
}
