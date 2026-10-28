import type { EntityManager } from '@mikro-orm/postgresql'
import { User, type Session } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { AuthSessionRejectedError } from '@open-mercato/core/modules/auth/lib/sessionEligibility'
import { lockAuthorizationUserRows } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isSsoUserDeactivated } from '../lib/deactivation'

type SsoSessionScope = {
  tenantId: string | null
  organizationId: string
  ssoConfigId: string
}

export class SsoAuthService extends AuthService {
  constructor(private ssoEm: EntityManager) {
    super(ssoEm)
  }

  override async verifyPassword(user: User | null, password: string): Promise<boolean> {
    const verified = await super.verifyPassword(user, password)
    if (!verified || !user) return false

    return !await isSsoUserDeactivated(this.ssoEm, {
      userId: user.id,
      tenantId: user.tenantId ?? null,
      organizationId: user.organizationId ?? null,
    })
  }

  override async createSession(
    user: User,
    expiresAt: Date,
    scope?: SsoSessionScope,
  ): Promise<{ session: Session; token: string }> {
    return this.ssoEm.transactional(async (txEm) => {
      await lockAuthorizationUserRows(txEm, [user.id])
      const currentUser = await findOneWithDecryption(
        txEm, User,
        { id: user.id, tenantId: user.tenantId ?? null, organizationId: user.organizationId ?? null, deletedAt: null },
        { refresh: true },
        { tenantId: user.tenantId ?? null, organizationId: user.organizationId ?? null },
      )
      if (!currentUser || await isSsoUserDeactivated(txEm, {
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
