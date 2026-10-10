/**
 * What the Kingdom's e-invoicing actually supports today — reported honestly.
 *
 * This is the file where an over-claim would be expensive. "ZATCA e-invoicing" is
 * commonly read as "cleared by ZATCA", and the difference between generating a
 * compliant document and having it accepted is precisely what a customer is
 * buying. So each capability is answered on its own:
 *
 * - **`qrCode`** — shipped and pinned to published vectors: a Phase-1 simplified
 *   invoice may carry the mandated TLV payload.
 * - **`hashChain`** — shipped: `ICV`/`PIH` sequencing and the invoice hash, so a
 *   document is reproducible and ordered.
 * - **`signedDocuments`** — **not** shipped: the XAdES signature needs a CSID from
 *   ZATCA, so what the preview returns is the document as it exists before signing.
 * - **`realtimeClearance`** — **not** shipped: clearance and reporting are calls to
 *   ZATCA that require CSID onboarding and a sandbox validation run. Until then an
 *   issued invoice is recorded as a local, pending submission and nothing is sent.
 *
 * Reading these four flags is how a screen says "you can print this invoice" and
 * "this invoice has not been accepted by ZATCA" without contradicting itself.
 */
import type {
  InvoiceCapabilities,
  InvoiceFormatContract,
  InvoiceSubtype,
} from '@/modules/financial/lib/contracts'
import { SAUDI_COUNTRY_CODE } from './number-format'

export const SAUDI_INVOICE_SUBTYPES: readonly InvoiceSubtype[] = ['standard', 'simplified']

/**
 * A simplified invoice has no buyer identity to clear, which is why it is the
 * default an operator gets when nobody chose: it is the document that can always
 * be issued.
 */
export const SAUDI_DEFAULT_INVOICE_SUBTYPE: InvoiceSubtype = 'simplified'

export function buildSaudiInvoiceFormat(): InvoiceFormatContract {
  const capabilities: InvoiceCapabilities = {
    qrCode: true,
    hashChain: true,
    signedDocuments: false,
    realtimeClearance: false,
    subtypes: SAUDI_INVOICE_SUBTYPES,
  }
  return {
    countryCode: SAUDI_COUNTRY_CODE,
    capabilities: () => capabilities,
    defaultSubtype: () => SAUDI_DEFAULT_INVOICE_SUBTYPE,
  }
}
