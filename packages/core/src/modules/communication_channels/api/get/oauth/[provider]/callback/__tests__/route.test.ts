/** @jest-environment node */

// Regression for https://github.com/open-mercato/open-mercato/issues/5193 —
// redirectWithFlash() used to build its redirect Location header from
// `new URL(req.url).origin`, which reflects the internal origin the app sees
// behind a reverse proxy (e.g. Railway) rather than the public APP_URL.

import { GET } from '../route'

describe('GET /api/communication_channels/oauth/[provider]/callback', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  function callbackRequest(query: string) {
    return new Request(`http://localhost:3000/api/communication_channels/oauth/gmail/callback${query}`, {
      headers: { host: 'localhost:3000' },
    })
  }

  test('redirects using APP_URL as origin instead of the raw request origin', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    process.env.APP_URL = 'https://app.example.com'

    const req = callbackRequest('?error=access_denied')
    const res = await GET(req, { params: { provider: 'gmail' } })

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toBeTruthy()
    expect(location!.startsWith('https://app.example.com/')).toBe(true)
    expect(location).not.toContain('localhost')
  })

  // Regression for #6402: `?flash=` is the global <FlashMessages> message-text
  // param, so reporting the outcome through it rendered a raw "error" toast.
  test('reports the outcome through the oauth param, never the global flash param', async () => {
    process.env.APP_URL = 'https://app.example.com'

    const res = await GET(callbackRequest('?error=access_denied'), { params: { provider: 'gmail' } })

    const location = new URL(res.headers.get('location')!)
    expect(location.searchParams.get('oauth')).toBe('error')
    expect(location.searchParams.get('code')).toBe('access_denied')
    expect(location.searchParams.get('provider')).toBe('gmail')
    expect(location.searchParams.has('flash')).toBe(false)
  })

  test('falls back to the request origin when APP_URL is not configured', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_URL

    const req = callbackRequest('?error=access_denied')
    const res = await GET(req, { params: { provider: 'gmail' } })

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toBeTruthy()
    expect(location!.startsWith('http://localhost:3000/')).toBe(true)
  })
})
