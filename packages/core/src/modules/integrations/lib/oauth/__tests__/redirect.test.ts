/** @jest-environment node */
import { OAuthGrantError } from '../descriptor'
import { resolveOAuthRedirectUri } from '../redirect'

const ENV_KEYS = ['APP_URL', 'NEXT_PUBLIC_APP_URL', 'APP_ALLOWED_ORIGINS', 'NODE_ENV'] as const
const originalEnv: Record<string, string | undefined> = {}
const CALLBACK_PATH = '/api/acme/oauth/callback'

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
  delete process.env.APP_URL
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.APP_ALLOWED_ORIGINS
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

function grantErrorCode(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof OAuthGrantError) return error.code
    throw error
  }
  throw new Error('[internal] expected OAuthGrantError')
}

describe('resolveOAuthRedirectUri', () => {
  it('keeps the path prefix of APP_URL', () => {
    process.env.APP_URL = 'https://erp.acme.test/mercato/'
    const req = new Request('https://erp.acme.test/mercato/api/acme/oauth/initiate')

    expect(resolveOAuthRedirectUri(req, CALLBACK_PATH)).toBe('https://erp.acme.test/mercato/api/acme/oauth/callback')
  })

  it('uses APP_URL even when the request comes from another allowed origin', () => {
    process.env.APP_URL = 'https://erp.acme.test'
    process.env.APP_ALLOWED_ORIGINS = 'https://admin.acme.test'
    const req = new Request('https://admin.acme.test/api/acme/oauth/initiate', { headers: { host: 'admin.acme.test' } })

    expect(resolveOAuthRedirectUri(req, CALLBACK_PATH)).toBe('https://erp.acme.test/api/acme/oauth/callback')
  })

  it('falls back to localhost outside production, never to the request origin', () => {
    process.env.NODE_ENV = 'development'
    const req = new Request('https://tunnel.example.test/api/acme/oauth/initiate', { headers: { host: 'tunnel.example.test' } })

    expect(resolveOAuthRedirectUri(req, CALLBACK_PATH)).toBe('http://localhost:3000/api/acme/oauth/callback')
    expect(resolveOAuthRedirectUri(undefined, '/')).toBe('http://localhost:3000/')
  })

  it('fails oauth_base_url_not_configured in production without APP_URL', () => {
    process.env.NODE_ENV = 'production'
    process.env.NEXT_PUBLIC_APP_URL = 'https://erp.acme.test'
    const req = new Request('https://erp.acme.test/api/acme/oauth/initiate')

    expect(grantErrorCode(() => resolveOAuthRedirectUri(req, CALLBACK_PATH))).toBe('oauth_base_url_not_configured')
    expect(grantErrorCode(() => resolveOAuthRedirectUri(undefined, '/'))).toBe('oauth_base_url_not_configured')
  })

  it('fails connect_origin_rejected for a request from a foreign origin', () => {
    process.env.APP_URL = 'https://erp.acme.test'
    const viaUrl = new Request('https://evil.example.test/api/acme/oauth/initiate')
    const viaForwardedHost = new Request('https://erp.acme.test/api/acme/oauth/initiate', {
      headers: { host: 'erp.acme.test', 'x-forwarded-host': 'evil.example.test' },
    })

    expect(grantErrorCode(() => resolveOAuthRedirectUri(viaUrl, CALLBACK_PATH))).toBe('connect_origin_rejected')
    expect(grantErrorCode(() => resolveOAuthRedirectUri(viaForwardedHost, CALLBACK_PATH))).toBe('connect_origin_rejected')
  })

  it('accepts no request when APP_URL is configured', () => {
    process.env.NODE_ENV = 'production'
    process.env.APP_URL = 'https://erp.acme.test'

    expect(resolveOAuthRedirectUri(undefined, CALLBACK_PATH)).toBe('https://erp.acme.test/api/acme/oauth/callback')
  })

  it('requires a path starting with a slash', () => {
    process.env.APP_URL = 'https://erp.acme.test'

    expect(() => resolveOAuthRedirectUri(undefined, 'api/acme/oauth/callback')).toThrow(/^\[internal\]/)
  })
})
