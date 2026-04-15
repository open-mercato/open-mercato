import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveRequestOrigin, getAppBaseUrl, toAbsoluteUrl } from '../url'

function createRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers })
}

describe('resolveRequestOrigin', () => {
  it('returns origin from request URL when no forwarded headers', () => {
    const req = createRequest('http://localhost:3000/api/test')
    expect(resolveRequestOrigin(req)).toBe('http://localhost:3000')
  })

  it('uses x-forwarded-proto when present', () => {
    const req = createRequest('http://internal:3000/api/test', {
      'x-forwarded-proto': 'https',
    })
    expect(resolveRequestOrigin(req)).toBe('https://internal:3000')
  })

  it('uses x-forwarded-host when present', () => {
    const req = createRequest('http://internal:3000/api/test', {
      'x-forwarded-host': 'app.example.com',
    })
    expect(resolveRequestOrigin(req)).toBe('http://app.example.com')
  })

  it('uses both forwarded headers when present', () => {
    const req = createRequest('http://internal:3000/api/test', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'app.example.com',
    })
    expect(resolveRequestOrigin(req)).toBe('https://app.example.com')
  })

  it('falls back to host header when x-forwarded-host is absent', () => {
    const req = createRequest('http://internal:3000/api/test', {
      host: 'proxy.example.com',
    })
    expect(resolveRequestOrigin(req)).toBe('http://proxy.example.com')
  })
})

describe('getAppBaseUrl', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_URL
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalEnv.NEXT_PUBLIC_APP_URL
    process.env.APP_URL = originalEnv.APP_URL
  })

  it('prefers NEXT_PUBLIC_APP_URL over everything', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://next-public.example.com'
    process.env.APP_URL = 'https://app-url.example.com'
    const req = createRequest('http://internal:3000/api/test', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'forwarded.example.com',
    })
    expect(getAppBaseUrl(req)).toBe('https://next-public.example.com')
  })

  it('prefers APP_URL over forwarded headers', () => {
    process.env.APP_URL = 'https://app-url.example.com'
    const req = createRequest('http://internal:3000/api/test', {
      'x-forwarded-host': 'forwarded.example.com',
    })
    expect(getAppBaseUrl(req)).toBe('https://app-url.example.com')
  })

  it('falls back to forwarded headers when no env vars set', () => {
    const req = createRequest('http://internal:3000/api/test', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'app.example.com',
    })
    expect(getAppBaseUrl(req)).toBe('https://app.example.com')
  })

  it('falls back to request URL when nothing else available', () => {
    const req = createRequest('http://localhost:3000/api/test')
    expect(getAppBaseUrl(req)).toBe('http://localhost:3000')
  })
})

describe('toAbsoluteUrl', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_URL
  })

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_URL
  })

  it('resolves a path against the app base URL', () => {
    const req = createRequest('http://localhost:3000/api/test', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'app.example.com',
    })
    expect(toAbsoluteUrl(req, '/reset/token123')).toBe('https://app.example.com/reset/token123')
  })
})
