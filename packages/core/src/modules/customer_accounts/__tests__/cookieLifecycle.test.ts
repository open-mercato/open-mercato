/**
 * @jest-environment node
 *
 * Phase 7 cookie-lifecycle test for the portal session cookies.
 *
 * - readCookieFromHeader parser semantics (the inverse of every Set-Cookie below)
 * - login route cookie set: name, httpOnly, SameSite, TTL
 * - logout route cookie clear: maxAge=0 with matching attributes
 *
 * The cookie-attribute invariants are part of the SPA CSRF posture documented
 * in packages/ui/agentic/standalone-guide.md → "Portal SPA CSRF Posture".
 * If any of these flags drift (e.g. SameSite changes from lax, httpOnly is
 * dropped, or TTLs change), the doc and the threat model both need an update.
 */

import { randomUUID } from 'crypto'

const tenantId = randomUUID()
const orgId = randomUUID()

const customerUserService = {
  findByEmail: jest.fn(async () => ({
    id: 'u-1',
    email: 'u@example.com',
    displayName: 'U',
    passwordHash: 'hash',
    tenantId,
    organizationId: orgId,
    emailVerifiedAt: new Date(),
    deletedAt: null,
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
  })),
  verifyPassword: jest.fn(async () => true),
  checkLockout: jest.fn(() => false),
  incrementFailedAttempts: jest.fn(async () => undefined),
  resetFailedAttempts: jest.fn(async () => undefined),
  updateLastLoginAt: jest.fn(async () => undefined),
}

const customerSessionService = {
  createSession: jest.fn(async () => ({
    rawToken: 'raw-session-token',
    jwt: 'jwt.signed.value',
    session: { id: 's-1' },
  })),
  findByToken: jest.fn(async () => ({ id: 's-1' })),
  revokeSession: jest.fn(async () => undefined),
}

const customerRbacService = {
  loadAcl: jest.fn(async () => ({ features: ['portal.view'], isPortalAdmin: false })),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'customerUserService') return customerUserService
      if (name === 'customerSessionService') return customerSessionService
      if (name === 'customerRbacService') return customerRbacService
      if (name === 'em') return {}
      return null
    },
  }),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: jest.fn(async () => ({ error: null, compoundKey: null })),
  resetAuthRateLimit: jest.fn(async () => undefined),
  customerLoginRateLimitConfig: {},
  customerLoginIpRateLimitConfig: {},
  consumeAuthRateLimit: jest.fn(async () => ({ ok: true })),
  customerAccountsRateLimit: { login: { points: 5, durationSec: 60 } },
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn(async () => undefined),
}))

import { readCookieFromHeader } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { POST as loginPOST } from '@open-mercato/core/modules/customer_accounts/api/login'
import { POST as logoutPOST } from '@open-mercato/core/modules/customer_accounts/api/portal/logout'

function readSetCookies(res: Response): Array<{ name: string; value: string; raw: string }> {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  const all: string[] = []
  if (typeof headers.getSetCookie === 'function') {
    all.push(...headers.getSetCookie())
  } else {
    headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') all.push(value)
    })
  }
  return all.map((raw) => {
    const eq = raw.indexOf('=')
    const name = raw.slice(0, eq)
    const value = raw.slice(eq + 1).split(';')[0]
    return { name, value, raw }
  })
}

function attrs(raw: string): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  raw.split(';').slice(1).forEach((p) => {
    const trimmed = p.trim()
    if (!trimmed) return
    const eq = trimmed.indexOf('=')
    if (eq === -1) out[trimmed.toLowerCase()] = true
    else out[trimmed.slice(0, eq).toLowerCase()] = trimmed.slice(eq + 1)
  })
  return out
}

