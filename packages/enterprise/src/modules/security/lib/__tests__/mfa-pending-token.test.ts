import { signJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { signPendingMfaToken, verifyPendingMfaToken } from '../mfa-pending-token'

describe('pending MFA token', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'pending-mfa-test-secret'
  })

  test('uses a dedicated audience that the staff verifier rejects', () => {
    const token = signPendingMfaToken({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      email: 'user@example.com',
      roles: ['admin'],
    })

    expect(verifyJwt(token)).toBeNull()
    expect(verifyPendingMfaToken(token)).toMatchObject({
      sub: 'user-1',
      sid: 'session-1',
      mfa_pending: true,
      mfa_verified: false,
    })
  })

  test('rejects a normal staff token', () => {
    const token = signJwt({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    })

    expect(verifyPendingMfaToken(token)).toBeNull()
  })
})
