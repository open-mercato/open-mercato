/**
 * What invoicing a jurisdiction requires. Types only.
 *
 * The engine never builds a document itself — a country plugin owns that, and
 * for the Kingdom it is the byte-exact ZATCA stack that already ships in
 * `saudi_localization`. What the engine needs from this contract is the
 * *capability* answer, so a screen can say what an entity may issue instead of
 * discovering it from a rejected submission.
 */

/** `standard` is the B2B clearance document; `simplified` is the B2C receipt. */
export const INVOICE_SUBTYPES = ['standard', 'simplified'] as const
export type InvoiceSubtype = (typeof INVOICE_SUBTYPES)[number]

export type InvoiceCapabilities = {
  /** Whether an invoice may carry the jurisdiction's mandated QR payload. */
  qrCode: boolean
  /** Whether the jurisdiction operates a real-time clearance/reporting API. */
  realtimeClearance: boolean
  /** Whether the issued document is signed (XAdES and the like). */
  signedDocuments: boolean
  subtypes: readonly InvoiceSubtype[]
  /**
   * The hash chain is required for Phase 2 (`ICV`/`PIH` sequencing). Reported
   * separately because a Phase 1 build has the QR and none of the chain.
   */
  hashChain: boolean
}

export type InvoiceFormatContract = {
  readonly countryCode: string
  capabilities(): InvoiceCapabilities
  /** The subtype to issue when the caller did not choose one. */
  defaultSubtype(): InvoiceSubtype
}
