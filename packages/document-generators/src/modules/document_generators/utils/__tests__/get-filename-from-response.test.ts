import { getFilenameFromResponse } from '..'

function responseWith(disposition?: string): Response {
  const headers = new Headers()
  if (disposition !== undefined) headers.set('Content-Disposition', disposition)
  return new Response(null, { headers })
}

describe('getFilenameFromResponse', () => {
  it('extracts the quoted filename from Content-Disposition', () => {
    const res = responseWith('attachment; filename="offer-42.pdf"')
    expect(getFilenameFromResponse(res, 'fallback.pdf')).toBe('offer-42.pdf')
  })

  it('falls back when the header is absent', () => {
    expect(getFilenameFromResponse(responseWith(), 'fallback.pdf')).toBe('fallback.pdf')
  })

  it('falls back when the header has no filename token', () => {
    const res = responseWith('attachment')
    expect(getFilenameFromResponse(res, 'fallback.pdf')).toBe('fallback.pdf')
  })

  it('falls back when the filename is unquoted (parser only handles quoted form)', () => {
    const res = responseWith('attachment; filename=offer-42.pdf')
    expect(getFilenameFromResponse(res, 'fallback.pdf')).toBe('fallback.pdf')
  })
})
