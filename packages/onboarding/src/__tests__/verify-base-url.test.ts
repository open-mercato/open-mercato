import { resolveVerifyRedirectBaseUrl } from '../modules/onboarding/lib/verify-base-url'

function buildRequest(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers })
}

describe('onboarding verify redirect base URL', () => {
  it('uses APP_URL when it matches the verification request origin', () => {
    const result = resolveVerifyRedirectBaseUrl(
      buildRequest('https://demo.openmercato.com/api/onboarding/onboarding/verify?token=t'),
      {
        APP_URL: 'https://demo.openmercato.com',
        NODE_ENV: 'production',
      },
    )

    expect(result).toEqual({ ok: true, baseUrl: 'https://demo.openmercato.com' })
  })

  it('rejects a verify request when APP_URL points to a different local port', () => {
    const result = resolveVerifyRedirectBaseUrl(
      buildRequest('http://localhost:3001/api/onboarding/onboarding/verify?token=t'),
      {
        APP_URL: 'http://localhost:3000',
        APP_ALLOWED_ORIGINS: 'http://localhost:3001',
        NODE_ENV: 'development',
      },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe('redirect_misconfigured')
      expect(result.redirectOrigin).toBe('http://localhost:3001')
    }
  })

  it('accepts equivalent loopback hostnames on the same port', () => {
    const result = resolveVerifyRedirectBaseUrl(
      buildRequest('http://127.0.0.1:3001/api/onboarding/onboarding/verify?token=t'),
      {
        APP_URL: 'http://localhost:3001',
        NODE_ENV: 'development',
      },
    )

    expect(result).toEqual({ ok: true, baseUrl: 'http://localhost:3001' })
  })

  it('returns an explicit error for non-allowlisted origins', () => {
    const result = resolveVerifyRedirectBaseUrl(
      buildRequest('https://evil.example/api/onboarding/onboarding/verify?token=t'),
      {
        APP_URL: 'https://demo.openmercato.com',
        NODE_ENV: 'production',
      },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe('origin_not_allowed')
      expect(result.redirectOrigin).toBeNull()
      expect(result.httpStatus).toBe(400)
    }
  })
})
