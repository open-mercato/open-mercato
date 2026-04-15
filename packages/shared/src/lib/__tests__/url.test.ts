import {
  AppOriginConfigurationError,
  AppOriginRejectedError,
  assertAllowedAppOrigin,
  getSecurityEmailBaseUrl,
  toSecurityEmailUrl,
} from '../url'

describe('security email URL helpers', () => {
  test('uses APP_URL for security email links and preserves its base path', () => {
    const env = {
      APP_URL: 'https://app.example.com/admin/',
      NODE_ENV: 'production',
    }
    const request = new Request('https://app.example.com/api/auth/reset')

    expect(toSecurityEmailUrl(request, '/reset/token-1', env)).toBe('https://app.example.com/admin/reset/token-1')
  })

  test('rejects request origins outside the configured allowlist', () => {
    const env = {
      APP_URL: 'https://app.example.com',
      NODE_ENV: 'production',
    }
    const request = new Request('https://evil.example/api/auth/reset')

    expect(() => assertAllowedAppOrigin(request, env)).toThrow(AppOriginRejectedError)
  })

  test('rejects a mismatched Host header even when the request URL origin is allowed', () => {
    const env = {
      APP_URL: 'https://app.example.com',
      NODE_ENV: 'production',
    }
    const request = new Request('https://app.example.com/api/auth/reset', {
      headers: { host: 'evil.example' },
    })

    expect(() => assertAllowedAppOrigin(request, env)).toThrow(AppOriginRejectedError)
  })

  test('allows extra configured origins', () => {
    const env = {
      APP_URL: 'https://app.example.com',
      APP_ALLOWED_ORIGINS: 'https://admin.example.com, https://ops.example.com',
      NODE_ENV: 'production',
    }
    const request = new Request('https://admin.example.com/api/auth/reset')

    expect(() => assertAllowedAppOrigin(request, env)).not.toThrow()
  })

  test('allows loopback origin mismatches outside production', () => {
    const env = {
      APP_URL: 'http://localhost:3000',
      NODE_ENV: 'test',
    }
    const request = new Request('http://127.0.0.1:5001/api/auth/reset')

    expect(() => assertAllowedAppOrigin(request, env)).not.toThrow()
  })

  test('requires APP_URL for security email links in production', () => {
    const env = {
      NODE_ENV: 'production',
    }

    expect(() => getSecurityEmailBaseUrl(undefined, env)).toThrow(AppOriginConfigurationError)
  })

  test('does not fall back to the request host when APP_URL is missing outside production', () => {
    const env = {
      NODE_ENV: 'test',
    }
    const request = new Request('https://evil.example/api/auth/reset')

    expect(toSecurityEmailUrl(request, '/reset/token-1', env)).toBe('http://localhost:3000/reset/token-1')
  })
})
