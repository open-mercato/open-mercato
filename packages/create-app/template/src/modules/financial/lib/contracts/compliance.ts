/**
 * What a jurisdiction demands before a document may be issued. Types only.
 *
 * A compliance check answers with a *reason*, never with a bare boolean: the
 * operator's next action differs completely between "your VAT number is the wrong
 * shape" and "the seller name has not been saved yet", and a screen that cannot
 * tell them apart sends people to the wrong field.
 */

export type ComplianceIssue = {
  /** Stable, translatable key (`vat_number_invalid`, `seller_name_missing`, …). */
  code: string
  /** The value the issue is about, when there is one. */
  field?: string | null
}

export type ComplianceCheckInput = {
  /** Whatever the caller read from the tenant's settings row. */
  taxRegistrationNumber?: string | null
  registrationNumber?: string | null
  legalName?: string | null
}

export type ComplianceVerdict =
  | { ok: true; issues: readonly [] }
  | { ok: false; issues: readonly ComplianceIssue[] }

export type ComplianceCheckContract = {
  readonly countryCode: string
  /** Shape of the tax registration number (the VAT number). */
  isValidTaxRegistrationNumber(value: string | null | undefined): boolean
  /** Shape of the commercial registration number, when the jurisdiction has one. */
  isValidRegistrationNumber(value: string | null | undefined): boolean
  /** Everything that must hold before an e-invoice may be issued. */
  checkInvoicePrerequisites(input: ComplianceCheckInput): ComplianceVerdict
}
