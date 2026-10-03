import { buildDocumentFilename, escapeInline, escapeTableCell, formatDate, formatMoney, getFilenameFromResponse, resolveErrorMessage } from '..'

describe('document author utilities', () => {
  it('escapes Markdown structure, links, table cells and embedded HTML from source data', () => {
    expect(escapeInline('[link](https://example.test)')).toBe('\\[link\\]\\(https://example\\.test\\)')
    expect(escapeTableCell('| cell\n# heading <script>&')).toBe('\\| cell \\# heading &lt;script&gt;&amp;')
    expect(escapeInline(null)).toBe('')
  })

  it('uses server-normalized document numbers and makes path/control characters inert', () => {
    expect(buildDocumentFilename({ document: { number: 'FV/2026\n01' } }, 'invoice', 'pdf')).toBe('invoice-FV-2026-01.pdf')
    expect(buildDocumentFilename({}, 'offer', 'md')).toBe('offer.md')
    expect(() => buildDocumentFilename({}, 'offer', '../')).toThrow('extension')
  })

  it('formats dates in UTC and money according to the requested locale', () => {
    expect(formatDate('2026-01-01T00:15:00Z', 'en-US')).toBe('Jan 1, 2026')
    expect(formatDate('invalid', 'en-US')).toBe('')
    expect(formatMoney(1234.56, 'PLN', 'pl-PL')).toBe(new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(1234.56))
  })

  it('prefers UTF-8 response filenames and falls back safely for malformed encoding', () => {
    const headers = new Headers({ 'content-disposition': "attachment; filename=offer.pdf; filename*=UTF-8''Oferta-%C5%81%C3%B3d%C5%BA.pdf" })
    expect(getFilenameFromResponse({ headers })).toBe('Oferta-Łódź.pdf')
    headers.set('content-disposition', "attachment; filename=offer.pdf; filename*=UTF-8''%ZZ")
    expect(getFilenameFromResponse({ headers })).toBe('offer.pdf')
    expect(getFilenameFromResponse({ headers: new Headers() }, 'fallback.md')).toBe('fallback.md')
  })

  it('translates stable error codes without reflecting server diagnostics', () => {
    const translate = (key: string) => key
    expect(resolveErrorMessage({ error: 'forbidden' }, translate)).toBe('document_generators.errors.forbidden')
    expect(resolveErrorMessage({ error: 'private stack trace' }, translate)).toBe('document_generators.errors.render_failed')
  })
})
