/**
 * The invoice document and, more importantly, the two invariants ZATCA's hash chain
 * depends on: the pre-hash projection must exclude the QR code and the signature, and
 * it must include everything that identifies the invoice.
 */
import { INITIAL_PREVIOUS_INVOICE_HASH, computeInvoiceHash } from '../hash'
import {
  ZATCA_DOCUMENT_TYPE_CODE,
  ZatcaInvoiceError,
  buildInvoiceTransactionCode,
  buildZatcaInvoiceDocument,
  buildZatcaInvoiceXml,
  type ZatcaInvoiceInput,
} from '../ubl'

const seller = {
  name: 'Riyadh Trading Company',
  vatNumber: '310122393500003',
  identificationNumber: '1010101010',
  identificationScheme: 'CRN',
  streetName: 'King Fahd Road',
  buildingNumber: '1234',
  citySubdivisionName: 'Al Olaya',
  cityName: 'Riyadh',
  postalZone: '12212',
  countryCode: 'SA',
}

const buyer = {
  name: 'Al Noor Trading Co.',
  vatNumber: '311111111100003',
  streetName: 'Prince Sultan Road',
  buildingNumber: '4321',
  cityName: 'Jeddah',
  postalZone: '21442',
  countryCode: 'SA',
}

function invoiceInput(overrides: Partial<ZatcaInvoiceInput> = {}): ZatcaInvoiceInput {
  return {
    invoiceNumber: 'INV-2026-0001',
    uuid: '3cf5ee18-ee25-44ea-a444-2c37ba7f28be',
    issuedAt: '2026-01-31T09:15:00.000Z',
    subtype: 'standard',
    documentKind: 'invoice',
    currencyCode: 'SAR',
    taxCurrencyCode: 'SAR',
    icv: 1,
    seller,
    buyer,
    lines: [
      {
        id: '1',
        quantity: '2',
        unitCode: 'PCE',
        lineExtensionAmount: '100.00',
        taxAmount: '15.00',
        taxCategoryCode: 'S',
        taxPercent: '15',
        itemName: 'Office chair',
        itemCode: 'CH-100',
        unitPrice: '50.00',
      },
    ],
    taxAmount: '15.00',
    taxExclusiveAmount: '100.00',
    taxInclusiveAmount: '115.00',
    payableAmount: '115.00',
    ...overrides,
  }
}

/** Removes the two blocks the reference pre-hash transform removes, by their XML shape. */
function stripQrAndSignature(xml: string): string {
  return xml
    .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>.*?<\/cac:AdditionalDocumentReference>/, '')
    .replace(/<cac:Signature>.*?<\/cac:Signature>/, '')
}

