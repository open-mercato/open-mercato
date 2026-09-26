import {
  ZATCA_DEFAULT_ZERO_TAX_CATEGORY,
  ZATCA_DEFAULT_ZERO_TAX_EXEMPTION_CODE,
  buildZatcaInvoiceInputFromOrder,
  buildZatcaOrderInvoice,
  resolveLineTaxCategory,
  toZatcaInvoiceLine,
  toZatcaSellerParty,
  type ZatcaOrderSource,
} from '../order-invoice'
import { computeInvoiceHash } from '../hash'
import { ZatcaInvoiceError } from '../ubl'
import type { SaudiVatSettings } from '../../vat-settings'

const settings: SaudiVatSettings = {
  sellerName: 'Riyadh Trading Company',
  vatRegistrationNumber: '310122393500003',
  commercialRegistrationNumber: '1010101010',
  vatRate: 0.15,
  invoiceQrEnabled: true,
}

function order(overrides: Partial<ZatcaOrderSource> = {}): ZatcaOrderSource {
  return {
    orderNumber: 'SO-2026-0001',
    placedAt: '2026-01-31T09:15:00.000Z',
    currencyCode: 'SAR',
    taxTotalAmount: '15.0000',
    grandTotalGrossAmount: '115.0000',
    lines: [
      {
        lineNumber: 1,
        name: 'Office chair',
        quantity: '2',
        quantityUnit: 'PCE',
        uomSnapshot: { enteredUnitCode: 'PCE', baseUnitCode: 'PCE' },
        unitPriceNet: '50.0000',
        taxRate: '15',
        taxAmount: '15.0000',
        totalNetAmount: '100.0000',
      },
    ],
    ...overrides,
  }
}

const untaxedLine = { taxRate: '0', unitPriceNet: '0', quantity: '1', taxAmount: '0', totalNetAmount: '0' }

const request = (overrides: Partial<Parameters<typeof buildZatcaInvoiceInputFromOrder>[0]> = {}) => ({
  order: order(),
  settings,
  icv: 1,
  uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
  ...overrides,
})

