const mockLoggerError = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ error: mockLoggerError }),
  }),
}))

jest.mock('../../i18n', () => ({
  localizeSecurityApiBody: async (body: Record<string, unknown>) => body,
  securityApiError: async (status: number, message: string) => Response.json({ error: message }, { status }),
}))

import type { MfaRequestContext } from '../_shared'
import { authorizeMfaEnrollmentMutation } from '../_shared'

type AuthorizationContext = Pick<MfaRequestContext, 'auth' | 'container'>

function buildContext(options: {
  compliance?: { compliant: boolean; enforced: boolean } | Error
  hasManageFeature?: boolean
  tenantId?: string | null
} = {}): AuthorizationContext {
  const rbacService = {
    userHasAllFeatures: async () => options.hasManageFeature ?? false,
  }
  const enforcementService = {
    checkUserCompliance: async () => {
      if (options.compliance instanceof Error) throw options.compliance
      return options.compliance ?? { compliant: true, enforced: false }
    },
  }
  const container = {
    resolve<T>(name: string): T {
      if (name === 'rbacService') return rbacService as T
      if (name === 'mfaEnforcementService') return enforcementService as T
      throw new Error(`[internal] Unexpected test service: ${name}`)
    },
  } as unknown as MfaRequestContext['container']

  return {
    auth: {
      sub: 'user-1',
      tenantId: options.tenantId === undefined ? 'tenant-1' : options.tenantId,
      orgId: 'org-1',
      roles: ['employee'],
    },
    container,
  }
}

describe('authorizeMfaEnrollmentMutation', () => {
  beforeEach(() => {
    mockLoggerError.mockClear()
  })

  test('allows callers granted security.mfa.manage', async () => {
    await expect(authorizeMfaEnrollmentMutation(buildContext({ hasManageFeature: true })))
      .resolves.toBeNull()
  })

  test('allows a tenant user compelled to enroll by an active policy', async () => {
    await expect(authorizeMfaEnrollmentMutation(buildContext({
      compliance: { compliant: false, enforced: true },
    }))).resolves.toBeNull()
  })

  test('denies a caller without the feature when enrollment is not compelled', async () => {
    const response = await authorizeMfaEnrollmentMutation(buildContext())
    expect(response?.status).toBe(403)
  })

  test('keeps the compelled enrollment recovery path open when enforcement verification fails', async () => {
    await expect(authorizeMfaEnrollmentMutation(buildContext({
      compliance: new Error('unavailable'),
    }))).resolves.toBeNull()
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Unable to verify compelled MFA enrollment authorization; allowing enrollment recovery path',
      { err: expect.any(Error) },
    )
  })

  test.each([null, ''] as const)(
    'does not grant the enforcement exemption to tenant-less context %p',
    async (tenantId) => {
      const response = await authorizeMfaEnrollmentMutation(buildContext({
        compliance: { compliant: false, enforced: true },
        tenantId,
      }))
      expect(response?.status).toBe(403)
    },
  )
})
