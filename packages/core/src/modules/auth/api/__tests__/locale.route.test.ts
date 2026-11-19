/** @jest-environment node */
import { GET, POST } from '@open-mercato/core/modules/auth/api/locale/route'
import { registerSupportedLocalesResolver } from '@open-mercato/shared/lib/i18n/locale-registry'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback?: string) => fallback ?? '',
    translate: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

afterEach(() => {
  registerSupportedLocalesResolver(null)
})

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

    it('redirects to / when the decoded redirect path contains // (open redirect bypass)', async () => {
      const res = await GET(makeGetRequest({ locale: 'en', redirect: '/backend//evil.com' }))

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

  it('returns 400 for a non-string locale', async () => {
    const res = await POST(new Request(`${BASE}/api/auth/locale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 42 }),
    }))

    expect(res.status).toBe(400)
  })

  describe('canonicalizes the value it stores', () => {
    // The cookie is compared against the served set verbatim by `detectLocale`,
    // so writing back the caller's spelling would set a cookie that the next
    // render silently ignores.
    async function postLocale(locale: string) {
      return POST(new Request(`${BASE}/api/auth/locale`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      }))
    }

    it('lower-cases a mixed-case code', async () => {
      const res = await postLocale('DE')

      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toContain('locale=de')
    })

    it('folds a region subtag down to the supported base locale', async () => {
      const res = await postLocale('de-AT')

      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toContain('locale=de')
    })

    it('does the same on the GET redirect form', async () => {
      const res = await GET(makeGetRequest({ locale: 'PL-pl' }))

      expect(res.status).toBe(307)
      expect(res.headers.get('set-cookie')).toContain('locale=pl')
    })
  })
})

describe('locale writes are validated against the tenant-narrowed set', () => {
  // `detectLocale` reads the cookie back against the request's served set. If
  // these handlers validated against the wider process-wide registry, a locale
  // the tenant has not selected would return 200 and set a year-long cookie
  // that every subsequent render silently discards — the caller is told the
  // change worked and nothing ever changes.
  function narrowTo(codes: readonly string[]) {
    registerSupportedLocalesResolver(async () => codes)
  }

  async function postLocale(locale: string) {
    return POST(new Request(`${BASE}/api/auth/locale`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    }))
  }

  it('rejects a locale outside the tenant selection on POST', async () => {
    narrowTo(['en', 'pl'])

    const res = await postLocale('de')

    expect(res.status).toBe(400)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('rejects it on the GET redirect arm too', async () => {
    narrowTo(['en', 'pl'])

    const res = await GET(makeGetRequest({ locale: 'de', redirect: '/' }))

    expect(res.status).toBe(400)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('still accepts a locale inside the selection', async () => {
    narrowTo(['en', 'pl'])

    const res = await postLocale('pl')

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('locale=pl')
  })

  it('rejects a region subtag whose base locale is outside the selection', async () => {
    narrowTo(['en', 'pl'])

    const res = await postLocale('de-AT')

    expect(res.status).toBe(400)
  })

  it('accepts the default locale even when the selection omits it', async () => {
    // `resolveSupportedLocalesForRequest` always keeps `defaultLocale` servable,
    // so the write side has to agree or an admin could never get back to it.
    narrowTo(['pl'])

    const res = await postLocale('en')

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('locale=en')
  })

  it('serves the full set when the tenant has no stored selection', async () => {
    narrowTo([])

    const res = await postLocale('ko')

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('locale=ko')
  })

  it('serves the full set when the tenant lookup throws', async () => {
    registerSupportedLocalesResolver(async () => {
      throw new Error('[internal] database unavailable')
    })

    const res = await postLocale('ko')

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('locale=ko')
  })
})
