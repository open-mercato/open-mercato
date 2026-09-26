import { formatSaudDecimal, isValidSaudiVatNumber } from '../saudi/vat'
import type { SaudiVatSettings } from '../vat-settings'
import { buildZatcaQrPayload } from './qr'
import {
  ZatcaInvoiceError,
  buildZatcaInvoiceDocument,
  buildZatcaInvoiceXml,
  type ZatcaDocumentKind,
  type ZatcaInvoiceDocument,
  type ZatcaInvoiceInput,
  type ZatcaInvoiceLine,
  type ZatcaInvoiceSubtype,
  type ZatcaParty,
} from './ubl'

/**
 * Maps a sales order into the ZATCA invoice shape.
 *
 * The mapping is where compliance actually gets decided — which VAT category a line
 * belongs to, which unit code is printed, which timestamp is the issue time — so it
 * lives in one pure function that can be read top to bottom and tested against real
 * order fixtures rather than inside an API handler.
 *
 * Two things are deliberately not invented here:
 *
 *   - the **issue timestamp** is the order's `placedAt` (its invoice-relevant moment),
 *     falling back to `createdAt`; a reprint must not silently move it;
 *   - the **VAT category** of a zero-tax line. A line that carries tax is `S`. A line
 *     without tax is only `Z` (zero-rated) or `E` (exempt) when the order says which
 *     exemption applies — using the ZATCA exemption list — and is otherwise `O` (out of
 *     scope) with `VATEX-SA-OOS`. Guessing `Z` for every untaxed line would misreport
 *     domestic exemptions, which is a filing error, not a bug.
 */

export type ZatcaOrderLineSource = {
  lineNumber?: number | null
  name?: string | null
  quantity: string | number
  quantityUnit?: string | null
  uomSnapshot?: { enteredUnitCode?: string | null; baseUnitCode?: string | null } | null
  unitPriceNet: string | number
  taxRate: string | number
  taxAmount: string | number
  totalNetAmount: string | number
  metadata?: Record<string, unknown> | null
}

export type ZatcaOrderSource = {
  orderNumber: string
  placedAt?: Date | string | null
  createdAt?: Date | string | null
  currencyCode: string
  taxTotalAmount: string | number
  grandTotalGrossAmount: string | number
  lines: readonly ZatcaOrderLineSource[]
}

/** ZATCA exemption codes that mean zero-rated rather than exempt. */
export const ZATCA_ZERO_RATE_EXEMPTION_CODES = [
  'VATEX-SA-32',
  'VATEX-SA-33',
  'VATEX-SA-34-1',
  'VATEX-SA-34-2',
  'VATEX-SA-34-3',
  'VATEX-SA-34-4',
  'VATEX-SA-34-5',
  'VATEX-SA-35',
  'VATEX-SA-36',
  'VATEX-SA-EDU',
  'VATEX-SA-HEA',
] as const

/** ZATCA exemption codes that mean exempt. */
export const ZATCA_EXEMPT_EXEMPTION_CODES = ['VATEX-SA-29', 'VATEX-SA-29-7', 'VATEX-SA-30'] as const

/** Category and reason used when a line carries no tax and the order says no more. */
export const ZATCA_DEFAULT_ZERO_TAX_CATEGORY = 'O'
export const ZATCA_DEFAULT_ZERO_TAX_EXEMPTION_CODE = 'VATEX-SA-OOS'

export const ZATCA_DEFAULT_UNIT_CODE = 'PCE'

const EXEMPTION_CODE_METADATA_KEY = 'zatcaExemptionReasonCode'

function toDecimal(value: string | number): string {
  return formatSaudDecimal(value)
}

function readExemptionCode(line: ZatcaOrderLineSource): string | null {
  const fromMetadata = line.metadata?.[EXEMPTION_CODE_METADATA_KEY]
  if (typeof fromMetadata === 'string' && fromMetadata.trim()) return fromMetadata.trim()
  return null
}

/** The ZATCA category and exemption reason a line belongs to. */
export function resolveLineTaxCategory(line: ZatcaOrderLineSource): {
  code: string
  exemptionReasonCode: string | null
} {
  const rate = Number(line.taxRate)
  if (Number.isFinite(rate) && rate > 0) return { code: 'S', exemptionReasonCode: null }

  const exemptionCode = readExemptionCode(line)
  if (!exemptionCode) {
    return { code: ZATCA_DEFAULT_ZERO_TAX_CATEGORY, exemptionReasonCode: ZATCA_DEFAULT_ZERO_TAX_EXEMPTION_CODE }
  }
  if ((ZATCA_ZERO_RATE_EXEMPTION_CODES as readonly string[]).includes(exemptionCode)) {
    return { code: 'Z', exemptionReasonCode: exemptionCode }
  }
  if ((ZATCA_EXEMPT_EXEMPTION_CODES as readonly string[]).includes(exemptionCode)) {
    return { code: 'E', exemptionReasonCode: exemptionCode }
  }
  return { code: ZATCA_DEFAULT_ZERO_TAX_CATEGORY, exemptionReasonCode: exemptionCode }
}

