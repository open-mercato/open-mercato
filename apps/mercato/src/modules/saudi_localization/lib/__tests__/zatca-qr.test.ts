import {
  ZATCA_QR_TAG,
  ZatcaQrError,
  buildZatcaQrPayload,
  buildZatcaQrTags,
  encodeBase64,
  encodeZatcaQrTlv,
} from '../zatca/qr'

const INVOICE = {
  sellerName: 'Apex Trading Est.',
  vatRegistrationNumber: '300000000000003',
  issuedAt: '2026-01-31T09:15:00Z',
  invoiceTotalWithVat: 115,
  vatTotal: '15.00',
}

const utf8Bytes = (value: string) => Array.from(new TextEncoder().encode(value))

/** Independent TLV writer: pins the encoding rule, not the implementation. */
const tlv = (tag: number, value: string) => {
  const bytes = utf8Bytes(value)
  return [tag, bytes.length, ...bytes]
}

/** Independent TLV reader, written without touching the builder's code. */
function decodeTlv(bytes: Uint8Array): Array<{ tag: number; value: string }> {
  const decoder = new TextDecoder()
  const entries: Array<{ tag: number; value: string }> = []
  let offset = 0
  while (offset < bytes.length) {
    const tag = bytes[offset]
    const length = bytes[offset + 1]
    entries.push({ tag, value: decoder.decode(bytes.slice(offset + 2, offset + 2 + length)) })
    offset += 2 + length
  }
  return entries
}

describe('buildZatcaQrTags', () => {
  it('emits the five Phase 1 tags in ZATCA order', () => {
    const tags = buildZatcaQrTags(INVOICE)

    expect(tags).toEqual([
      { tag: ZATCA_QR_TAG.sellerName, value: 'Apex Trading Est.' },
      { tag: ZATCA_QR_TAG.vatRegistrationNumber, value: '300000000000003' },
      { tag: ZATCA_QR_TAG.issuedAt, value: '2026-01-31T09:15:00Z' },
      { tag: ZATCA_QR_TAG.invoiceTotalWithVat, value: '115.00' },
      { tag: ZATCA_QR_TAG.vatTotal, value: '15.00' },
    ])
    expect(tags.map((entry) => entry.tag)).toEqual([1, 2, 3, 4, 5])
  })

  it('normalizes a Date to ISO 8601', () => {
    const tags = buildZatcaQrTags({ ...INVOICE, issuedAt: new Date('2026-01-31T12:15:00+03:00') })

    expect(tags[2].value).toBe('2026-01-31T09:15:00.000Z')
  })

  it('trims the seller name and the VAT number', () => {
    const tags = buildZatcaQrTags({ ...INVOICE, sellerName: '  Apex Trading Est.  ' })

    expect(tags[0].value).toBe('Apex Trading Est.')
  })

  it('carries an Arabic seller name through unchanged', () => {
    const tags = buildZatcaQrTags({ ...INVOICE, sellerName: 'مؤسسة القمة التجارية' })

    expect(tags[0].value).toBe('مؤسسة القمة التجارية')
  })

  const rejectedCases: Array<[string, Partial<typeof INVOICE>, string]> = [
    ['an empty seller name', { sellerName: '   ' }, 'invalid_seller_name'],
    ['a short VAT number', { vatRegistrationNumber: '30000000000000' }, 'invalid_vat_number'],
    ['a date-only timestamp', { issuedAt: '2026-01-31' }, 'invalid_timestamp'],
    ['a negative total', { invoiceTotalWithVat: -1 }, 'invalid_amount'],
    ['a grouped VAT total', { vatTotal: '1,000.00' }, 'invalid_amount'],
  ]

  it.each(rejectedCases)('rejects %s', (_label, patch, code) => {
    expect.assertions(2)
    try {
      buildZatcaQrTags({ ...INVOICE, ...patch })
    } catch (error) {
      expect(error).toBeInstanceOf(ZatcaQrError)
      expect((error as ZatcaQrError).code).toBe(code)
    }
  })
})

describe('encodeZatcaQrTlv', () => {
  it('writes one tag byte, one length byte and the UTF-8 value', () => {
    const bytes = encodeZatcaQrTlv([{ tag: 1, value: 'ACME' }])

    expect(Array.from(bytes)).toEqual([1, 4, 0x41, 0x43, 0x4d, 0x45])
  })

  it('measures an Arabic value in UTF-8 bytes rather than characters', () => {
    const sellerName = 'شركة الاختبار'
    const bytes = encodeZatcaQrTlv([{ tag: 1, value: sellerName }])

    expect(bytes[1]).toBe(Buffer.byteLength(sellerName, 'utf8'))
    expect(bytes[1]).toBeGreaterThan(sellerName.length)
  })

  it('rejects a value that exceeds the 255-byte TLV limit', () => {
    expect(() => encodeZatcaQrTlv([{ tag: 1, value: 'ا'.repeat(128) }])).toThrow(ZatcaQrError)
  })

  it('rejects an empty value and an out-of-range tag', () => {
    expect(() => encodeZatcaQrTlv([{ tag: 1, value: '' }])).toThrow(ZatcaQrError)
    expect(() => encodeZatcaQrTlv([{ tag: 256, value: 'x' }])).toThrow(ZatcaQrError)
  })
})

describe('buildZatcaQrPayload', () => {
  it('matches a hand-built TLV vector and the platform Base64 encoder', () => {
    const expectedBytes = new Uint8Array([
      ...tlv(1, 'Apex Trading Est.'),
      ...tlv(2, '300000000000003'),
      ...tlv(3, '2026-01-31T09:15:00Z'),
      ...tlv(4, '115.00'),
      ...tlv(5, '15.00'),
    ])

    const payload = buildZatcaQrPayload(INVOICE)

    expect(Array.from(encodeZatcaQrTlv(buildZatcaQrTags(INVOICE)))).toEqual(Array.from(expectedBytes))
    expect(payload).toBe(Buffer.from(expectedBytes).toString('base64'))
  })

  it('round-trips through an independent TLV reader', () => {
    const payload = buildZatcaQrPayload(INVOICE)
    const bytes = new Uint8Array(Buffer.from(payload, 'base64'))

    expect(decodeTlv(bytes)).toEqual([
      { tag: 1, value: 'Apex Trading Est.' },
      { tag: 2, value: '300000000000003' },
      { tag: 3, value: '2026-01-31T09:15:00Z' },
      { tag: 4, value: '115.00' },
      { tag: 5, value: '15.00' },
    ])
  })

  it('produces a Base64 payload a QR encoder can read, at every padding length', () => {
    for (const length of [1, 2, 3, 4, 5, 6, 7]) {
      const bytes = new Uint8Array(Array.from({ length }, (_, index) => index + 1))

      expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    }
  })

  it('encodes a UTF-8 seller name exactly once', () => {
    const payload = buildZatcaQrPayload({ ...INVOICE, sellerName: 'شركة القمة' })
    const decoded = decodeTlv(new Uint8Array(Buffer.from(payload, 'base64')))

    expect(decoded[0]).toEqual({ tag: 1, value: 'شركة القمة' })
  })
})
