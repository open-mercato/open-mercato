/** @jest-environment node */
import {
  buildSafeRedirectResponse,
  resolveSafeRedirectLocation,
  resolveTrustedRedirectBase,
} from '@open-mercato/core/modules/auth/lib/requestRedirect'

const ENV_KEYS = ['APP_URL', 'NEXT_PUBLIC_APP_URL', 'APP_ALLOWED_ORIGINS', 'NODE_ENV'] as const
const original: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key]
  delete process.env.APP_URL
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.APP_ALLOWED_ORIGINS
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key]
    else process.env[key] = original[key]
  }
})

describe('resolveSafeRedirectLocation', () => {
  it('builds an absolute URL on the allowlisted app origin when the request origin is trusted', () => {
    process.env.APP_URL = 'https://app.example.com'
    const req = new Request('https://app.example.com/api/auth/logout', { method: 'POST' })

    expect(resolveSafeRedirectLocation(req, '/login')).toBe('https://app.example.com/login')
  })

  it('does not honour a spoofed X-Forwarded-Host', () => {
    process.env.APP_URL = 'https://app.example.com'
    const req = new Request('https://app.example.com/api/auth/logout', {
      method: 'POST',
      headers: { 'x-forwarded-host': 'attacker.example' },
    })

    const location = resolveSafeRedirectLocation(req, '/login')
    expect(location).not.toContain('attacker.example')
    expect(location).toBe('/login')
  })

  it('falls back to a host-relative path when the request origin is not allowlisted', () => {
    process.env.APP_URL = 'https://app.example.com'
    const req = new Request('https://evil.example.com/api/auth/logout', { method: 'POST' })

    expect(resolveSafeRedirectLocation(req, '/login')).toBe('/login')
  })

  it('never resolves a protocol-relative path into a cross-origin URL', () => {
    process.env.APP_URL = 'https://app.example.com'
    const req = new Request('https://app.example.com/api/auth/logout', { method: 'POST' })

    // `new URL('//evil.com', base)` would otherwise resolve to https://evil.com/
    expect(resolveSafeRedirectLocation(req, '//evil.com')).toBe('https://app.example.com/evil.com')
  })

  it('collapses a protocol-relative fallback path to a single-slash relative path', () => {
    process.env.APP_URL = 'https://app.example.com'
    const req = new Request('https://evil.example.com/api/auth/logout', { method: 'POST' })

    expect(resolveSafeRedirectLocation(req, '//evil.com')).toBe('/evil.com')
  })

  it('hard-fails closed to a relative redirect in production when APP_URL is missing', () => {
    process.env.NODE_ENV = 'production'
    const req = new Request('https://anything.example.com/api/auth/logout', { method: 'POST' })

    expect(resolveTrustedRedirectBase(req)).toBeNull()
    expect(resolveSafeRedirectLocation(req, '/login')).toBe('/login')
  })

  it('preserves the query string when building the redirect', () => {
    process.env.APP_URL = 'https://app.example.com'
    const req = new Request('https://app.example.com/api/auth/session/refresh', { method: 'GET' })

    expect(resolveSafeRedirectLocation(req, '/login?redirect=%2Fbackend')).toBe(
      'https://app.example.com/login?redirect=%2Fbackend',
    )
  })
})

describe('buildSafeRedirectResponse', () => {
  it('returns a 307 redirect carrying the safe Location header', () => {
    process.env.APP_URL = 'https://app.example.com'
    const req = new Request('https://app.example.com/api/auth/logout', { method: 'POST' })

    const res = buildSafeRedirectResponse(req, '/login')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://app.example.com/login')
  })
})