describe('ZATCA invoice XML', () => {
  it('writes the header in the order the business rules require', () => {
    const xml = buildZatcaInvoiceXml(invoiceInput())

    const order = ['cbc:ProfileID', 'cbc:ID', 'cbc:UUID', 'cbc:IssueDate', 'cbc:IssueTime', 'cbc:InvoiceTypeCode']
    const positions = order.map((tag) => xml.indexOf(`<${tag}`))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(positions)
    expect(xml).toContain('<cbc:UUID>3cf5ee18-ee25-44ea-a444-2c37ba7f28be</cbc:UUID>')
  })

  it('carries the counter and the previous hash as document references', () => {
    const previousInvoiceHash = computeInvoiceHash('<Invoice>previous</Invoice>')
    const xml = buildZatcaInvoiceXml(invoiceInput({ icv: 12, previousInvoiceHash }))

    expect(xml).toContain('<cbc:ID>ICV</cbc:ID><cbc:UUID>12</cbc:UUID>')
    expect(xml).toContain(
      `<cbc:ID>PIH</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previousInvoiceHash}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment>`,
    )
  })

  it('falls back to the chain-start hash for a first invoice', () => {
    expect(buildZatcaInvoiceXml(invoiceInput())).toContain(INITIAL_PREVIOUS_INVOICE_HASH)
  })

  it('uses the transaction code from KSA-2 to mark the invoice subtype', () => {
    expect(buildInvoiceTransactionCode('standard')).toBe('0100000')
    expect(buildInvoiceTransactionCode('simplified')).toBe('0200000')
    expect(buildInvoiceTransactionCode('standard', true)).toBe('0100100')
    expect(buildInvoiceTransactionCode('simplified', true)).toBe('0200000')
  })

  it('writes the transaction code into the InvoiceTypeCode name attribute', () => {
    expect(buildZatcaInvoiceXml(invoiceInput())).toContain(
      `<cbc:InvoiceTypeCode name="0100000">${ZATCA_DOCUMENT_TYPE_CODE.invoice}</cbc:InvoiceTypeCode>`,
    )
    expect(buildZatcaInvoiceXml(invoiceInput({ documentKind: 'credit_note' }))).toContain(
      `<cbc:InvoiceTypeCode name="0100000">${ZATCA_DOCUMENT_TYPE_CODE.credit_note}</cbc:InvoiceTypeCode>`,
    )
  })

  it('adds the QR code and the signature block to simplified invoices only', () => {
    const simplified = buildZatcaInvoiceXml(invoiceInput({ subtype: 'simplified' }), { qrPayload: 'AQRBQ01F' })
    const standard = buildZatcaInvoiceXml(invoiceInput())

    expect(simplified).toContain('<cbc:ID>QR</cbc:ID>')
    expect(simplified).toContain('<cac:Signature>')
    expect(simplified).toContain('urn:oasis:names:specification:ubl:dsig:enveloped:xades')
    expect(standard).not.toContain('<cbc:ID>QR</cbc:ID>')
    expect(standard).not.toContain('<cac:Signature>')
  })

  it('requires a QR payload for a simplified invoice but not for a standard one', () => {
    expect(() => buildZatcaInvoiceXml(invoiceInput({ subtype: 'simplified' }))).toThrow(ZatcaInvoiceError)
    expect(() => buildZatcaInvoiceDocument(invoiceInput({ subtype: 'simplified' }))).not.toThrow()
  })

  it('refuses an invoice without lines', () => {
    expect(() => buildZatcaInvoiceXml(invoiceInput({ lines: [] }))).toThrow(ZatcaInvoiceError)
  })

  it('omits the customer party for a cash sale', () => {
    expect(buildZatcaInvoiceXml(invoiceInput({ buyer: null }))).not.toContain('cac:AccountingCustomerParty')
  })

  it('formats amounts with two decimals and the currency on the amount itself', () => {
    const xml = buildZatcaInvoiceXml(invoiceInput())

    expect(xml).toContain('<cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount>')
    expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="SAR">115.00</cbc:TaxInclusiveAmount>')
    expect(xml).toContain('<cbc:Percent>15.00</cbc:Percent>')
  })

  it('adds a second tax total when the invoice currency differs from the tax currency', () => {
    const xml = buildZatcaInvoiceXml(invoiceInput({ currencyCode: 'USD' }))

    expect(xml.match(/<cac:TaxTotal>/g)).toHaveLength(3)
    expect(xml).toContain('<cbc:TaxAmount currencyID="SAR">15.00</cbc:TaxAmount>')
    expect(xml).toContain('<cbc:PayableAmount currencyID="USD">115.00</cbc:PayableAmount>')
  })

  it('writes an Arabic seller name and its punctuation through the escaper untouched', () => {
    const xml = buildZatcaInvoiceXml(
      invoiceInput({ seller: { ...seller, name: 'شركة الرياض للتجارة “وشركاه”' } }),
    )

    expect(xml).toContain('<cbc:RegistrationName>شركة الرياض للتجارة “وشركاه”</cbc:RegistrationName>')
  })

  it('emits only canonical XML: no declaration, no comments, no self-closing tags', () => {
    const xml = buildZatcaInvoiceXml(invoiceInput())

    expect(xml.startsWith('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"')).toBe(true)
    expect(xml).not.toContain('<?xml')
    expect(xml).not.toContain('<!--')
    expect(xml).not.toContain('/>')
  })
})

describe('ZATCA invoice hash', () => {
  it('does not move when the QR code changes, because the QR carries the hash', () => {
    const input = invoiceInput({ subtype: 'simplified' })
    const document = buildZatcaInvoiceDocument(input)
    const firstFinal = buildZatcaInvoiceXml(input, { qrPayload: 'AQRBQ01F' })
    const secondFinal = buildZatcaInvoiceXml(input, { qrPayload: 'AAAAAAAA' })

    expect(firstFinal).not.toBe(secondFinal)
    expect(document.preHashXml).not.toContain('<cbc:ID>QR</cbc:ID>')
    expect(document.preHashXml).not.toContain('<cac:Signature>')
    expect(document.preHashXml).not.toContain('UBLExtensions')
  })

  it('projects the final document back to exactly the hashed content', () => {
    const input = invoiceInput({ subtype: 'simplified' })
    const document = buildZatcaInvoiceDocument(input)
    const finalXml = buildZatcaInvoiceXml(input, { qrPayload: 'AQRBQ01F' })

    expect(finalXml).toContain('AQRBQ01F')
    expect(computeInvoiceHash(finalXml)).not.toBe(document.invoiceHash)
    expect(computeInvoiceHash(stripQrAndSignature(finalXml))).toBe(document.invoiceHash)
  })

  it('equals the hash of the final document for a standard invoice, which has no QR or signature', () => {
    const input = invoiceInput()

    expect(computeInvoiceHash(buildZatcaInvoiceXml(input))).toBe(buildZatcaInvoiceDocument(input).invoiceHash)
  })

  it('moves when the counter value changes', () => {
    expect(buildZatcaInvoiceDocument(invoiceInput({ icv: 1 })).invoiceHash).not.toBe(
      buildZatcaInvoiceDocument(invoiceInput({ icv: 2 })).invoiceHash,
    )
  })

  it('moves when the previous invoice hash changes, which is what links the chain', () => {
    expect(buildZatcaInvoiceDocument(invoiceInput()).invoiceHash).not.toBe(
      buildZatcaInvoiceDocument(
        invoiceInput({ previousInvoiceHash: computeInvoiceHash('<Invoice>previous</Invoice>') }),
      ).invoiceHash,
    )
  })

  it('moves when any amount on a line changes', () => {
    expect(buildZatcaInvoiceDocument(invoiceInput()).invoiceHash).not.toBe(
      buildZatcaInvoiceDocument(invoiceInput({ lines: [{ ...invoiceInput().lines[0], taxAmount: '14.99' }] }))
        .invoiceHash,
    )
  })
})