/** The seller party, built from the VAT settings the QR already reads. */
export function toZatcaSellerParty(settings: SaudiVatSettings): ZatcaParty {
  const sellerName = settings.sellerName.trim()
  if (!sellerName) {
    throw new ZatcaInvoiceError('missing_required_value', 'The seller name is required before an invoice can be built.')
  }
  if (!isValidSaudiVatNumber(settings.vatRegistrationNumber)) {
    throw new ZatcaInvoiceError(
      'missing_required_value',
      'A 15-digit VAT registration number is required before an invoice can be built.',
    )
  }
  const commercialRegistrationNumber = settings.commercialRegistrationNumber?.trim()
  return {
    name: sellerName,
    vatNumber: settings.vatRegistrationNumber.trim(),
    identificationNumber: commercialRegistrationNumber || null,
    identificationScheme: commercialRegistrationNumber ? 'CRN' : null,
    countryCode: 'SA',
  }
}

export function toZatcaInvoiceLine(line: ZatcaOrderLineSource, index: number): ZatcaInvoiceLine {
  const name = line.name?.trim()
  const unitCode =
    line.uomSnapshot?.enteredUnitCode?.trim() ||
    line.uomSnapshot?.baseUnitCode?.trim() ||
    line.quantityUnit?.trim() ||
    ZATCA_DEFAULT_UNIT_CODE
  const category = resolveLineTaxCategory(line)
  return {
    id: String(line.lineNumber ?? index + 1),
    quantity: toDecimal(line.quantity),
    unitCode,
    lineExtensionAmount: toDecimal(line.totalNetAmount),
    taxAmount: toDecimal(line.taxAmount),
    taxCategoryCode: category.code,
    taxPercent: toDecimal(line.taxRate),
    taxExemptionReasonCode: category.exemptionReasonCode,
    itemName: name && name.length > 0 ? name : `Item ${line.lineNumber ?? index + 1}`,
    unitPrice: toDecimal(line.unitPriceNet),
  }
}

function resolveIssuedAt(order: ZatcaOrderSource): Date | string {
  const candidate = order.placedAt ?? order.createdAt
  if (!candidate) {
    throw new ZatcaInvoiceError('invalid_timestamp', 'The order has no placement or creation timestamp to invoice.')
  }
  return candidate
}

export type ZatcaOrderInvoiceRequest = {
  order: ZatcaOrderSource
  settings: SaudiVatSettings
  /** Counter value from the chain: peek for a preview, allocate before issuing. */
  icv: number
  previousInvoiceHash?: string | null
  /** Invoice UUID; the order's own id is the stable choice. */
  uuid: string
  subtype?: ZatcaInvoiceSubtype
  documentKind?: ZatcaDocumentKind
  isExport?: boolean
  buyer?: ZatcaParty | null
  profileId?: string
}

export function buildZatcaInvoiceInputFromOrder(request: ZatcaOrderInvoiceRequest): ZatcaInvoiceInput {
  const { order } = request
  if (!order.lines || order.lines.length === 0) {
    throw new ZatcaInvoiceError('missing_lines', 'An order without lines cannot be turned into an invoice.')
  }
  const lines = order.lines.map((line, index) => toZatcaInvoiceLine(line, index))
  const taxExclusiveAmount = lines.reduce((sum, line) => sum + Number(line.lineExtensionAmount), 0)
  const taxAmount = lines.reduce((sum, line) => sum + Number(line.taxAmount), 0)
  return {
    invoiceNumber: order.orderNumber,
    uuid: request.uuid,
    issuedAt: resolveIssuedAt(order),
    subtype: request.subtype ?? 'simplified',
    documentKind: request.documentKind ?? 'invoice',
    isExport: request.isExport ?? (request.buyer ? request.buyer.countryCode !== 'SA' : false),
    currencyCode: order.currencyCode,
    taxCurrencyCode: 'SAR',
    icv: request.icv,
    previousInvoiceHash: request.previousInvoiceHash ?? null,
    seller: toZatcaSellerParty(request.settings),
    buyer: request.buyer ?? null,
    lines,
    taxAmount: toDecimal(taxAmount),
    taxExclusiveAmount: toDecimal(taxExclusiveAmount),
    taxInclusiveAmount: toDecimal(taxExclusiveAmount + taxAmount),
    payableAmount: toDecimal(order.grandTotalGrossAmount ?? taxExclusiveAmount + taxAmount),
    profileId: request.profileId,
  }
}

export type ZatcaOrderInvoice = {
  input: ZatcaInvoiceInput
  document: ZatcaInvoiceDocument
  /** Phase 1 TLV payload; Phase 2 tags 6-9 arrive with the cryptographic stamp. */
  qrPayload: string
  /** The invoice to send, with the QR code in place. */
  xml: string
}

/**
 * The whole document for one order: hash it, build the QR from the result, then emit
 * the invoice that QR belongs to. Pure — the caller owns the counter, the previous
 * hash and the timestamp.
 */
export function buildZatcaOrderInvoice(request: ZatcaOrderInvoiceRequest): ZatcaOrderInvoice {
  const input = buildZatcaInvoiceInputFromOrder(request)
  const document = buildZatcaInvoiceDocument(input)
  const issuedAt = resolveIssuedAt(request.order)
  const qrPayload = buildZatcaQrPayload({
    sellerName: request.settings.sellerName,
    vatRegistrationNumber: request.settings.vatRegistrationNumber,
    issuedAt,
    invoiceTotalWithVat: input.taxInclusiveAmount,
    vatTotal: input.taxAmount,
  })
  return { input, document, qrPayload, xml: buildZatcaInvoiceXml(input, { qrPayload }) }
}
