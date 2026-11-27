import type { EntityManager } from '@mikro-orm/postgresql'
import { IsolationLevel, LockMode } from '@mikro-orm/core'
import { User, type Session } from '@open-mercato/core/modules/auth/data/entities'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { AuthSessionRejectedError, isAuthSessionRejectedError, matchesPasswordSessionProof, type PasswordSessionProof } from '@open-mercato/core/modules/auth/lib/sessionEligibility'
import { lockAuthorizationUserRows } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isSsoUserDeactivated } from '../lib/deactivation'
import { SsoConfig } from '../data/entities'
import type { SsoAuthorizationService } from './ssoAuthorizationService'

type SsoSessionScope = {
  tenantId: string | null
  organizationId: string
  ssoConfigId: string
  configUpdatedAt?: number
}

const UNRESOLVED_PASSWORD_SCOPE = {
  userId: '00000000-0000-0000-0000-000000000000',
  tenantId: '00000000-0000-0000-0000-000000000000',
  organizationId: '00000000-0000-0000-0000-000000000000',
}

export class SsoAuthService extends AuthService {
  constructor(
    private ssoEm: EntityManager,
    private ssoAuthorizationService?: SsoAuthorizationService,
  ) {
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
      if (scope) {
        await this.assertSsoSessionAuthority(txEm, user, scope)
      } else {
        await lockAuthorizationUserRows(txEm, [user.id])
      }
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
      return this.createSessionWithEntityManager(
        txEm, currentUser, expiresAt,
        scope && scope.configUpdatedAt !== undefined
          ? { configId: scope.ssoConfigId, configUpdatedAt: scope.configUpdatedAt }
          : undefined,
      )
    })
  }

  override async isSessionEligible(session: Session, user: User): Promise<boolean> {
    const provenance = session.ssoProvenance
    if (provenance == null) return super.isSessionEligible(session, user)
    const { tenantId, organizationId } = user
    if (!tenantId || !organizationId || typeof provenance.configId !== 'string'
      || !Number.isFinite(provenance.configUpdatedAt)) return false

    try {
      return await this.ssoEm.fork().transactional(async (txEm) => {
        await this.assertSsoSessionAuthority(txEm, user, {
          tenantId, organizationId, ssoConfigId: provenance.configId, configUpdatedAt: provenance.configUpdatedAt,
        }, 'snapshot')
        return !await isSsoUserDeactivated(txEm, {
          userId: user.id, tenantId, organizationId, ssoConfigId: provenance.configId,
        })
      }, { isolationLevel: IsolationLevel.REPEATABLE_READ, readOnly: true })
    } catch (error) {
      if (isAuthSessionRejectedError(error) || (isCrudHttpError(error) && error.status === 403)) return false
      throw error
    }
  }

  private async assertSsoSessionAuthority(
    txEm: EntityManager,
    user: User,
    scope: SsoSessionScope,
    mode: 'issuance' | 'snapshot' = 'issuance',
  ): Promise<void> {
    if (!this.ssoAuthorizationService) {
      throw new Error('[internal] SSO authorization service is unavailable')
    }
    const config = await findOneWithDecryption(
      txEm,
      SsoConfig,
      { id: scope.ssoConfigId, organizationId: scope.organizationId, isActive: true, deletedAt: null },
      { refresh: true, ...(mode === 'issuance' ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}) },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    if (!config || !Number.isFinite(scope.configUpdatedAt) || config.updatedAt.getTime() !== scope.configUpdatedAt) {
      throw new AuthSessionRejectedError()
    }
    const tenantId = mode === 'issuance'
      ? await this.ssoAuthorizationService.assertAccount(txEm, config, user)
      : await this.ssoAuthorizationService.assertAccountInSnapshot(txEm, config, user)
    if (scope.tenantId !== tenantId) throw new AuthSessionRejectedError()
  }
}
