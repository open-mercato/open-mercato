/**
 * The Kingdom's tax engine, as an implementation of the engine's contract.
 *
 * It adds no arithmetic of its own. Every amount goes through the pinned
 * primitives in `./vat` — the 15% rate, halala rounding applied to the decimal
 * the caller wrote rather than its binary approximation, and the ZATCA decimal
 * form. Re-deriving any of that here is how the ledger and the e-invoice would
 * drift a halala apart on a multi-line invoice, which is exactly the failure the
 * country-plugin layer exists to prevent.
 */
import type { TaxComputation, TaxComputeInput, TaxEngineContract, TaxCategory } from '@/modules/financial/lib/contracts'
import {
  SAUDI_STANDARD_VAT_RATE,
  computeVatFromNet,
  formatSaudDecimal,
  isValidSaudiVatNumber,
  roundToHalalas,
} from './vat'
import {
  SAUDI_COUNTRY_CODE,
  SAUDI_CURRENCY_CODE,
} from './number-format'
import {
  SAUDI_VAT_TAX_CODES,
  classifySaudiTaxCode,
  findSaudiVatTaxCode,
} from './tax-codes'

export const SAUDI_MINOR_UNIT_SCALE = 2

export function buildSaudiTaxEngine(): TaxEngineContract {
  return {
    countryCode: SAUDI_COUNTRY_CODE,
    currencyCode: SAUDI_CURRENCY_CODE,
    minorUnitScale: SAUDI_MINOR_UNIT_SCALE,
    listRates: () => SAUDI_VAT_TAX_CODES,
    findRate: (code) => findSaudiVatTaxCode(code),
    classify: (code): TaxCategory => classifySaudiTaxCode(code),
    compute: (input: TaxComputeInput): TaxComputation => {
      const definition = findSaudiVatTaxCode(input.taxCode)
      // An unknown code carries no rate. The category still comes back, so the
      // caller learns the line is out of scope rather than silently taxed at
      // whatever rate happened to be the default.
      const rate = definition?.rate ?? 0
      const category = input.statedCategory ?? classifySaudiTaxCode(input.taxCode)
      const breakdown = computeVatFromNet(Number(input.net), rate)
      return {
        taxCode: input.taxCode,
        category,
        rate,
        net: formatSaudDecimal(breakdown.net),
        tax: formatSaudDecimal(breakdown.vat),
        gross: formatSaudDecimal(breakdown.gross),
      }
    },
    roundMoney: (value) => formatSaudDecimal(value),
  }
}

/** Exposed so the compliance contract and tests share one standard-rate check. */
export const SAUDI_DEFAULT_VAT_RATE = SAUDI_STANDARD_VAT_RATE

export { roundToHalalas, isValidSaudiVatNumber }
