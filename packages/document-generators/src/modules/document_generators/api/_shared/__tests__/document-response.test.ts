import { buildContentDisposition, documentResponse } from '../document-response'

describe('buildContentDisposition', () => {
  it('uses the same name for ASCII filenames', () => {
    expect(buildContentDisposition('invoice-FV-2026-01.pdf')).toBe(
      `attachment; filename="invoice-FV-2026-01.pdf"; filename*=UTF-8''invoice-FV-2026-01.pdf`,
    )
  })

  it('replaces non-ASCII, quotes and backslashes in the fallback and RFC 5987 encodes the original', () => {
    const header = buildContentDisposition('faktura-zażółć "x".pdf')
    expect(header).toBe(
      `attachment; filename="faktura-za____ _x_.pdf"; filename*=UTF-8''faktura-za%C5%BC%C3%B3%C5%82%C4%87%20%22x%22.pdf`,
    )
  })

  it('escapes RFC 5987 reserved characters and control characters', () => {
    const header = buildContentDisposition("a'b(c)d*e\\f\nname.md")
    expect(header).toContain('filename="a\'b(c)d*e_f_name.md"')
    expect(header).toContain("filename*=UTF-8''a%27b%28c%29d%2Ae%5Cf%0Aname.md")
  })
})

describe('documentResponse', () => {
  it('sends bytes with no-store, nosniff and attachment headers', async () => {
    const response = documentResponse({
      buffer: new Uint8Array([1, 2, 3]),
      filename: 'offer.pdf',
      mimeType: 'application/pdf',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="offer.pdf"; filename*=UTF-8''offer.pdf`)
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3])
  })

  it('passes the Markdown MIME type through', () => {
    const response = documentResponse({
      buffer: new TextEncoder().encode('# Hi'),
      filename: 'offer.md',
      mimeType: 'text/markdown; charset=utf-8',
    })
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
  })
})