describe('readCookieFromHeader (portal cookie read lifecycle)', () => {
  it('returns the value for the named cookie', () => {
    const header = 'foo=bar; customer_auth_token=eyJ.A.B; customer_session_token=raw-token-123'
    expect(readCookieFromHeader(header, 'customer_auth_token')).toBe('eyJ.A.B')
    expect(readCookieFromHeader(header, 'customer_session_token')).toBe('raw-token-123')
  })

  it('handles a single-cookie header', () => {
    expect(readCookieFromHeader('customer_session_token=abc', 'customer_session_token')).toBe('abc')
  })

  it('returns undefined for a missing cookie', () => {
    expect(readCookieFromHeader('foo=bar', 'customer_auth_token')).toBeUndefined()
  })

  it('returns undefined when the header is empty or null', () => {
    expect(readCookieFromHeader('', 'customer_auth_token')).toBeUndefined()
    expect(readCookieFromHeader(null, 'customer_auth_token')).toBeUndefined()
    expect(readCookieFromHeader(undefined, 'customer_auth_token')).toBeUndefined()
  })

  it('does not treat a longer cookie name as a match for a shorter one', () => {
    expect(readCookieFromHeader('customer_auth_token_v2=foo', 'customer_auth_token')).toBeUndefined()
  })

  it('preserves URL-encoded values verbatim (caller decodes)', () => {
    const encoded = encodeURIComponent('a/b+c=d')
    expect(readCookieFromHeader(`customer_session_token=${encoded}`, 'customer_session_token')).toBe(encoded)
  })
})

describe('login.POST cookie issue lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('issues both cookies with httpOnly + SameSite=lax + matching TTLs + path=/', async () => {
    const req = new Request('http://localhost/api/customer_accounts/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'u@example.com', password: 'pw', tenantId }),
    })

    const res = await loginPOST(req)
    expect(res.status).toBe(200)

    const cookies = readSetCookies(res)
    const auth = cookies.find((c) => c.name === 'customer_auth_token')
    const session = cookies.find((c) => c.name === 'customer_session_token')

    expect(auth?.value).toBe('jwt.signed.value')
    expect(session?.value).toBe('raw-session-token')

    const authAttrs = attrs(auth!.raw)
    expect(authAttrs.httponly).toBe(true)
    expect(String(authAttrs.samesite).toLowerCase()).toBe('lax')
    expect(Number(authAttrs['max-age'])).toBe(60 * 60 * 8)
    expect(authAttrs.path).toBe('/')

    const sessAttrs = attrs(session!.raw)
    expect(sessAttrs.httponly).toBe(true)
    expect(String(sessAttrs.samesite).toLowerCase()).toBe('lax')
    expect(Number(sessAttrs['max-age'])).toBe(60 * 60 * 24 * 30)
    expect(sessAttrs.path).toBe('/')
  })
})

describe('logout.POST cookie clear lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('clears both cookies with maxAge=0 and matching attributes; revokes the session server-side', async () => {
    const req = new Request('http://localhost/api/customer_accounts/portal/logout', {
      method: 'POST',
      headers: { cookie: 'customer_session_token=raw-session-token; customer_auth_token=jwt' },
    })

    const res = await logoutPOST(req)
    expect(res.status).toBe(200)

    const cookies = readSetCookies(res)
    const auth = cookies.find((c) => c.name === 'customer_auth_token')
    const session = cookies.find((c) => c.name === 'customer_session_token')

    expect(auth?.value).toBe('')
    expect(session?.value).toBe('')

    const authAttrs = attrs(auth!.raw)
    const sessAttrs = attrs(session!.raw)
    expect(Number(authAttrs['max-age'])).toBe(0)
    expect(Number(sessAttrs['max-age'])).toBe(0)
    expect(authAttrs.httponly).toBe(true)
    expect(sessAttrs.httponly).toBe(true)
    expect(String(authAttrs.samesite).toLowerCase()).toBe('lax')
    expect(String(sessAttrs.samesite).toLowerCase()).toBe('lax')

    expect(customerSessionService.findByToken).toHaveBeenCalledWith('raw-session-token')
    expect(customerSessionService.revokeSession).toHaveBeenCalledWith('s-1')
  })
})
