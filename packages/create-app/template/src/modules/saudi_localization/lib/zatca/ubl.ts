/**
 * UBL 2.1 invoice assembly for ZATCA.
 *
 * The element set, the ordering and the constants below come from a working ZATCA
 * implementation's UBL templates rather than from memory, because every one of them
 * is a business rule with a number:
 *
 *   - `cbc:ProfileID` is `reporting:1.0` (the reporting profile);
 *   - `cbc:UUID` follows `cbc:ID` (BR-KSA-03) and carries the issued invoice's UUID;
 *   - `cbc:IssueDate` + `cbc:IssueTime` (KSA-25), taken in `Asia/Riyadh`;
 *   - `cbc:InvoiceTypeCode` carries the transaction code in its `name` attribute
 *     (KSA-2), `NNPNESB`: `NN` = 01 tax invoice, 02 simplified tax invoice,
 *     position 5 = 1 for exports. Credit notes are also written as
 *     `cbc:InvoiceTypeCode` (ZATCA never uses `CreditNoteTypeCode`);
 *   - `cac:AdditionalDocumentReference` blocks for the QR code (simplified invoices
 *     only, BR-KSA-27), the previous invoice hash (BR-KSA-61) and the invoice counter
 *     value, whose `cbc:UUID` carries the counter (BR-KSA-33/34);
 *   - `cac:Signature` with the UBL enveloped XAdES method (BR-KSA-29/30), also
 *     simplified invoices only;
 *   - a second `cac:TaxTotal` when the invoice currency differs from the tax
 *     currency (BT-110/BT-111).
 *
 * The document is built twice from one input: as the final invoice, and as the
 * pre-hash projection — the same document without `UBLExtensions`, the signature and
 * the QR block, which is exactly what the reference pre-hash transform removes.
 * Hashing the projection is what keeps the hash stable when the QR code (which
 * contains that hash) is inserted afterwards.
 *
 * Deliberately not here: the XAdES signature itself and the CSID onboarding around
 * it. Those need a canonicalization pass over the signed document plus a certificate
 * from ZATCA, and until they exist nothing in this file may claim to produce a
 * cleared invoice.
 */

import { formatSaudDecimal } from '../saudi/vat'
import { INITIAL_PREVIOUS_INVOICE_HASH, computeInvoiceHash, resolvePreviousInvoiceHash } from './hash'
import { serializeCanonicalXml, xmlElement, xmlText, type XmlNode } from './xml'

export const UBL_NAMESPACES = {
  '': 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  sig: 'urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2',
  sac: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2',
  sbc: 'urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xades: 'http://uri.etsi.org/01903/v1.3.2#',
} as const

export const ZATCA_REPORTING_PROFILE_ID = 'reporting:1.0'
export const ZATCA_CLEARANCE_PROFILE_ID = 'clearance:1.0'
export const ZATCA_VAT_TAX_SCHEME_ID = 'VAT'
export const ZATCA_SIGNATURE_ID = 'urn:oasis:names:specification:ubl:signature:Invoice'
export const ZATCA_SIGNATURE_METHOD = 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'

export const ZATCA_DOCUMENT_TYPE_CODE = {
  invoice: 388,
  credit_note: 381,
  debit_note: 383,
} as const

export type ZatcaDocumentKind = keyof typeof ZATCA_DOCUMENT_TYPE_CODE
export type ZatcaInvoiceSubtype = 'standard' | 'simplified'

export type ZatcaParty = {
  /** Registered name, as it appears on the tax invoice. */
  name: string
  /** 15-digit VAT registration number. */
  vatNumber: string
  identificationNumber?: string | null
  identificationScheme?: string | null
  streetName?: string | null
  buildingNumber?: string | null
  citySubdivisionName?: string | null
  cityName?: string | null
  postalZone?: string | null
  countryCode: string
}

export type ZatcaInvoiceLine = {
  id: string
  quantity: number | string
  unitCode: string
  lineExtensionAmount: number | string
  taxAmount: number | string
  taxCategoryCode: string
  taxPercent: number | string
  itemName: string
  itemCode?: string | null
  /** Unit price before VAT; supplied rather than derived so the line stays internally consistent. */
  unitPrice: number | string
  /** ZATCA exemption code for zero-rated, exempt or out-of-scope lines. */
  taxExemptionReasonCode?: string | null
}

export type ZatcaInvoiceErrorCode =
  | 'missing_required_value'
  | 'invalid_icv'
  | 'invalid_timestamp'
  | 'missing_qr_payload'
  | 'missing_lines'

