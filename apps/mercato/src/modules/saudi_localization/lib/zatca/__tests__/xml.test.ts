import { CanonicalXmlError, serializeCanonicalXml, xmlElement, xmlText } from '../xml'

describe('canonical XML writer', () => {
  it('declares namespaces on the root, default first and prefixes in order', () => {
    const xml = serializeCanonicalXml(xmlElement('Invoice', [xmlText('cbc:ID', 'INV-1')]), {
      cbc: 'urn:cbc',
      '': 'urn:invoice',
      cac: 'urn:cac',
    })

    expect(xml.startsWith('<Invoice xmlns="urn:invoice" xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">')).toBe(true)
    expect(xml.endsWith('</Invoice>')).toBe(true)
  })

  it('sorts attributes, normalizes their whitespace and never self-closes elements', () => {
    const xml = serializeCanonicalXml(
      xmlElement('Invoice', [
        xmlText('cbc:InvoicedQuantity', '2.00', { unitCode: 'PCE', currencyID: 'SAR' }),
        xmlElement('cac:Empty'),
      ]),
    )

    expect(xml).toContain('<cbc:InvoicedQuantity currencyID="SAR" unitCode="PCE">2.00</cbc:InvoicedQuantity>')
    expect(xml).toContain('<cac:Empty></cac:Empty>')
    expect(xml).not.toContain('/>')
  })

  it('collapses tabs and newlines in attribute values the way a parser would', () => {
    const xml = serializeCanonicalXml(xmlElement('cbc:ID', [], { schemeID: 'TIN\t\n value' }))

    expect(xml).toBe('<cbc:ID schemeID="TIN   value"></cbc:ID>')
  })

  it('escapes text and attribute values, including carriage returns', () => {
    const xml = serializeCanonicalXml(
      xmlElement('cac:Item', [xmlText('cbc:Name', 'Tom & Jerry <"1">'), xmlText('cbc:Note', 'a\rb')]),
    )

    expect(xml).toContain('<cbc:Name>Tom &amp; Jerry &lt;"1"&gt;</cbc:Name>')
    expect(xml).toContain('<cbc:Note>a&#xD;b</cbc:Note>')
  })

  it('escapes quotes in attributes but not in text', () => {
    const xml = serializeCanonicalXml(xmlElement('cbc:ID', [], { schemeID: 'a"b' }))

    expect(xml).toBe('<cbc:ID schemeID="a&quot;b"></cbc:ID>')
  })

  it('omits attributes whose value is null or undefined', () => {
    const xml = serializeCanonicalXml(xmlElement('cbc:ID', [], { schemeID: null, currencyID: undefined }))

    expect(xml).toBe('<cbc:ID></cbc:ID>')
  })

  it('rejects prefixed attributes because canonical ordering would become ambiguous', () => {
    expect(() => serializeCanonicalXml(xmlElement('cbc:ID', [], { 'cbc:currencyID': 'SAR' }))).toThrow(
      CanonicalXmlError,
    )
  })

  it('rejects element names that could carry markup', () => {
    expect(() => xmlElement('cbc:ID><evil', [])).toThrow(CanonicalXmlError)
  })

  it('rejects an empty namespace URI', () => {
    expect(() => serializeCanonicalXml(xmlElement('Invoice', []), { cbc: '  ' })).toThrow(CanonicalXmlError)
  })

  it('rejects an invalid namespace prefix', () => {
    expect(() => serializeCanonicalXml(xmlElement('Invoice', []), { 'cb c': 'urn:cbc' })).toThrow(
      CanonicalXmlError,
    )
  })

  it('emits no XML declaration, comments or indentation', () => {
    const xml = serializeCanonicalXml(xmlElement('Invoice', [xmlText('cbc:ID', 'INV-1')]))

    expect(xml).toBe('<Invoice><cbc:ID>INV-1</cbc:ID></Invoice>')
  })
})
