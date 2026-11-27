import { randomBytes } from 'node:crypto'
import { verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import { issueVerifiedMfaToken } from '../_shared'

describe('verified MFA session token', () => {
  beforeEach(() => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      JWT_SECRET: randomBytes(32).toString('hex'),
    })
  })

  afterEach(() => jest.restoreAllMocks())

  it('preserves the authorized session and actor identity after MFA completes', () => {
    const token = issueVerifiedMfaToken({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      email: 'user@example.com',
      roles: ['owner'],
      actorTenantId: 'actor-tenant-1',
      actorOrgId: 'actor-org-1',
      isSuperAdmin: true,
    }, ['totp'])

    const claims = verifyAudienceJwt('staff', token)
    expect(claims).toMatchObject({
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
      email: 'user@example.com',
      roles: ['owner'],
      actorTenantId: 'actor-tenant-1',
      actorOrgId: 'actor-org-1',
      isSuperAdmin: true,
      mfa_pending: false,
      mfa_verified: true,
      mfa_methods: ['totp'],
    })
    expect(claims?.exp - claims?.iat).toBe(8 * 60 * 60)
    expect(verifyAudienceJwt('customer', token)).toBeNull()
  })

  it('keeps optional claims omitted when no session or actor claim was supplied', () => {
    const token = issueVerifiedMfaToken({ sub: 'user-1', tenantId: null, orgId: null }, ['totp'])

    const claims = verifyAudienceJwt('staff', token)
    expect(claims).toMatchObject({ sub: 'user-1', tenantId: null, orgId: null, email: null, roles: [] })
    expect(claims).not.toHaveProperty('sid')
    expect(claims).not.toHaveProperty('actorTenantId')
    expect(claims).not.toHaveProperty('actorOrgId')
    expect(claims).not.toHaveProperty('isSuperAdmin')
  })
})