export class ZatcaInvoiceError extends Error {
  readonly code: ZatcaInvoiceErrorCode

  constructor(code: ZatcaInvoiceErrorCode, message: string) {
    super(`[internal] ${message}`)
    this.name = 'ZatcaInvoiceError'
    this.code = code
  }
}

export type ZatcaInvoiceInput = {
  invoiceNumber: string
  uuid: string
  /** The moment of issue; the caller owns "now". */
  issuedAt: Date | string
  subtype: ZatcaInvoiceSubtype
  documentKind: ZatcaDocumentKind
  isExport?: boolean
  /** Invoice currency, e.g. SAR. */
  currencyCode: string
  /** Currency the VAT amounts are expressed in — SAR for ZATCA. */
  taxCurrencyCode: string
  /** Counter claimed through the invoice chain. */
  icv: number
  /** `PIH` for this invoice; defaults to the value a first invoice carries. */
  previousInvoiceHash?: string | null
  seller: ZatcaParty
  buyer?: ZatcaParty | null
  lines: readonly ZatcaInvoiceLine[]
  taxAmount: number | string
  taxExclusiveAmount: number | string
  taxInclusiveAmount: number | string
  payableAmount: number | string
  profileId?: string
  notes?: readonly string[]
}

function amount(value: number | string): string {
  return formatSaudDecimal(value)
}

function requireText(value: string | null | undefined, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    throw new ZatcaInvoiceError('missing_required_value', `${label} is required on a ZATCA invoice.`)
  }
  return trimmed
}

/** `NNPNESB` — the transaction code from KSA-2. */
export function buildInvoiceTransactionCode(subtype: ZatcaInvoiceSubtype, isExport = false): string {
  const subtypeDigit = subtype === 'simplified' ? '2' : '1'
  const exportDigit = isExport && subtype === 'standard' ? '1' : '0'
  return `0${subtypeDigit}00${exportDigit}00`
}

function toIssueDateParts(issuedAt: Date | string): { date: string; time: string } {
  const parsed = issuedAt instanceof Date ? issuedAt : new Date(issuedAt)
  if (Number.isNaN(parsed.getTime())) {
    throw new ZatcaInvoiceError('invalid_timestamp', 'The invoice issue timestamp is not a valid date.')
  }
  const iso = parsed.toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) }
}

function requireIcv(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new ZatcaInvoiceError('invalid_icv', 'An invoice counter value must be an integer of at least 1.')
  }
  return value
}

function buildAddressNode(party: ZatcaParty): XmlNode {
  const children: XmlNode[] = []
  const streetName = party.streetName?.trim()
  const buildingNumber = party.buildingNumber?.trim()
  const citySubdivisionName = party.citySubdivisionName?.trim()
  const cityName = party.cityName?.trim()
  const postalZone = party.postalZone?.trim()
  if (streetName) children.push(xmlText('cbc:StreetName', streetName))
  if (buildingNumber) children.push(xmlText('cbc:BuildingNumber', buildingNumber))
  if (citySubdivisionName) children.push(xmlText('cbc:CitySubdivisionName', citySubdivisionName))
  if (cityName) children.push(xmlText('cbc:CityName', cityName))
  if (postalZone) children.push(xmlText('cbc:PostalZone', postalZone))
  children.push(xmlElement('cac:Country', [xmlText('cbc:IdentificationCode', requireText(party.countryCode, 'A country code'))]))
  return xmlElement('cac:PostalAddress', children)
}

function buildPartyNode(party: ZatcaParty, role: 'seller' | 'buyer'): XmlNode {
  const name = requireText(party.name, `The ${role} name`)
  const vatNumber = requireText(party.vatNumber, `The ${role} VAT registration number`)
  const children: XmlNode[] = []
  const identificationNumber = party.identificationNumber?.trim()
  const identificationScheme = party.identificationScheme?.trim()
  if (identificationNumber) {
    children.push(
      xmlElement('cac:PartyIdentification', [
        xmlText('cbc:ID', identificationNumber, identificationScheme ? { schemeID: identificationScheme } : undefined),
      ]),
    )
  }
  children.push(buildAddressNode(party))
  children.push(
    xmlElement('cac:PartyTaxScheme', [
      xmlText('cbc:CompanyID', vatNumber),
      xmlElement('cac:TaxScheme', [xmlText('cbc:ID', ZATCA_VAT_TAX_SCHEME_ID)]),
    ]),
  )
  children.push(xmlElement('cac:PartyLegalEntity', [xmlText('cbc:RegistrationName', name)]))
  return xmlElement('cac:Party', children)
}

