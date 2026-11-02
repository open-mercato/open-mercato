import { isCrossSiteBrowserRequest } from '../url'

function req(headers: Record<string, string>, url = 'https://app.example.com/api/auth/login') {
  return new Request(url, { method: 'POST', headers })
}

const configured = { APP_URL: 'https://app.example.com', NODE_ENV: 'production' }
const unconfiguredDev = { NODE_ENV: 'development' }

describe('isCrossSiteBrowserRequest', () => {
  describe('non-browser callers (no Origin, no Sec-Fetch-Site) are never cross-site', () => {
    test.each([
      ['configured', configured],
      ['unconfigured dev', unconfiguredDev],
    ])('%s', (_label, env) => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com' }), env)).toBe(false)
    })
  })

  describe('Fetch Metadata is authoritative when present', () => {
    test('cross-site is rejected regardless of Origin', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', 'sec-fetch-site': 'cross-site' }), configured)).toBe(true)
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', 'sec-fetch-site': 'cross-site', origin: 'https://app.example.com' }), configured)).toBe(true)
    })

    test('same-origin and none are accepted even when the proxy hides the public host', () => {
      const internal = 'http://app-internal:3000/api/auth/login'
      expect(isCrossSiteBrowserRequest(req({ host: 'app-internal:3000', origin: 'https://public.example.net', 'sec-fetch-site': 'same-origin' }, internal), {})).toBe(false)
      expect(isCrossSiteBrowserRequest(req({ host: 'app-internal:3000', 'sec-fetch-site': 'none' }, internal), {})).toBe(false)
    })

    test('same-site falls back to the Origin allowlist', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'https://blog.example.com', 'sec-fetch-site': 'same-site' }), configured)).toBe(true)
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'https://ops.example.com', 'sec-fetch-site': 'same-site' }), {
        ...configured,
        APP_ALLOWED_ORIGINS: 'https://ops.example.com',
      })).toBe(false)
    })

    test('an unknown Sec-Fetch-Site token falls back to the Origin check', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'https://evil.example', 'sec-fetch-site': 'bogus' }), configured)).toBe(true)
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'https://app.example.com', 'sec-fetch-site': 'bogus' }), configured)).toBe(false)
    })
  })

  describe('Origin check (browsers without Fetch Metadata)', () => {
    test('Origin: null is cross-site', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'null' }), configured)).toBe(true)
    })

    test('a malformed Origin is cross-site', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'not a url' }), configured)).toBe(true)
    })

    test('a foreign Origin is cross-site', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'https://evil.example' }), configured)).toBe(true)
    })

    test('Origin matching a configured origin (APP_URL / NEXT_PUBLIC_APP_URL / APP_ALLOWED_ORIGINS) is accepted', () => {
      const internal = 'http://app-internal:3000/api/auth/login'
      expect(isCrossSiteBrowserRequest(req({ host: 'app-internal:3000', origin: 'https://app.example.com' }, internal), configured)).toBe(false)
      expect(isCrossSiteBrowserRequest(req({ host: 'app-internal:3000', origin: 'https://admin.example.com' }, internal), {
        NEXT_PUBLIC_APP_URL: 'https://admin.example.com',
      })).toBe(false)
    })

    test('Origin matching the request Host authority is accepted (portal custom domains, unconfigured dev)', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'shop.acme.test', origin: 'https://shop.acme.test' }, 'https://shop.acme.test/api/customer_accounts/login'), configured)).toBe(false)
      expect(isCrossSiteBrowserRequest(req({ host: 'localhost:3000', origin: 'http://localhost:3000' }, 'http://localhost:3000/api/auth/login'), unconfiguredDev)).toBe(false)
    })

    test('Origin matching X-Forwarded-Host is accepted even when the proxy did not forward the scheme', () => {
      expect(isCrossSiteBrowserRequest(req({
        host: 'app-internal:3000',
        'x-forwarded-host': 'admin.example.com',
        origin: 'https://admin.example.com',
      }, 'http://app-internal:3000/api/auth/login'), {})).toBe(false)
    })

    test('a different port on the same host is cross-origin', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'https://app.example.com:8443' }), configured)).toBe(true)
    })

    test('a Host carrying the default port matches the Origin', () => {
      expect(isCrossSiteBrowserRequest(req({
        host: 'app.example.com:443',
        'x-forwarded-proto': 'https',
        origin: 'https://app.example.com',
      }, 'http://app.example.com:443/api/auth/login'), {})).toBe(false)
      expect(isCrossSiteBrowserRequest(req({
        host: 'app.example.com:443',
        origin: 'https://app.example.com',
      }, 'http://app.example.com:443/api/auth/login'), {})).toBe(false)
    })

    test('an uppercase Host matches the Origin', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'APP.Example.COM', origin: 'https://app.example.com' }), {})).toBe(false)
    })

    test('an IPv6 loopback Host matches the Origin in dev', () => {
      expect(isCrossSiteBrowserRequest(req({ host: '[::1]:3000', origin: 'http://[::1]:3000' }, 'http://[::1]:3000/api/auth/login'), unconfiguredDev)).toBe(false)
    })

    test('only the first X-Forwarded-Host value is used', () => {
      const internal = 'http://app-internal:3000/api/auth/login'
      expect(isCrossSiteBrowserRequest(req({
        host: 'app-internal:3000',
        'x-forwarded-host': 'admin.example.com, evil.example',
        origin: 'https://admin.example.com',
      }, internal), {})).toBe(false)
      expect(isCrossSiteBrowserRequest(req({
        host: 'app-internal:3000',
        'x-forwarded-host': 'admin.example.com, evil.example',
        origin: 'https://evil.example',
      }, internal), {})).toBe(true)
    })

    test('a forwarded scheme that differs from the Origin scheme is cross-origin', () => {
      expect(isCrossSiteBrowserRequest(req({
        host: 'app.example.com',
        'x-forwarded-proto': 'https',
        origin: 'http://app.example.com',
      }), {})).toBe(true)
    })
  })

  describe('Fetch Metadata without Origin', () => {
    test('same-site without Origin is cross-site', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', 'sec-fetch-site': 'same-site' }), configured)).toBe(true)
    })

    test('an unknown token without Origin is cross-site', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', 'sec-fetch-site': 'bogus' }), configured)).toBe(true)
    })

    test('the Sec-Fetch-Site value is compared case- and whitespace-insensitively', () => {
      expect(isCrossSiteBrowserRequest(req({ host: 'app.example.com', origin: 'https://app.example.com', 'sec-fetch-site': ' Cross-Site ' }), configured)).toBe(true)
    })
  })
})
