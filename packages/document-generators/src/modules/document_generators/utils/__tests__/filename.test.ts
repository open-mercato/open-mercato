import { buildDocumentFilename } from '../filename'

describe('buildDocumentFilename', () => {
  it('includes the normalized document number', () => {
    expect(buildDocumentFilename(
      { document: { number: 'ORD-9' } },
      'invoice',
      'pdf',
    )).toBe('invoice-ORD-9.pdf')
  })

  it('falls back to the prefix and extension', () => {
    expect(buildDocumentFilename({}, 'invoice', 'md')).toBe('invoice.md')
  })
})
