import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { interceptors } from '../interceptors'

type CreateChallengeMock = jest.Mock<
  Promise<{ challengeId: string; availableMethods: Array<{ type: string; label: string; icon: string }> }>,
  [string]
>

function buildContext(createChallenge: CreateChallengeMock) {
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

    const pendingClaims = verifyJwt(String(result.replace?.token))
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

  test('fails closed to no-op when challenge creation fails', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const createChallenge = jest.fn(async () => {
      throw new Error('db unavailable')
    }) as CreateChallengeMock

    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1' })
    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result).toEqual({})
  })

  test('skips MFA challenge injection when emergency bypass is enabled', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    const createChallenge = jest.fn(async () => ({
      challengeId: 'challenge-1',
      availableMethods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }],
    })) as CreateChallengeMock
    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1' })

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result).toEqual({})
    expect(createChallenge).not.toHaveBeenCalled()
  })
})
