/**
 * The Kingdom's tax-code catalogue: what a journal line's `tax_code` means, and
 * which account each code's tax posts to.
 *
 * Two rules govern this file, and both come from compliance rather than taste:
 *
 * 1. **The category is never guessed.** A line that carries tax is `S`. A line
 *    with no tax is `Z` (zero-rated) or `E` (exempt) only when the source stated
 *    which exemption applies; otherwise it is `O` (out of scope). That is a
 *    filing distinction, not a cosmetic one — reporting an untaxed domestic line
 *    as zero-rated overstates exempt turnover and understates the standard-rated
 *    base. This mirrors `lib/zatca/order-invoice.ts` exactly so the ledger and
 *    the e-invoice can never disagree about a line.
 *
 * 2. **Every code names the account it posts to.** Posting is then mechanical: a
 *    caller reads the account from here rather than deciding which VAT account an
 *    amount belongs in, and `lib/saudi/coa.ts` guarantees that account exists
 *    because it is the same set of codes.
 */
import type { TaxCategory, TaxRateDefinition } from '@/modules/financial/lib/contracts'

/** Accounts the tax codes reference. Declared here, seeded by `lib/saudi/coa.ts`. */
export const SAUDI_OUTPUT_VAT_ACCOUNT = '2100'
export const SAUDI_INPUT_VAT_ACCOUNT = '1150'
export const SAUDI_WHT_PAYABLE_ACCOUNT = '2110'

export const SAUDI_STANDARD_VAT_CODE = 'SA-VAT-S'
export const SAUDI_ZERO_RATED_VAT_CODE = 'SA-VAT-Z'
export const SAUDI_EXEMPT_VAT_CODE = 'SA-VAT-E'
export const SAUDI_OUT_OF_SCOPE_VAT_CODE = 'SA-VAT-O'

/** The default reading of a zero-tax line with no stated exemption. */
export const SAUDI_DEFAULT_VAT_CATEGORY: TaxCategory = 'O'

/**
 * The four VAT codes. `SA-VAT-S` is the only one carrying tax; the other three
 * are 0% and exist so a line can *say* why it carries no tax.
 */
export const SAUDI_VAT_TAX_CODES: readonly TaxRateDefinition[] = [
  {
    code: SAUDI_STANDARD_VAT_CODE,
    label: 'Standard rate (15%)',
    category: 'S',
    rate: 0.15,
    salesAccountCode: SAUDI_OUTPUT_VAT_ACCOUNT,
    purchaseAccountCode: SAUDI_INPUT_VAT_ACCOUNT,
  },
  {
    code: SAUDI_ZERO_RATED_VAT_CODE,
    label: 'Zero-rated (0%)',
    category: 'Z',
    rate: 0,
    salesAccountCode: null,
    purchaseAccountCode: null,
  },
  {
    code: SAUDI_EXEMPT_VAT_CODE,
    label: 'Exempt (0%)',
    category: 'E',
    rate: 0,
    salesAccountCode: null,
    purchaseAccountCode: null,
  },
  {
    code: SAUDI_OUT_OF_SCOPE_VAT_CODE,
    label: 'Out of scope',
    category: 'O',
    rate: 0,
    salesAccountCode: null,
    purchaseAccountCode: null,
  },
]

/**
 * Withholding tax on payments to non-residents, at the published ZATCA schedule.
 * These are not VAT codes — they carry no ZATCA category and never belong on a
 * tax invoice — so `classify()` reports them as out of scope for VAT purposes
 * and the AP payment path applies them as a deduction.
 *
 * The rates are the published schedule; a tenant files with its own assessment,
 * which is why the catalogue is data a caller reads rather than a rule the
 * engine enforces.
 */
export type SaudiWithholdingCategory = {
  code: string
  label: string
  rate: number
  /** The account the deducted amount is held in until it is remitted. */
  payableAccountCode: string
}

export const SAUDI_WITHHOLDING_CATEGORIES: readonly SaudiWithholdingCategory[] = [
  { code: 'SA-WHT-SERVICES', label: 'Services', rate: 0.05, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
  { code: 'SA-WHT-ROYALTIES', label: 'Royalties', rate: 0.15, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
  { code: 'SA-WHT-RENT', label: 'Rent of equipment and machinery', rate: 0.15, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
  { code: 'SA-WHT-MANAGEMENT', label: 'Management fees', rate: 0.20, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
  { code: 'SA-WHT-DIVIDENDS', label: 'Dividends', rate: 0.05, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
  { code: 'SA-WHT-INTEREST', label: 'Interest', rate: 0.05, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
  { code: 'SA-WHT-INSURANCE', label: 'Insurance and reinsurance premiums', rate: 0.05, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
  { code: 'SA-WHT-TELECOM', label: 'International telecommunication services', rate: 0.05, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
  { code: 'SA-WHT-TRANSPORT', label: 'Air and sea transport', rate: 0.05, payableAccountCode: SAUDI_WHT_PAYABLE_ACCOUNT },
]

const WHT_BY_CODE = new Map(SAUDI_WITHHOLDING_CATEGORIES.map((entry) => [entry.code, entry]))
const VAT_BY_CODE = new Map(SAUDI_VAT_TAX_CODES.map((entry) => [entry.code, entry]))

export function findSaudiVatTaxCode(code: string | null | undefined): TaxRateDefinition | null {
  if (typeof code !== 'string') return null
  return VAT_BY_CODE.get(code.trim().toUpperCase()) ?? null
}

export function findSaudiWithholdingCategory(code: string | null | undefined): SaudiWithholdingCategory | null {
  if (typeof code !== 'string') return null
  return WHT_BY_CODE.get(code.trim().toUpperCase()) ?? null
}

/**
 * The VAT category of a tax code.
 *
 * An unknown code — one written before this catalogue existed, or by a caller
 * with its own vocabulary — reads as out of scope rather than standard-rated:
 * assuming a rate would put tax on a line nobody taxed, and assuming zero-rated
 * would claim an exemption nobody stated. Out of scope is the reading that
 * requires the operator to look.
 */
export function classifySaudiTaxCode(code: string | null | undefined): TaxCategory {
  const definition = findSaudiVatTaxCode(code)
  if (definition) return definition.category
  return SAUDI_DEFAULT_VAT_CATEGORY
}

/** The account a tax code's tax posts to on the given side, when it has one. */
export function saudiAccountForTaxCode(
  code: string | null | undefined,
  side: 'sales' | 'purchase',
): string | null {
  const definition = findSaudiVatTaxCode(code)
  if (definition) {
    return (side === 'sales' ? definition.salesAccountCode : definition.purchaseAccountCode) ?? null
  }
  return findSaudiWithholdingCategory(code)?.payableAccountCode ?? null
}
