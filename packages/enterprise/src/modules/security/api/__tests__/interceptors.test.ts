const mockLoggerWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    warn: mockLoggerWarn,
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: () => ({
      warn: mockLoggerWarn,
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    }),
  }),
}))

import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { verifyPendingMfaToken } from '../../lib/mfa-pending-token'
import { interceptors } from '../interceptors'

type CreateChallengeMock = jest.Mock<
  Promise<{ challengeId: string; availableMethods: Array<{ type: string; label: string; icon: string }> }>,
  [string]
>

function buildContext(
  createChallenge: CreateChallengeMock,
  hasChallengeMethods: jest.Mock<Promise<boolean>, [string]> = jest.fn(async () => true),
) {
  return {
    userId: '',
    organizationId: '',
    tenantId: '',
    em: {} as InterceptorContext['em'],
    container: {
      resolve(name: string) {
        if (name === 'mfaVerificationService') {
          return {
            createChallenge,
            hasChallengeMethods,
          }
        }
        throw new Error(`Unknown service: ${name}`)
      },
    },
  } as InterceptorContext
}

describe('security auth/login api interceptor', () => {
  const interceptor = interceptors.find((item) => item.id === 'security.auth.login.mfa-challenge')

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
    jest.clearAllMocks()
    mockLoggerWarn.mockClear()
  })

  test('returns no-op when response is not a successful auth payload', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const createChallenge = jest.fn() as CreateChallengeMock
    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 401, body: { ok: false }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result).toEqual({})
    expect(createChallenge).not.toHaveBeenCalled()
  })

  test('rewrites successful login response when user has MFA methods', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const createChallenge = jest.fn(async () => ({
      challengeId: 'challenge-1',
      availableMethods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }],
    })) as CreateChallengeMock

    const fullToken = signJwt({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      email: 'user@example.com',
      roles: ['admin'],
    })

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken, redirect: '/backend' }, headers: {} },
      buildContext(createChallenge),
    )

    expect(createChallenge).toHaveBeenCalledWith('user-1')
    expect(result.replace).toMatchObject({
      ok: true,
      mfa_required: true,
      challenge_id: 'challenge-1',
      available_methods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }],
    })
    expect(typeof result.replace?.token).toBe('string')

    expect(verifyJwt(String(result.replace?.token))).toBeNull()
    const pendingClaims = verifyPendingMfaToken(String(result.replace?.token))
    expect(pendingClaims).toMatchObject({
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      email: 'user@example.com',
      roles: ['admin'],
      mfa_pending: true,
      mfa_verified: false,
    })
  })

  test('fails closed when challenge creation fails', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const createChallenge = jest.fn(async () => {
      throw new Error('db unavailable')
    }) as CreateChallengeMock

    const fullToken = signJwt({ sub: 'user-1', sid: 'session-1', tenantId: 'tenant-1' })
    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result).toEqual({
      replace: {
        ok: false,
        code: 'MFA_UNAVAILABLE',
        error: 'Multi-factor authentication is temporarily unavailable. Please try again.',
      },
    })
  })

  test('keeps password login unchanged when the user has no active MFA methods', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const createChallenge = jest.fn() as CreateChallengeMock
    const hasChallengeMethods = jest.fn(async () => false)
    const fullToken = signJwt({ sub: 'user-1', sid: 'session-1', tenantId: 'tenant-1' })
    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge, hasChallengeMethods),
    )

    expect(result).toEqual({})
    expect(createChallenge).not.toHaveBeenCalled()
  })

  test('skips MFA challenge injection when emergency bypass is enabled', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    const createChallenge = jest.fn(async () => ({
      challengeId: 'challenge-1',
      availableMethods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }],
    })) as CreateChallengeMock
    const fullToken = signJwt({ sub: 'user-1', sid: 'session-1', tenantId: 'tenant-1' })

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result).toEqual({})
    expect(createChallenge).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'MFA emergency bypass is active',
      expect.objectContaining({
        emergencyBypass: true,
        context: 'login MFA challenge bypassed',
        userId: 'user-1',
      }),
    )
  })

  test('fails closed without warning when bypass is enabled but token is invalid', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    const createChallenge = jest.fn(async () => ({
      challengeId: 'challenge-1',
      availableMethods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }],
    })) as CreateChallengeMock

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: 'invalid-token' }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result).toEqual({
      replace: {
        ok: false,
        code: 'MFA_UNAVAILABLE',
        error: 'Multi-factor authentication is temporarily unavailable. Please try again.',
      },
    })
    expect(createChallenge).not.toHaveBeenCalled()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('fails closed without warning when bypass is enabled but verification service is unavailable', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    const fullToken = signJwt({ sub: 'user-1', sid: 'session-1', tenantId: 'tenant-1' })
    const context = {
      userId: '',
      organizationId: '',
      tenantId: '',
      em: {} as InterceptorContext['em'],
      container: {
        resolve: () => {
          throw new Error('no service')
        },
      },
    } as unknown as InterceptorContext

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      context,
    )

    expect(result).toEqual({
      replace: {
        ok: false,
        code: 'MFA_UNAVAILABLE',
        error: 'Multi-factor authentication is temporarily unavailable. Please try again.',
      },
    })
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('does not emit warning when bypass is disabled', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
    const createChallenge = jest.fn(async () => ({
      challengeId: 'challenge-1',
      availableMethods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }],
    })) as CreateChallengeMock
    const fullToken = signJwt({ sub: 'user-1', sid: 'session-1', tenantId: 'tenant-1' })

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result.replace).toBeDefined()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})
