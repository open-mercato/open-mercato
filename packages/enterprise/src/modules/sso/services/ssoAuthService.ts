import type { EntityManager } from '@mikro-orm/postgresql'
import { User, type Session } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
<<<<<<< HEAD
import { AuthSessionRejectedError } from '@open-mercato/core/modules/auth/lib/sessionEligibility'
=======
import { AuthSessionRejectedError, isAuthSessionRejectedError, matchesPasswordSessionProof, type PasswordSessionProof } from '@open-mercato/core/modules/auth/lib/sessionEligibility'
>>>>>>> 9934e0940a (fix(security): harden platform authorization and deployment defaults (#10543))
import { lockAuthorizationUserRows } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isSsoUserDeactivated } from '../lib/deactivation'

type SsoSessionScope = {
  tenantId: string | null
  organizationId: string
  ssoConfigId: string
}

const UNRESOLVED_PASSWORD_SCOPE = {
  userId: '00000000-0000-0000-0000-000000000000',
  tenantId: '00000000-0000-0000-0000-000000000000',
  organizationId: '00000000-0000-0000-0000-000000000000',
}

export class SsoAuthService extends AuthService {
  constructor(private ssoEm: EntityManager) {
    super(ssoEm)
  }

  override async verifyPassword(user: User | null, password: string): Promise<boolean> {
    const verified = await super.verifyPassword(user, password)
    const deactivated = await isSsoUserDeactivated(this.ssoEm, user ? {
      userId: user.id,
      tenantId: user.tenantId ?? null,
      organizationId: user.organizationId ?? null,
    } : UNRESOLVED_PASSWORD_SCOPE)
    return verified && !deactivated
  }

  override async createSession(
    user: User,
    expiresAt: Date,
    authority?: SsoSessionScope | PasswordSessionProof,
  ): Promise<{ session: Session; token: string }> {
    const scope = authority && 'ssoConfigId' in authority ? authority : undefined
    const proof = authority && 'kind' in authority ? authority : undefined
    return this.ssoEm.transactional(async (txEm) => {
      await lockAuthorizationUserRows(txEm, [user.id])
      const currentUser = await findOneWithDecryption(
        txEm, User,
        { id: user.id, tenantId: user.tenantId ?? null, organizationId: user.organizationId ?? null, deletedAt: null },
        { refresh: true },
        { tenantId: user.tenantId ?? null, organizationId: user.organizationId ?? null },
      )
      if (!currentUser || (proof && !matchesPasswordSessionProof(currentUser, proof))
        || await isSsoUserDeactivated(txEm, {
        userId: user.id,
        tenantId: scope ? scope.tenantId : currentUser.tenantId ?? null,
        organizationId: scope ? scope.organizationId : currentUser.organizationId ?? null,
        ...(scope ? { ssoConfigId: scope.ssoConfigId } : {}),
      })) {
        throw new AuthSessionRejectedError()
      }
      return this.createSessionWithEntityManager(txEm, currentUser, expiresAt)
    })
  }
}