function buildTaxCategoryNode(line: ZatcaInvoiceLine): XmlNode {
  const children: XmlNode[] = [xmlText('cbc:ID', requireText(line.taxCategoryCode, 'A VAT category code'))]
  const exemptionCode = line.taxExemptionReasonCode?.trim()
  if (exemptionCode) children.push(xmlText('cbc:TaxExemptionReasonCode', exemptionCode))
  children.push(xmlText('cbc:Percent', amount(line.taxPercent)))
  children.push(xmlElement('cac:TaxScheme', [xmlText('cbc:ID', ZATCA_VAT_TAX_SCHEME_ID)]))
  return xmlElement('cac:TaxCategory', children)
}

function buildLineNode(line: ZatcaInvoiceLine, currencyCode: string): XmlNode {
  const lineExtensionAmount = Number(line.lineExtensionAmount)
  const taxAmount = Number(line.taxAmount)
  const children: XmlNode[] = [
    xmlText('cbc:ID', requireText(line.id, 'A line id')),
    xmlText('cbc:InvoicedQuantity', amount(line.quantity), {
      unitCode: requireText(line.unitCode, 'A line unit code'),
    }),
    xmlText('cbc:LineExtensionAmount', amount(lineExtensionAmount), { currencyID: currencyCode }),
    xmlElement('cac:TaxTotal', [
      xmlText('cbc:TaxAmount', amount(taxAmount), { currencyID: currencyCode }),
      xmlText('cbc:RoundingAmount', amount(lineExtensionAmount + taxAmount), { currencyID: currencyCode }),
    ]),
  ]
  const itemChildren: XmlNode[] = [xmlText('cbc:Name', requireText(line.itemName, 'A line item name'))]
  const itemCode = line.itemCode?.trim()
  if (itemCode) {
    itemChildren.push(xmlElement('cac:SellersItemIdentification', [xmlText('cbc:ID', itemCode)]))
  }
  children.push(xmlElement('cac:Item', itemChildren))
  children.push(
    xmlElement('cac:Price', [xmlText('cbc:PriceAmount', amount(line.unitPrice), { currencyID: currencyCode })]),
  )
  return xmlElement('cac:InvoiceLine', children)
}

function buildBinaryObjectReferenceNode(id: string, value: string): XmlNode {
  return xmlElement('cac:AdditionalDocumentReference', [
    xmlText('cbc:ID', id),
    xmlElement('cac:Attachment', [
      xmlText('cbc:EmbeddedDocumentBinaryObject', value, { mimeCode: 'text/plain' }),
    ]),
  ])
}

function buildIcvReferenceNode(icv: number): XmlNode {
  return xmlElement('cac:AdditionalDocumentReference', [xmlText('cbc:ID', 'ICV'), xmlText('cbc:UUID', icv)])
}

function buildSignatureNode(): XmlNode {
  return xmlElement('cac:Signature', [
    xmlText('cbc:ID', ZATCA_SIGNATURE_ID),
    xmlText('cbc:SignatureMethod', ZATCA_SIGNATURE_METHOD),
  ])
}

type InvoiceNodeOptions = {
  includeQrAndSignature: boolean
  qrPayload?: string | null
}

