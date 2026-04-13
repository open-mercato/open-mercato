/** @jest-environment node */
import { GET, POST } from '@open-mercato/core/modules/auth/api/locale/route'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback?: string) => fallback ?? '',
    translate: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

const BASE = 'https://app.example.com'

function makeGetRequest(params: Record<string, string>) {
  const url = new URL('/api/auth/locale', BASE)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new Request(url.toString())
}

describe('GET /api/auth/locale — open redirect fix (CWE-601)', () => {
  describe('redirect safety', () => {
    it('redirects to the given path when redirect is a same-origin relative path', async () => {
      const res = await GET(makeGetRequest({ locale: 'en', redirect: '/dashboard' }))

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe(`${BASE}/dashboard`)
    })

    it('redirects to / when redirect points to an external domain', async () => {
      const res = await GET(makeGetRequest({ locale: 'en', redirect: 'https://evil.com/fake-login' }))

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe(`${BASE}/`)
    })

    it('redirects to / when redirect uses a protocol-relative URL targeting another host', async () => {
      const res = await GET(makeGetRequest({ locale: 'en', redirect: '//evil.com/steal' }))

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe(`${BASE}/`)
    })

    it('redirects to / when redirect is omitted', async () => {
      const res = await GET(makeGetRequest({ locale: 'en' }))

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe(`${BASE}/`)
    })

    it('redirects to / when redirect uses javascript: scheme', async () => {
      const res = await GET(makeGetRequest({ locale: 'en', redirect: 'javascript:alert(1)' }))

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe(`${BASE}/`)
    })

    it('preserves query string on same-origin redirect', async () => {
      const res = await GET(makeGetRequest({ locale: 'en', redirect: '/orders?page=2&filter=open' }))

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe(`${BASE}/orders?page=2&filter=open`)
    })
  })

  describe('locale validation', () => {
    it('sets locale cookie on valid locale', async () => {
      const res = await GET(makeGetRequest({ locale: 'pl', redirect: '/' }))

      expect(res.status).toBe(307)
      expect(res.headers.get('set-cookie')).toContain('locale=pl')
    })

    it('returns 400 for an unsupported locale', async () => {
      const res = await GET(makeGetRequest({ locale: 'xx', redirect: '/' }))

      expect(res.status).toBe(400)
    })

    it('returns 400 when locale is missing', async () => {
      const res = await GET(makeGetRequest({ redirect: '/' }))

      expect(res.status).toBe(400)
    })
  })
})

describe('POST /api/auth/locale', () => {
  it('sets locale cookie and returns ok for a valid locale', async () => {
    const res = await POST(new Request(`${BASE}/api/auth/locale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'de' }),
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('set-cookie')).toContain('locale=de')
  })

  it('returns 400 for an unsupported locale', async () => {
    const res = await POST(new Request(`${BASE}/api/auth/locale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'xx' }),
    }))

    expect(res.status).toBe(400)
  })

  it('returns 400 for malformed JSON body', async () => {
    const res = await POST(new Request(`${BASE}/api/auth/locale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    }))

    expect(res.status).toBe(400)
  })
})
