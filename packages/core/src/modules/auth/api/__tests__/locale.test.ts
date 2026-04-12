/** @jest-environment node */
import { GET, POST } from '@open-mercato/core/modules/auth/api/locale/route'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

function makeRequest(redirect: string): Request {
  const url = new URL('https://develop.openmercato.com/api/auth/locale')
  url.searchParams.set('locale', 'en')
  url.searchParams.set('redirect', redirect)
  return new Request(url)
}

describe('GET /api/auth/locale', () => {
  it('falls back to root for external redirect URLs', async () => {
    const response = await GET(makeRequest('https://evil.example/phish'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://develop.openmercato.com/')
  })

  it('falls back to root for protocol-relative redirect URLs', async () => {
    const response = await GET(makeRequest('//evil.example/phish'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://develop.openmercato.com/')
  })

  it('falls back to root for backslash protocol-relative redirect URLs', async () => {
    const response = await GET(makeRequest('/\\evil.example/phish'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://develop.openmercato.com/')
  })

  it('allows same-origin relative paths', async () => {
    const response = await GET(makeRequest('/backend'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://develop.openmercato.com/backend')
  })
})

describe('POST /api/auth/locale', () => {
  it('stores the selected locale in a cookie for supported locales', async () => {
    const response = await POST(
      new Request('https://develop.openmercato.com/api/auth/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: 'pl' }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('locale=pl')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Max-Age=31536000')
  })

  it('returns 400 for unsupported locales', async () => {
    const response = await POST(
      new Request('https://develop.openmercato.com/api/auth/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: 'fr' }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid locale' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('returns 400 for malformed request bodies', async () => {
    const response = await POST(
      new Request('https://develop.openmercato.com/api/auth/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid',
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Bad request' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
