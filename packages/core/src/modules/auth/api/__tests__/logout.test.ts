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
const mockEmitAuthEvent = jest.fn(async (_eventId: string, _payload: Record<string, unknown>, _options?: Record<string, unknown>) => undefined)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/auth/events', () => ({
  emitAuthEvent: (eventId: string, payload: Record<string, unknown>, options?: Record<string, unknown>) =>
    mockEmitAuthEvent(eventId, payload, options),
}))

jest.mock('@open-mercato/core/modules/auth/lib/requestRedirect', () => {
  const { NextResponse } = require('next/server')
  return {
    buildSafeRedirectResponse: (_req: Request, path: string) =>
      new NextResponse(null, { status: 307, headers: { Location: `http://localhost${path}` } }),
  }
})

import * as logoutRoute from '@open-mercato/core/modules/auth/api/logout'
import { POST } from '@open-mercato/core/modules/auth/api/logout'

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-unit-tests'
})

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

describe('POST /api/auth/logout — auth.logout event', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('emits auth.logout with the identity carried by the auth_token', async () => {
    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: buildAuthToken() }) },
    })

    await POST(req)

    expect(mockEmitAuthEvent).toHaveBeenCalledWith('auth.logout', {
      id: userId,
      tenantId: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt',
      organizationId: 'oooooooo-oooo-4ooo-8ooo-oooooooooooo',
      sessionId,
      sessionRevoked: true,
      at: expect.any(String),
    }, { persistent: true })
  })

  it('reports sessionRevoked false when server-side revocation failed', async () => {
    deleteSessionById.mockRejectedValueOnce(new Error('database unavailable'))

    const res = await POST(new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: buildAuthToken() }) },
    }))

    expect(mockEmitAuthEvent).toHaveBeenCalledWith(
      'auth.logout',
      expect.objectContaining({ id: userId, sessionRevoked: false }),
      { persistent: true },
    )
    expect(res.headers.get('set-cookie') ?? '').toContain('auth_token=;')
  })

  it('reports a null session id when the token predates the sid claim', async () => {
    const legacyToken = signJwt({
      sub: userId,
      tenantId: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt',
      orgId: 'oooooooo-oooo-4ooo-8ooo-oooooooooooo',
      email: 'user@example.test',
      roles: ['admin'],
    })

    await POST(new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: legacyToken }) },
    }))

    expect(mockEmitAuthEvent).toHaveBeenCalledWith(
      'auth.logout',
      expect.objectContaining({ id: userId, sessionId: null }),
      { persistent: true },
    )
  })

  it('identifies the user by id only, keeping the email out of the durable payload', async () => {
    await POST(new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: buildAuthToken() }) },
    }))

    expect(mockEmitAuthEvent).toHaveBeenCalledTimes(1)
    const payload = mockEmitAuthEvent.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('email')
    expect(JSON.stringify(payload)).not.toContain('user@example.test')
  })

  it('does not emit when no verifiable auth_token identifies the caller', async () => {
    await POST(new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: 'not-a-valid-jwt', session_token: 'remember-me-token' }) },
    }))

    expect(mockEmitAuthEvent).not.toHaveBeenCalled()
  })

  it('still clears cookies when the event bus rejects', async () => {
    mockEmitAuthEvent.mockRejectedValueOnce(new Error('event bus down'))

    const res = await POST(new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: buildCookieHeader({ auth_token: buildAuthToken() }) },
    }))

    expect(res.status).toBe(307)
    expect(res.headers.get('set-cookie') ?? '').toContain('auth_token=;')
  })
})

describe('logout route — CSRF hardening (POST-only)', () => {
  it('does not expose a GET handler so a cross-origin embed cannot trigger logout', () => {
    expect((logoutRoute as Record<string, unknown>).GET).toBeUndefined()
  })

  it('declares only POST in route metadata', () => {
    expect(Object.keys(logoutRoute.metadata)).toEqual(['POST'])
  })

  it('documents only POST in the OpenAPI spec', () => {
    expect(Object.keys(logoutRoute.openApi.methods)).toEqual(['POST'])
  })
})
