var mockLoggerError = jest.fn()
var mockLoggerWarn = jest.fn()

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

import { resolveMfaEnrollmentRedirect } from '../enforcement-redirect'

type ResolveArgs = Parameters<typeof resolveMfaEnrollmentRedirect>[0]

function buildArgs(overrides?: Partial<ResolveArgs>): ResolveArgs {
  return {
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      roles: ['employee'],
    },
    pathname: '/backend/customers/people',
    container: {
      resolve: () => ({
        checkUserCompliance: async () => ({
          compliant: false,
          enforced: true,
        }),
      }),
    },
    ...overrides,
  }
}

describe('resolveMfaEnrollmentRedirect', () => {
  beforeEach(() => {
    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS
    mockLoggerError.mockClear()
    mockLoggerWarn.mockClear()
  })

  test('returns redirect immediately when deadline is not set', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(buildArgs())
    expect(redirect).toBe(
      '/backend/profile/security/mfa?redirect=%2Fbackend%2Fcustomers%2Fpeople&reason=mfa_enrollment_required',
    )
  })

  test('returns null for exempt security path', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({ pathname: '/backend/profile/security/mfa' }),
    )
    expect(redirect).toBeNull()
  })

  test('returns null when compliance is satisfied', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => ({
              compliant: true,
              enforced: true,
            }),
          }),
        },
      }),
    )
    expect(redirect).toBeNull()
  })

  test('redirects when enforcement service is unavailable for a tenant user', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => null,
        },
      }),
    )
    expect(redirect).toBe(
      '/backend/profile/security/mfa?redirect=%2Fbackend%2Fcustomers%2Fpeople&reason=mfa_enrollment_required',
    )
  })

  test('logs a diagnostic shape when the enforcement service is malformed', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({ configured: true }),
        },
      }),
    )

    expect(redirect).toContain('reason=mfa_enrollment_required')
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Unable to resolve MFA enforcement service; redirecting to enrollment',
      { err: expect.any(TypeError) },
    )
    const error = mockLoggerError.mock.calls[0]?.[1]?.err
    expect(error).toBeInstanceOf(TypeError)
    expect((error as TypeError).message).toContain('object with keys: configured')
  })

  test('redirects when resolving the enforcement service throws', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => {
            throw new Error('unavailable')
          },
        },
      }),
    )

    expect(redirect).toContain('reason=mfa_enrollment_required')
  })

  test('redirects when the compliance check throws for a tenant user', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => {
              throw new Error('compliance unavailable')
            },
          }),
        },
      }),
    )

    expect(redirect).toContain('reason=mfa_enrollment_required')
  })

  test('does not fail closed for a tenant-less user', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        auth: {
          ...buildArgs().auth,
          tenantId: null,
        },
        container: {
          resolve: () => null,
        },
      }),
    )

    expect(redirect).toBeNull()
  })

  test('does not fail closed for an empty tenant id', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        auth: {
          ...buildArgs().auth,
          tenantId: '',
        },
        container: {
          resolve: () => null,
        },
      }),
    )

    expect(redirect).toBeNull()
  })

  test('returns null when deadline is set but not overdue', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => ({
              compliant: false,
              enforced: true,
              deadline: new Date(Date.now() + 60_000),
            }),
          }),
        },
      }),
    )
    expect(redirect).toBeNull()
  })

  test('marks redirect as overdue when deadline has passed', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => ({
              compliant: false,
              enforced: true,
              deadline: new Date(Date.now() - 60_000),
            }),
          }),
        },
      }),
    )
    expect(redirect).toContain('overdue=1')
  })

  test('returns null when MFA emergency bypass is enabled', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'

    const redirect = await resolveMfaEnrollmentRedirect(buildArgs())

    expect(redirect).toBeNull()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'MFA emergency bypass is active',
      expect.objectContaining({
        emergencyBypass: true,
        context: 'mfa-enrollment-redirect bypassed',
        userId: 'user-1',
        pathname: '/backend/customers/people',
      }),
    )
  })

  test('does not emit warning when bypass is enabled but user is compliant', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'

    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => ({
              compliant: true,
              enforced: true,
            }),
          }),
        },
      }),
    )

    expect(redirect).toBeNull()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('does not emit warning when bypass is enabled but enforcement is not enforced', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'

    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => ({
              compliant: false,
              enforced: false,
            }),
          }),
        },
      }),
    )

    expect(redirect).toBeNull()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('does not emit warning when bypass is enabled but deadline is not overdue', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'

    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => ({
              compliant: false,
              enforced: true,
              deadline: new Date(Date.now() + 60_000),
            }),
          }),
        },
      }),
    )

    expect(redirect).toBeNull()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('emits warning when bypass prevents redirect due to unavailable enforcement service', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'

    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => null,
        },
      }),
    )

    expect(redirect).toBeNull()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'MFA emergency bypass is active',
      expect.objectContaining({
        context: 'mfa-enrollment-redirect bypassed',
        reason: 'enforcement-service-unavailable',
      }),
    )
  })

  test('emits warning when bypass prevents redirect due to compliance check failure', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'

    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => {
              throw new Error('compliance unavailable')
            },
          }),
        },
      }),
    )

    expect(redirect).toBeNull()
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'MFA emergency bypass is active',
      expect.objectContaining({
        context: 'mfa-enrollment-redirect bypassed',
        reason: 'compliance-check-failed',
      }),
    )
  })

  test('does not emit warning when bypass is disabled even though redirect would occur', async () => {
    delete process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS

    const redirect = await resolveMfaEnrollmentRedirect(buildArgs())

    expect(redirect).toContain('reason=mfa_enrollment_required')
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('does not emit warning for exempt path even when bypass is enabled', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'

    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({ pathname: '/backend/profile/security/mfa' }),
    )

    expect(redirect).toBeNull()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})
