import type { RenderedDocument } from '../../../lib/interfaces'
import { documentResponse } from '../document-response'

function makeDocument(overrides: Partial<RenderedDocument> = {}): RenderedDocument {
  return {
    buffer: Uint8Array.from([1, 2, 3]),
    filename: 'invoice-Żółć.pdf',
    format: 'pdf',
    mimeType: 'application/pdf',
    template: { id: 'sample-report', label: 'Sample Report' },
    resource: { kind: 'example.record', id: 'record-1', label: 'RECORD-1' },
    ...overrides,
  }
}

describe('documentResponse', () => {
  it('uses the rendered MIME type and an encoded download filename', () => {
    const response = documentResponse(makeDocument())

    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''invoice-%C5%BB%C3%B3%C5%82%C4%87.pdf")
  })

  it('removes control characters and quotes from the fallback filename', () => {
    const response = documentResponse(makeDocument({ filename: 'invoice\r\n"42".pdf' }))

    expect(response.headers.get('content-disposition')).toContain('filename="invoice___42_.pdf"')
  })
})
