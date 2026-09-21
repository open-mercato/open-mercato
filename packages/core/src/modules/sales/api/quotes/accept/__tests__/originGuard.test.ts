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
})