function buildInvoiceNode(input: ZatcaInvoiceInput, options: InvoiceNodeOptions): XmlNode {
  const currencyCode = requireText(input.currencyCode, 'The invoice currency code')
  const taxCurrencyCode = requireText(input.taxCurrencyCode, 'The tax currency code')
  if (input.lines.length === 0) {
    throw new ZatcaInvoiceError('missing_lines', 'A ZATCA invoice needs at least one invoice line.')
  }
  const icv = requireIcv(input.icv)
  const previousInvoiceHash = resolvePreviousInvoiceHash(input.previousInvoiceHash ?? INITIAL_PREVIOUS_INVOICE_HASH)
  const { date, time } = toIssueDateParts(input.issuedAt)
  const isSimplified = input.subtype === 'simplified'
  const qrPayload = options.qrPayload?.trim() ?? ''
  if (options.includeQrAndSignature && isSimplified && !qrPayload) {
    throw new ZatcaInvoiceError('missing_qr_payload', 'A simplified tax invoice must carry its QR code (BR-KSA-27).')
  }

  const children: XmlNode[] = [
    xmlText('cbc:ProfileID', input.profileId?.trim() || ZATCA_REPORTING_PROFILE_ID),
    xmlText('cbc:ID', requireText(input.invoiceNumber, 'The invoice number')),
    xmlText('cbc:UUID', requireText(input.uuid, 'The invoice UUID')),
    xmlText('cbc:IssueDate', date),
    xmlText('cbc:IssueTime', time),
    xmlText('cbc:InvoiceTypeCode', ZATCA_DOCUMENT_TYPE_CODE[input.documentKind], {
      name: buildInvoiceTransactionCode(input.subtype, input.isExport),
    }),
    xmlText('cbc:DocumentCurrencyCode', currencyCode),
    xmlText('cbc:TaxCurrencyCode', taxCurrencyCode),
  ]
  for (const note of input.notes ?? []) {
    const trimmed = note?.trim()
    if (trimmed) children.push(xmlText('cbc:Note', trimmed))
  }
  if (options.includeQrAndSignature && isSimplified) {
    children.push(buildBinaryObjectReferenceNode('QR', qrPayload))
  }
  children.push(buildBinaryObjectReferenceNode('PIH', previousInvoiceHash))
  children.push(buildIcvReferenceNode(icv))
  if (options.includeQrAndSignature && isSimplified) children.push(buildSignatureNode())

  children.push(xmlElement('cac:AccountingSupplierParty', [buildPartyNode(input.seller, 'seller')]))
  if (input.buyer) children.push(xmlElement('cac:AccountingCustomerParty', [buildPartyNode(input.buyer, 'buyer')]))

  children.push(
    xmlElement('cac:TaxTotal', [
      xmlText('cbc:TaxAmount', amount(input.taxAmount), { currencyID: currencyCode }),
      ...input.lines.map((line) =>
        xmlElement('cac:TaxSubtotal', [
          xmlText('cbc:TaxableAmount', amount(line.lineExtensionAmount), { currencyID: currencyCode }),
          xmlText('cbc:TaxAmount', amount(line.taxAmount), { currencyID: currencyCode }),
          buildTaxCategoryNode(line),
        ]),
      ),
    ]),
  )
  if (currencyCode !== taxCurrencyCode) {
    children.push(
      xmlElement('cac:TaxTotal', [
        xmlText('cbc:TaxAmount', amount(input.taxAmount), { currencyID: taxCurrencyCode }),
      ]),
    )
  }

  const lineExtensionTotal = input.lines.reduce((sum, line) => sum + Number(line.lineExtensionAmount), 0)
  children.push(
    xmlElement('cac:LegalMonetaryTotal', [
      xmlText('cbc:LineExtensionAmount', amount(lineExtensionTotal), { currencyID: currencyCode }),
      xmlText('cbc:TaxExclusiveAmount', amount(input.taxExclusiveAmount), { currencyID: currencyCode }),
      xmlText('cbc:TaxInclusiveAmount', amount(input.taxInclusiveAmount), { currencyID: currencyCode }),
      xmlText('cbc:PayableAmount', amount(input.payableAmount), { currencyID: currencyCode }),
    ]),
  )

  for (const line of input.lines) children.push(buildLineNode(line, currencyCode))

  return xmlElement('Invoice', children)
}

export type ZatcaInvoiceDocument = {
  /** The document as it exists before the QR code and the signature are inserted. */
  preHashXml: string
  /** The invoice hash: `base64(hex(sha256(preHashXml)))`. */
  invoiceHash: string
}

/**
 * Hashes the invoice without needing the QR code, which is what breaks the circle:
 * the QR contains the hash, so the hash has to exist first. Run this, build the QR
 * from the resulting hash, then call `buildZatcaInvoiceXml` with the payload.
 */
export function buildZatcaInvoiceDocument(input: ZatcaInvoiceInput): ZatcaInvoiceDocument {
  const preHashXml = serializeCanonicalXml(
    buildInvoiceNode(input, { includeQrAndSignature: false }),
    UBL_NAMESPACES,
  )
  return { preHashXml, invoiceHash: computeInvoiceHash(preHashXml) }
}

/**
 * The invoice as it is sent to ZATCA. For a standard (B2B) invoice, that is the
 * document-minus-signature until Phase 2 onboarding exists; for a simplified
 * invoice the QR code — which carries the hash — is added here.
 */
export function buildZatcaInvoiceXml(
  input: ZatcaInvoiceInput,
  options: { qrPayload?: string | null } = {},
): string {
  return serializeCanonicalXml(
    buildInvoiceNode(input, { includeQrAndSignature: true, qrPayload: options.qrPayload }),
    UBL_NAMESPACES,
  )
}
