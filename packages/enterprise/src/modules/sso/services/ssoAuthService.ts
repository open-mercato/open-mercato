import type { EntityManager } from '@mikro-orm/postgresql'
import type { User } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { isSsoUserDeactivated } from '../lib/deactivation'

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
}
