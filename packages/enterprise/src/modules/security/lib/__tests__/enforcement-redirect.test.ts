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

  test('fails closed to enrollment when the enforcement service is unavailable (#3853)', async () => {
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

  test('fails closed to enrollment when service resolution throws (#3853)', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => {
            throw new Error('DI failure')
          },
        },
      }),
    )
    expect(redirect).toContain('reason=mfa_enrollment_required')
  })

  test('fails closed to enrollment when the compliance check throws (#3853)', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        container: {
          resolve: () => ({
            checkUserCompliance: async () => {
              throw new Error('transient db error')
            },
          }),
        },
      }),
    )
    expect(redirect).toBe(
      '/backend/profile/security/mfa?redirect=%2Fbackend%2Fcustomers%2Fpeople&reason=mfa_enrollment_required',
    )
  })

  test('keeps the enrollment page reachable during the fail-closed state', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        pathname: '/backend/profile/security/mfa',
        container: {
          resolve: () => {
            throw new Error('DI failure')
          },
        },
      }),
    )
    expect(redirect).toBeNull()
  })

  test('does not fail closed for a tenant-less principal', async () => {
    const redirect = await resolveMfaEnrollmentRedirect(
      buildArgs({
        auth: {
          sub: 'user-1',
          tenantId: null,
          orgId: null,
          roles: ['superadmin'],
        } as ResolveArgs['auth'],
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
  })
})
