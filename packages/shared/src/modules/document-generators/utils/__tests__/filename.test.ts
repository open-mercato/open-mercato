import { buildDocumentFilename, sanitizeDocumentFilename } from '../filename'

describe('document filename helpers', () => {
  it('sanitizeDocumentFilename strips unsafe characters and leading dots', () => {
    expect(sanitizeDocumentFilename('..a/b:c')).toBe('a-b-c')
  })

  it('buildDocumentFilename combines prefix, document number and extension', () => {
    expect(buildDocumentFilename({ document: { number: 'FV/2026\n01' } }, 'invoice', 'pdf')).toBe('invoice-FV-2026-01.pdf')
    expect(buildDocumentFilename({}, 'offer', 'md')).toBe('offer.md')
    expect(() => buildDocumentFilename({}, 'offer', '../')).toThrow('extension')
  })
})
