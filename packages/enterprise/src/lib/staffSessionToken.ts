import { signAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'

export type StaffSessionIdentity = {
  subject: string
  sessionId?: string | null
  tenantId: string | null
  organizationId: string | null
  email: string | null | undefined
  roles: string[]
}

type MfaState =
  | { stage: 'pending' }
  | {
      stage: 'verified'
      methods: string[]
      actorTenantId?: string
      actorOrgId?: string
      isSuperAdmin?: true
    }

export function issueStaffSessionToken(identity: StaffSessionIdentity, mfa?: MfaState): string {
  const claims = {
    sub: identity.subject,
    sid: identity.sessionId ?? undefined,
    tenantId: identity.tenantId,
    orgId: identity.organizationId,
    email: identity.email,
    roles: identity.roles,
  }

  if (!mfa) return signAudienceJwt('staff', claims)
  if (mfa.stage === 'pending') {
    return signAudienceJwt('staff', { ...claims, mfa_pending: true, mfa_verified: false }, 10 * 60)
  }

  return signAudienceJwt('staff', {
    ...claims,
    mfa_pending: false,
    mfa_verified: true,
    mfa_methods: mfa.methods,
    actorTenantId: mfa.actorTenantId,
    actorOrgId: mfa.actorOrgId,
    isSuperAdmin: mfa.isSuperAdmin,
  })
}
