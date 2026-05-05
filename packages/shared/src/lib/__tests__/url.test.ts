import {
  AppOriginConfigurationError,
  AppOriginRejectedError,
  assertAllowedAppOrigin,
  getAppBaseUrl,
  getSecurityEmailBaseUrl,
  resolveRequestOrigin,
  toAbsoluteUrl,
  toSecurityEmailUrl,
} from '../url'

function createRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers })
}

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

  test('rejects an untrusted request URL even when forwarded host matches the configured app origin', () => {
    const env = {
      APP_URL: 'https://auth.openmercato.com',
      NODE_ENV: 'production',
    }
    const request = new Request('https://evil.example/api/auth/reset', {
      headers: {
        host: 'auth.openmercato.com',
        'x-forwarded-host': 'auth.openmercato.com',
        'x-forwarded-proto': 'https',
      },
    })

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

  test('allows internal request URLs when forwarded host matches the configured app origin', () => {
    const env = {
      APP_URL: 'https://auth.openmercato.com',
      NODE_ENV: 'production',
    }
    const request = new Request('https://localhost:9876/api/auth/reset', {
      headers: {
        host: 'auth.openmercato.com',
        'x-forwarded-host': 'auth.openmercato.com',
        'x-forwarded-proto': 'https',
      },
    })

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

  test('allows equivalent loopback proxy origins in production when the port matches', () => {
    const env = {
      APP_URL: 'http://127.0.0.1:3000',
      NODE_ENV: 'production',
    }
    const request = new Request('http://127.0.0.1:3000/api/auth/reset', {
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'localhost:3000',
        'x-forwarded-proto': 'https',
      },
    })

    expect(() => assertAllowedAppOrigin(request, env)).not.toThrow()
  })

  test('rejects loopback proxy origins when the port does not match', () => {
    const env = {
      APP_URL: 'http://127.0.0.1:3000',
      NODE_ENV: 'production',
    }
    const request = new Request('http://127.0.0.1:3000/api/auth/reset', {
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'localhost:4444',
      },
    })

    expect(() => assertAllowedAppOrigin(request, env)).toThrow(AppOriginRejectedError)
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
