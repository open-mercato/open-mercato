/** @jest-environment node */
import { GET } from '@open-mercato/core/modules/auth/api/locale/route'

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
