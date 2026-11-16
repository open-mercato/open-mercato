const mockEmitSecurityEvent = jest.fn().mockResolvedValue(undefined)
jest.mock('../../events', () => ({ emitSecurityEvent: mockEmitSecurityEvent }))

const mockLoggerError = jest.fn()
const mockLoggerWarn = jest.fn()
const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

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
    mockEmitSecurityEvent.mockReset().mockResolvedValue(undefined)
    mockReportError.mockClear()
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
    expect(mockEmitSecurityEvent).toHaveBeenCalledWith('security.mfa.emergency_bypass_detected', expect.objectContaining({
      tenantId: 'tenant-1', organizationId: 'org-1',
    }), { persistent: true, tenantId: 'tenant-1', organizationId: 'org-1' })
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

  test.each<[string, ResolveArgs['container']]>([
    ['non-compliant user', buildArgs().container],
    ['unavailable enforcement service', { resolve: () => null }],
    ['failed compliance check', {
      resolve: () => ({
        checkUserCompliance: async () => {
          throw new Error('compliance unavailable')
        },
      }),
    }],
  ])('does not wait for the notification enqueue in the %s case', async (_scenario, container) => {
    jest.useFakeTimers()
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    let rejectEnqueue: (error: Error) => void = () => {}
    mockEmitSecurityEvent.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectEnqueue = reject
    }))
    let completed = false
    const redirect = resolveMfaEnrollmentRedirect(buildArgs({ container })).then((result) => {
      completed = true
      return result
    })

    try {
      await jest.advanceTimersByTimeAsync(0)
      expect(completed).toBe(true)
      await expect(redirect).resolves.toBeNull()
      expect(mockEmitSecurityEvent).toHaveBeenCalledTimes(1)
      expect(mockEmitSecurityEvent).toHaveBeenCalledWith(
        'security.mfa.emergency_bypass_detected',
        expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
        { persistent: true, tenantId: 'tenant-1', organizationId: 'org-1' },
      )
      expect(mockReportError).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(2_000)
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unable to enqueue MFA emergency bypass notification',
        { err: expect.any(Error) },
      )
      expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), {
        module: 'security', code: 'security.mfa_bypass_notification_failed',
      })
      rejectEnqueue(new Error('late queue failure'))
      await jest.advanceTimersByTimeAsync(0)
      expect(mockReportError).toHaveBeenCalledTimes(1)
    } finally {
      rejectEnqueue(new Error('queue unavailable'))
      await redirect
      await jest.advanceTimersByTimeAsync(0)
      jest.useRealTimers()
    }
  })

  test('reports a rejected notification enqueue without blocking navigation', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'
    const failure = new Error('queue unavailable')
    mockEmitSecurityEvent.mockRejectedValueOnce(failure)

    await expect(resolveMfaEnrollmentRedirect(buildArgs())).resolves.toBeNull()
    await Promise.resolve()

    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'security', code: 'security.mfa_bypass_notification_failed',
    })
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
    expect(mockEmitSecurityEvent).not.toHaveBeenCalled()
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
    expect(mockEmitSecurityEvent).not.toHaveBeenCalled()
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
    expect(mockEmitSecurityEvent).not.toHaveBeenCalled()
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
    expect(mockEmitSecurityEvent).not.toHaveBeenCalled()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  test('does not emit warning for exempt path even when bypass is enabled', async () => {
    process.env.OM_SECURITY_MFA_EMERGENCY_BYPASS = 'true'

    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({ pathname: '/backend/profile/security/mfa' }),
    )

    expect(redirect).toBeNull()
    expect(mockEmitSecurityEvent).not.toHaveBeenCalled()
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })
})
