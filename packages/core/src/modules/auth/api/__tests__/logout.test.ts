/** @jest-environment node */
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'

const deleteSessionById = jest.fn()
const deleteSessionByToken = jest.fn()
const containerResolve = jest.fn((name: string) => {
  if (name === 'authService') {
    return { deleteSessionById, deleteSessionByToken }
  }
  return null
})
const createRequestContainer = jest.fn(async () => ({ resolve: containerResolve }))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/auth/lib/requestRedirect', () => ({
  buildRequestOriginUrl: (_req: Request, path: string) => `http://localhost${path}`,
}))

import { POST } from '@open-mercato/core/modules/auth/api/logout'

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function buildAuthToken(overrides: Record<string, unknown> = {}): string {
  return signJwt({
    sub: userId,
    sid: sessionId,
    tenantId: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt',
    orgId: 'oooooooo-oooo-4ooo-8ooo-oooooooooooo',
    email: 'user@example.test',
    roles: ['admin'],
    ...overrides,
  })
}

function buildCookieHeader(parts: Record<string, string>): string {
  return Object.entries(parts)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

describe('POST /api/auth/logout — session revocation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('revokes the session referenced by the auth_token JWT sid claim', async () => {
    const authToken = buildAuthToken()
    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: authToken }) },
    })

    const res = await POST(req)

    expect(deleteSessionById).toHaveBeenCalledWith(sessionId)
    expect(res.status).toBe(307) // NextResponse.redirect default
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('auth_token=;')
    expect(setCookie).toContain('session_token=;')
  })

  it('revokes the remember-me session_token cookie as well when present', async () => {
    const authToken = buildAuthToken()
    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: buildCookieHeader({ auth_token: authToken, session_token: 'remember-me-token' }),
      },
    })

    await POST(req)

    expect(deleteSessionById).toHaveBeenCalledWith(sessionId)
    expect(deleteSessionByToken).toHaveBeenCalledWith('remember-me-token')
  })

  it('clears cookies even when no session cookies are present (idempotent logout)', async () => {
    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: '' },
    })

    const res = await POST(req)

    expect(deleteSessionById).not.toHaveBeenCalled()
    expect(deleteSessionByToken).not.toHaveBeenCalled()
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('auth_token=;')
    expect(setCookie).toContain('session_token=;')
  })

  it('ignores an auth_token JWT that cannot be verified (expired / tampered)', async () => {
    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: 'not-a-valid-jwt' }) },
    })

    const res = await POST(req)

    expect(deleteSessionById).not.toHaveBeenCalled()
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('auth_token=;')
  })

  it('ignores an auth_token JWT that is missing an sid claim (legacy token)', async () => {
    const legacyToken = signJwt({
      sub: userId,
      tenantId: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt',
      orgId: 'oooooooo-oooo-4ooo-8ooo-oooooooooooo',
      email: 'user@example.test',
      roles: ['admin'],
    })

    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: legacyToken }) },
    })

    await POST(req)

    expect(deleteSessionById).not.toHaveBeenCalled()
  })
})