describe('order to ZATCA invoice mapping', () => {
  it('maps a taxed line as standard rated and totals the order', () => {
    const input = buildZatcaInvoiceInputFromOrder(request())

    expect(input.lines).toHaveLength(1)
    expect(input.lines[0]).toMatchObject({
      id: '1',
      taxCategoryCode: 'S',
      taxExemptionReasonCode: null,
      quantity: '2.00',
      unitCode: 'PCE',
      lineExtensionAmount: '100.00',
      taxAmount: '15.00',
      taxPercent: '15.00',
      unitPrice: '50.00',
      itemName: 'Office chair',
    })
    expect(input).toMatchObject({
      invoiceNumber: 'SO-2026-0001',
      currencyCode: 'SAR',
      taxCurrencyCode: 'SAR',
      taxAmount: '15.00',
      taxExclusiveAmount: '100.00',
      taxInclusiveAmount: '115.00',
      payableAmount: '115.00',
      subtype: 'simplified',
      documentKind: 'invoice',
      isExport: false,
    })
  })

  it('classifies an untaxed line without an exemption code as out of scope', () => {
    expect(resolveLineTaxCategory(untaxedLine)).toEqual({
      code: ZATCA_DEFAULT_ZERO_TAX_CATEGORY,
      exemptionReasonCode: ZATCA_DEFAULT_ZERO_TAX_EXEMPTION_CODE,
    })
  })

  it('classifies zero-rated and exempt lines from the ZATCA exemption codes', () => {
    expect(resolveLineTaxCategory({ ...untaxedLine, metadata: { zatcaExemptionReasonCode: 'VATEX-SA-32' } })).toEqual({
      code: 'Z',
      exemptionReasonCode: 'VATEX-SA-32',
    })
    expect(resolveLineTaxCategory({ ...untaxedLine, metadata: { zatcaExemptionReasonCode: 'VATEX-SA-29' } })).toEqual({
      code: 'E',
      exemptionReasonCode: 'VATEX-SA-29',
    })
    expect(resolveLineTaxCategory({ ...untaxedLine, metadata: { zatcaExemptionReasonCode: 'VATEX-SA-EDU' } })).toEqual({
      code: 'Z',
      exemptionReasonCode: 'VATEX-SA-EDU',
    })
  })

  it('carries an unrecognized exemption code through rather than dropping the reason', () => {
    expect(resolveLineTaxCategory({ ...untaxedLine, metadata: { zatcaExemptionReasonCode: 'VATEX-SA-99' } })).toEqual({
      code: ZATCA_DEFAULT_ZERO_TAX_CATEGORY,
      exemptionReasonCode: 'VATEX-SA-99',
    })
  })

  it('falls back to the base unit code and generates a missing item name', () => {
    const line = toZatcaInvoiceLine(
      {
        lineNumber: 4,
        name: '   ',
        quantity: '1',
        uomSnapshot: { baseUnitCode: 'KGM' },
        unitPriceNet: '10',
        taxRate: '15',
        taxAmount: '1.5',
        totalNetAmount: '10',
      },
      0,
    )

    expect(line.unitCode).toBe('KGM')
    expect(line.itemName).toBe('Item 4')
  })

  it('uses defaults when a line has neither a unit code nor a name', () => {
    const line = toZatcaInvoiceLine(
      { quantity: '1', unitPriceNet: '10', taxRate: '15', taxAmount: '1.5', totalNetAmount: '10' },
      0,
    )

    expect(line.unitCode).toBe('PCE')
    expect(line.itemName).toBe('Item 1')
  })

  it('builds the seller party from the VAT settings, with the CRN when present', () => {
    expect(toZatcaSellerParty(settings)).toMatchObject({
      name: 'Riyadh Trading Company',
      vatNumber: '310122393500003',
      identificationNumber: '1010101010',
      identificationScheme: 'CRN',
      countryCode: 'SA',
    })
    expect(toZatcaSellerParty({ ...settings, commercialRegistrationNumber: null })).toMatchObject({
      identificationNumber: null,
      identificationScheme: null,
    })
  })

  it('refuses to invoice with incomplete Saudi VAT settings', () => {
    expect(() => toZatcaSellerParty({ ...settings, sellerName: ' ' })).toThrow(ZatcaInvoiceError)
    expect(() => toZatcaSellerParty({ ...settings, vatRegistrationNumber: '123' })).toThrow(ZatcaInvoiceError)
  })

  it('refuses an order without lines or without any timestamp', () => {
    expect(() => buildZatcaInvoiceInputFromOrder(request({ order: order({ lines: [] }) }))).toThrow(ZatcaInvoiceError)
    expect(() =>
      buildZatcaInvoiceInputFromOrder(request({ order: order({ placedAt: null, createdAt: null }) })),
    ).toThrow(ZatcaInvoiceError)
  })

  it('falls back to the creation timestamp when an order was never placed', () => {
    const input = buildZatcaInvoiceInputFromOrder(
      request({ order: order({ placedAt: null, createdAt: '2026-02-02T06:00:00.000Z' }) }),
    )

    expect(String(input.issuedAt).startsWith('2026-02-02')).toBe(true)
  })

  it('marks a cross-border order as an export', () => {
    const input = buildZatcaInvoiceInputFromOrder(
      request({
        buyer: { name: 'Gulf Imports LLC', vatNumber: '100000000000003', countryCode: 'AE' },
        subtype: 'standard',
      }),
    )

    expect(input.isExport).toBe(true)
  })

  it('produces a document, a hash and a QR payload that agree with each other', () => {
    const invoice = buildZatcaOrderInvoice(request())

    expect(invoice.document.preHashXml).not.toContain('<cbc:ID>QR</cbc:ID>')
    expect(invoice.xml).toContain(invoice.qrPayload)
    expect(invoice.document.invoiceHash).toMatch(/^[A-Za-z0-9+/]{86}==$/)
    expect(invoice.xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">115.00</cbc:TaxInclusiveAmount>')
    expect(invoice.xml).toContain('Riyadh Trading Company')
    expect(computeInvoiceHash(invoice.document.preHashXml)).toBe(invoice.document.invoiceHash)
  })

  it('keeps the same hash for the same order, whatever the QR payload turns out to be', () => {
    const first = buildZatcaOrderInvoice(request())
    const second = buildZatcaOrderInvoice(request())

    expect(second.qrPayload).toBe(first.qrPayload)
    expect(second.document.invoiceHash).toBe(first.document.invoiceHash)
    expect(second.xml).toBe(first.xml)
  })
})
