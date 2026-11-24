const mockEmitSecurityEvent = jest.fn().mockResolvedValue(undefined)
jest.mock('../../events', () => ({ emitSecurityEvent: mockEmitSecurityEvent }))

const mockLoggerWarn = jest.fn()
const mockLoggerError = jest.fn()
const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: jest.fn(),
    debug: jest.fn(),
    child: () => ({
      warn: mockLoggerWarn,
      error: mockLoggerError,
      info: jest.fn(),
      debug: jest.fn(),
    }),
  }),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { MFA_NO_METHODS_CONFIGURED_CODE } from '../../lib/mfa-error-codes'
import { interceptors } from '../interceptors'

type CreateChallengeMock = jest.Mock<
  Promise<{ challengeId: string; availableMethods: Array<{ type: string; label: string; icon: string }> }>,
  [string]
>

function createNoMfaMethodsError(): Error {
  return Object.assign(new Error('No MFA methods configured'), {
    name: 'MfaVerificationServiceError',
    statusCode: 400,
    code: MFA_NO_METHODS_CONFIGURED_CODE,
  })
}

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

  test('fails closed when challenge creation fails for an account with MFA methods', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const failure = new Error('db unavailable')
    const createChallenge = jest.fn(async () => {
      throw failure
    }) as CreateChallengeMock

    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    await expect(
      interceptor.after(
        { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
        { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
        buildContext(createChallenge),
      ),
    ).rejects.toThrow('db unavailable')

    expect(mockLoggerError).toHaveBeenCalledWith(
      'MFA challenge creation failed during auth/login; denying login',
      expect.objectContaining({ err: failure, code: 'security.mfa_challenge_creation_failed' }),
    )
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'security',
      code: 'security.mfa_challenge_creation_failed',
    })
  })

  test('fails closed on a plain non-Error object mimicking the no-MFA error code', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const spoofedError = {
      name: 'MfaVerificationServiceError',
      statusCode: 400,
      code: MFA_NO_METHODS_CONFIGURED_CODE,
    }
    const createChallenge = jest.fn(async () => {
      throw spoofedError
    }) as CreateChallengeMock

    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    await expect(
      interceptor.after(
        { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
        { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
        buildContext(createChallenge),
      ),
    ).rejects.toBe(spoofedError)
  })

  test('returns no-op when the account has no MFA methods configured', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const createChallenge = jest.fn(async () => {
      throw createNoMfaMethodsError()
    }) as CreateChallengeMock

    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result).toEqual({})
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), { module: 'security', code: 'security.sign_in_mfa_claims_invalid' })
  })

  test('fails closed when the MFA verification service is unavailable', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
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

    await expect(
      interceptor.after(
        { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
        { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
        context,
      ),
    ).rejects.toThrow('[internal] MFA verification service unavailable')

    expect(mockLoggerError).toHaveBeenCalledWith(
      'MFA verification service unavailable during auth/login; denying login',
      expect.objectContaining({ code: 'security.mfa_service_unavailable' }),
    )
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[internal] MFA verification service unavailable for auth/login' }),
      { module: 'security', code: 'security.mfa_service_unavailable' },
    )
  })

  test('still throws the fail-closed error when telemetry reporting throws', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    mockReportError.mockImplementationOnce(() => {
      throw new Error('telemetry collector offline')
    })
    const createChallenge = jest.fn(async () => {
      throw new Error('db unavailable')
    }) as CreateChallengeMock

    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
    await expect(
      interceptor.after(
        { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
        { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
        buildContext(createChallenge),
      ),
    ).rejects.toThrow('db unavailable')
  })

  test('skips MFA challenge injection when emergency bypass is enabled', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    const createChallenge = jest.fn(async () => ({
      challengeId: 'challenge-1',
      availableMethods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }],
    })) as CreateChallengeMock
    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result).toEqual({})
    expect(createChallenge).not.toHaveBeenCalled()
    expect(mockEmitSecurityEvent).toHaveBeenCalledWith('security.mfa.emergency_bypass_detected', expect.objectContaining({
      tenantId: 'tenant-1', organizationId: 'org-1',
    }), { persistent: true, tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'MFA emergency bypass is active',
      expect.objectContaining({
        emergencyBypass: true,
        context: 'login MFA challenge bypassed',
        userId: 'user-1',
      }),
    )
  })

  test('does not emit warning when bypass is enabled but token is invalid', async () => {
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

    expect(result).toEqual({})
    expect(createChallenge).not.toHaveBeenCalled()
    expect(mockEmitSecurityEvent).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledWith('Unable to record sign-in MFA outcome', { code: 'security.sign_in_mfa_claims_invalid' })
  })

  test('keeps the emergency bypass working when the verification service is unavailable', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
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

    expect(result).toEqual({})
    expect(mockEmitSecurityEvent).toHaveBeenCalledWith(
      'security.mfa.emergency_bypass_detected',
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      { persistent: true, tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  test('does not emit warning when bypass is disabled', async () => {
    if (!interceptor?.after) throw new Error('Expected security auth/login interceptor')

    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
    const createChallenge = jest.fn(async () => ({
      challengeId: 'challenge-1',
      availableMethods: [{ type: 'totp', label: 'Authenticator App', icon: 'Smartphone' }],
    })) as CreateChallengeMock
    const fullToken = signJwt({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })

    const result = await interceptor.after(
      { method: 'POST', url: 'http://localhost/api/auth/login', headers: {} },
      { statusCode: 200, body: { ok: true, token: fullToken }, headers: {} },
      buildContext(createChallenge),
    )

    expect(result.replace).toBeDefined()
    expect(mockEmitSecurityEvent).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledWith('Unable to record sign-in MFA outcome', { code: 'security.sign_in_mfa_claims_invalid' })
  })
})
