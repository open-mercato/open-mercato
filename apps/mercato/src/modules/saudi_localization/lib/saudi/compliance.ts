/**
 * What must hold before a Saudi tax invoice may be issued.
 *
 * The checks delegate to the primitives the invoice path already trusts
 * (`isValidSaudiVatNumber`, the seller settings the QR is built from) rather than
 * re-deriving them, so a number the settings screen accepted can never be one the
 * compliance check rejects.
 *
 * Every failure names a **field**, not just a reason. "The seller identity is
 * incomplete" sends an operator to a screen; `vat_number_invalid` sends them to
 * the VAT number they mistyped.
 */
import type {
  ComplianceCheckContract,
  ComplianceCheckInput,
  ComplianceIssue,
  ComplianceVerdict,
} from '@/modules/financial/lib/contracts'
import { isValidSaudiVatNumber } from './vat'
import { SAUDI_COUNTRY_CODE } from './number-format'

/**
 * A Saudi commercial registration number is ten digits. The shape is checked, not
 * the registry: whether a number is *issued* is ZATCA's answer to give, and a
 * check that pretended otherwise would reject a legitimately formatted number
 * that this app has no way to verify.
 */
export const SAUDI_CR_NUMBER_PATTERN = /^\d{10}$/

export function isValidSaudiCrNumber(value: string | null | undefined): boolean {
  return typeof value === 'string' && SAUDI_CR_NUMBER_PATTERN.test(value.trim())
}

export function checkSaudiInvoicePrerequisites(input: ComplianceCheckInput): ComplianceVerdict {
  const issues: ComplianceIssue[] = []
  const legalName = input.legalName?.trim() ?? ''
  const vatNumber = input.taxRegistrationNumber?.trim() ?? ''

  if (legalName.length === 0) {
    issues.push({ code: 'seller_name_missing', field: 'sellerName' })
  }
  if (vatNumber.length === 0) {
    issues.push({ code: 'vat_number_missing', field: 'vatRegistrationNumber' })
  } else if (!isValidSaudiVatNumber(vatNumber)) {
    issues.push({ code: 'vat_number_invalid', field: 'vatRegistrationNumber' })
  }

  if (issues.length === 0) return { ok: true, issues: [] }
  return { ok: false, issues }
}

export function buildSaudiCompliance(): ComplianceCheckContract {
  return {
    countryCode: SAUDI_COUNTRY_CODE,
    isValidTaxRegistrationNumber: (value) =>
      typeof value === 'string' && isValidSaudiVatNumber(value.trim()),
    isValidRegistrationNumber: (value) =>
      value == null || value.trim().length === 0 || isValidSaudiCrNumber(value),
    checkInvoicePrerequisites: checkSaudiInvoicePrerequisites,
  }
}
