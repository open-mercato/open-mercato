import { validateSameOriginMutationRequest } from '../originGuard'

function makeRequest(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: 'POST', headers })
}

describe('validateSameOriginMutationRequest', () => {
  const originalAppUrl = process.env.APP_URL
  const originalPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originalAppUrl
    if (originalPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = originalPublicAppUrl
  })

  it('allows a request whose Origin matches APP_URL, even when req.url is the proxy-local listening address', () => {
    process.env.APP_URL = 'https://demo.example.com'
    delete process.env.NEXT_PUBLIC_APP_URL

    const req = makeRequest('https://localhost:3000/api/sales/quotes/accept', {
      origin: 'https://demo.example.com',
    })

    expect(validateSameOriginMutationRequest(req)).toBeNull()
  })

  it('rejects a foreign Origin even when req.url is the proxy-local listening address', () => {
    process.env.APP_URL = 'https://demo.example.com'
    delete process.env.NEXT_PUBLIC_APP_URL

    const req = makeRequest('https://localhost:3000/api/sales/quotes/accept', {
      origin: 'https://attacker.example.com',
    })

    expect(validateSameOriginMutationRequest(req)).toEqual({
      reason: 'cross-origin',
      requestOrigin: 'https://attacker.example.com',
      expectedOrigin: 'https://demo.example.com',
    })
  })

  it('falls back to resolving the origin from the request when APP_URL is unset, preserving prior behavior', () => {
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL

    const req = makeRequest('https://app.example.com/api/sales/quotes/accept', {
      origin: 'https://app.example.com',
    })

    expect(validateSameOriginMutationRequest(req)).toBeNull()
  })

  it('allows a loopback Origin that differs only in hostname (127.0.0.1 vs localhost) from APP_URL on the same port', () => {
    // Ephemeral test/dev harnesses commonly set APP_URL to one loopback alias
    // (e.g. http://127.0.0.1:5037) while the client actually reaches the app via
    // another (http://localhost:5037). Neither side is attacker-controlled here.
    process.env.APP_URL = 'http://127.0.0.1:5037'
    delete process.env.NEXT_PUBLIC_APP_URL

    const req = makeRequest('http://127.0.0.1:5037/api/sales/quotes/accept', {
      origin: 'http://localhost:5037',
    })

    expect(validateSameOriginMutationRequest(req)).toBeNull()
  })

  it('still rejects loopback origins on different ports', () => {
    process.env.APP_URL = 'http://127.0.0.1:5037'
    delete process.env.NEXT_PUBLIC_APP_URL

    const req = makeRequest('http://127.0.0.1:5037/api/sales/quotes/accept', {
      origin: 'http://localhost:4000',
    })

    expect(validateSameOriginMutationRequest(req)).toEqual({
      reason: 'cross-origin',
      requestOrigin: 'http://localhost:4000',
      expectedOrigin: 'http://127.0.0.1:5037',
    })
  })

  it('rejects a spoofed Origin backed by matching X-Forwarded-* headers when APP_URL is unset', () => {
    // With no configured app origin, the expected origin must come only from
    // req.url — never from X-Forwarded-Proto/X-Forwarded-Host, which an
    // attacker fully controls on this unauthenticated public endpoint. Without
    // that guarantee, a forged Origin plus matching forwarded headers would
    // make both sides of the comparison agree and bypass the guard entirely.
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL

    const req = makeRequest('https://app.example.com/api/sales/quotes/accept', {
      origin: 'https://attacker.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'attacker.example.com',
    })

    expect(validateSameOriginMutationRequest(req)).toEqual({
      reason: 'cross-origin',
      requestOrigin: 'https://attacker.example.com',
      expectedOrigin: 'https://app.example.com',
    })
  })

  it('rejects a loopback Origin that matches on host/port but not scheme', () => {
    // http and https are different origins even for loopback addresses; a TLS
    // downgrade must not be tolerated by the loopback-equivalence carve-out.
    process.env.APP_URL = 'https://127.0.0.1:5037'
    delete process.env.NEXT_PUBLIC_APP_URL

    const req = makeRequest('https://127.0.0.1:5037/api/sales/quotes/accept', {
      origin: 'http://localhost:5037',
    })

    expect(validateSameOriginMutationRequest(req)).toEqual({
      reason: 'cross-origin',
      requestOrigin: 'http://localhost:5037',
      expectedOrigin: 'https://127.0.0.1:5037',
    })
  })
})
