/** @jest-environment node */
import { sanitizeRedirectPath } from '@open-mercato/core/modules/auth/lib/safeRedirect'

const baseUrl = 'https://app.example.com'

describe('sanitizeRedirectPath', () => {
  it('returns the fallback when the param is null or empty', () => {
    expect(sanitizeRedirectPath(null, baseUrl, '/backend')).toBe('/backend')
    expect(sanitizeRedirectPath('', baseUrl, '/')).toBe('/')
  })

  it('preserves a safe same-origin path with query and hash', () => {
    expect(sanitizeRedirectPath('/backend/orders?page=2#top', baseUrl, '/backend')).toBe(
      '/backend/orders?page=2#top',
    )
  })

  it('rejects absolute URLs that point to a different origin', () => {
    expect(sanitizeRedirectPath('https://evil.com/backend', baseUrl, '/backend')).toBe('/backend')
  })

  it('rejects protocol-relative redirects to another host', () => {
    expect(sanitizeRedirectPath('//evil.com', baseUrl, '/backend')).toBe('/backend')
  })

  it('rejects already-decoded paths whose pathname contains // (open redirect vector)', () => {
    expect(sanitizeRedirectPath('/backend//evil.com', baseUrl, '/backend')).toBe('/backend')
    expect(sanitizeRedirectPath('//backend//evil.com', baseUrl, '/backend')).toBe('/backend')
  })

  it('rejects URL-encoded paths once URLSearchParams has decoded them', () => {
    const url = new URL(`${baseUrl}/login?redirect=%2Fbackend%2F%2Fevil.com`)
    const decoded = url.searchParams.get('redirect')
    expect(decoded).toBe('/backend//evil.com')
    expect(sanitizeRedirectPath(decoded, baseUrl, '/backend')).toBe('/backend')
  })

  it('rejects backslash sequences that browsers normalize to //', () => {
    expect(sanitizeRedirectPath('/backend\\\\evil.com', baseUrl, '/backend')).toBe('/backend')
    expect(sanitizeRedirectPath('\\\\evil.com', baseUrl, '/backend')).toBe('/backend')
  })

  it('resolves a relative path against the base origin and keeps it', () => {
    expect(sanitizeRedirectPath('backend/orders', baseUrl, '/backend')).toBe('/backend/orders')
  })

  it('rejects malformed URLs', () => {
    expect(sanitizeRedirectPath('http://[invalid', baseUrl, '/backend')).toBe('/backend')
  })
})
