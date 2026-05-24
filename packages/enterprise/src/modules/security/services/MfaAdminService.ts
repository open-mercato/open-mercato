import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { MfaRecoveryCode, UserMfaMethod } from '../data/entities'
import { emitSecurityEvent } from '../events'
import type { MfaEnforcementService } from './MfaEnforcementService'

export type MfaAdminAuthScope = {
  tenantId: string | null
  organizationId?: string | null
  isSuperAdmin?: boolean
}

type MfaMethodStatus = {
  type: string
  label?: string
  lastUsed?: Date
}

type UserMfaStatus = {
  enrolled: boolean
  methods: MfaMethodStatus[]
  recoveryCodesRemaining: number
  compliant: boolean
}

type BulkComplianceStatus = {
  userId: string
  email: string
  enrolled: boolean
  methodCount: number
  compliant: boolean
  lastLoginAt?: Date
}

type ActorContext = {
  tenantId: string | null
  isSuperAdmin: boolean
}

export class MfaAdminServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'MfaAdminServiceError'
  }
}

export class MfaAdminService {
  constructor(
    private readonly em: EntityManager,
    private readonly mfaEnforcementService: MfaEnforcementService,
  ) {}

  /**
   * @deprecated Since 0.6 — pass an {@link MfaAdminAuthScope} so the target user is
   *   loaded with tenant/organization scoping. The no-scope overload now treats the
   *   caller as a non-superadmin with unknown tenant and rejects every load with 404;
   *   it will be removed in a future release.
   */
  async resetUserMfa(adminId: string, userId: string, reason: string): Promise<void>
  async resetUserMfa(
    adminId: string,
    userId: string,
    reason: string,
    scope: MfaAdminAuthScope,
  ): Promise<void>
  async resetUserMfa(
    adminId: string,
    userId: string,
    reason: string,
    scope?: MfaAdminAuthScope,
  ): Promise<void> {
    if (!adminId.trim()) {
      throw new MfaAdminServiceError('Admin ID is required', 400)
    }
    if (!userId.trim()) {
      throw new MfaAdminServiceError('User ID is required', 400)
    }

    const normalizedReason = reason.trim()
    if (!normalizedReason) {
      throw new MfaAdminServiceError('Reset reason is required', 400)
    }

    const effectiveScope: MfaAdminAuthScope = scope ?? { tenantId: null, isSuperAdmin: false }
    const user = await this.loadUserForScope(userId, effectiveScope)
    if (!user) {
      // Unified 404 for both "missing" and "out of scope" — prevents existence enumeration.
      throw new MfaAdminServiceError('User not found', 404)
    }

    const activeMethods = await this.em.find(UserMfaMethod, {
      userId,
      isActive: true,
      deletedAt: null,
    })
    const activeRecoveryCodes = await this.em.find(MfaRecoveryCode, {
      userId,
      isUsed: false,
    })

    const now = new Date()
    for (const method of activeMethods) {
      method.isActive = false
      method.deletedAt = now
      method.updatedAt = now
    }
    for (const recoveryCode of activeRecoveryCodes) {
      recoveryCode.isUsed = true
      recoveryCode.usedAt = now
    }
    await this.em.flush()

    await emitSecurityEvent('security.mfa.reset', {
      adminId,
      targetUserId: userId,
      tenantId: user.tenantId,
      organizationId: user.organizationId ?? null,
      reason: normalizedReason,
      methodCount: activeMethods.length,
      recoveryCodesInvalidated: activeRecoveryCodes.length,
      resetAt: new Date().toISOString(),
    })
  }

  async getUserMfaStatus(userId: string, actor?: ActorContext): Promise<UserMfaStatus> {
    if (!userId.trim()) {
      throw new MfaAdminServiceError('User ID is required', 400)
    }

    const user = await this.findUserById(userId)
    if (!user) {
      throw new MfaAdminServiceError('User not found', 404)
    }
    this.assertActorOwnsUser(user, actor)

    const methods = await this.em.find(
      UserMfaMethod,
      {
        userId,
        isActive: true,
        deletedAt: null,
      },
      {
        orderBy: { createdAt: 'desc' },
      },
    )

    const recoveryCodesRemaining = await this.em.count(MfaRecoveryCode, {
      userId,
      isUsed: false,
    })

    const compliance = await this.mfaEnforcementService.checkUserCompliance(userId)

    return {
      enrolled: methods.length > 0,
      methods: methods.map((method) => ({
        type: method.type,
        ...(method.label ? { label: method.label } : {}),
        ...(method.lastUsedAt ? { lastUsed: method.lastUsedAt } : {}),
      })),
      recoveryCodesRemaining,
      compliant: compliance.compliant,
    }
  }

  async bulkComplianceCheck(tenantId: string, actor?: ActorContext): Promise<BulkComplianceStatus[]> {
    if (!tenantId.trim()) {
      throw new MfaAdminServiceError('Tenant ID is required', 400)
    }
    if (actor && !actor.isSuperAdmin && tenantId !== actor.tenantId) {
      throw new MfaAdminServiceError('Not authorized for the requested tenant scope.', 403)
    }

    const users = await findWithDecryption(
      this.em,
      User,
      {
        tenantId,
        deletedAt: null,
      },
      {
        orderBy: { createdAt: 'asc' },
      },
      { tenantId, organizationId: null },
    )

    const userIds = users.map((user) => user.id)
    const activeMethods = userIds.length
      ? await this.em.find(UserMfaMethod, {
          userId: { $in: userIds },
          isActive: true,
          deletedAt: null,
        })
      : []
    const methodCountByUserId = new Map<string, number>()
    for (const method of activeMethods) {
      const currentCount = methodCountByUserId.get(method.userId) ?? 0
      methodCountByUserId.set(method.userId, currentCount + 1)
    }

    const complianceResults = await Promise.all(
      users.map((user) => this.mfaEnforcementService.checkUserCompliance(user.id)),
    )

    return users.map((user, index) => {
      const methodCount = methodCountByUserId.get(user.id) ?? 0
      const compliance = complianceResults[index]
      return {
        userId: user.id,
        email: user.email,
        enrolled: methodCount > 0,
        methodCount,
        compliant: compliance.compliant,
        ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt } : {}),
      }
    })
  }

  private assertActorOwnsUser(user: User, actor?: ActorContext): void {
    if (!actor || actor.isSuperAdmin) return
    if (!user.tenantId || user.tenantId !== actor.tenantId) {
      throw new MfaAdminServiceError('User not found', 404)
    }
  }

  private async findUserById(userId: string): Promise<User | null> {
    return findOneWithDecryption(
      this.em,
      User,
      { id: userId, deletedAt: null } as FilterQuery<User>,
      {},
      { tenantId: null, organizationId: null },
    )
  }

  private async loadUserForScope(
    userId: string,
    scope: MfaAdminAuthScope,
  ): Promise<User | null> {
    if (scope.isSuperAdmin) {
      return findOneWithDecryption(
        this.em,
        User,
        { id: userId, deletedAt: null },
        undefined,
        { tenantId: null, organizationId: null },
      )
    }

    if (!scope.tenantId) return null

    const user = await findOneWithDecryption(
      this.em,
      User,
      { id: userId, tenantId: scope.tenantId, deletedAt: null },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId ?? null },
    )
    if (!user) return null

    if (
      scope.organizationId !== undefined
      && scope.organizationId !== null
      && user.organizationId !== null
      && user.organizationId !== scope.organizationId
    ) {
      return null
    }
    return user
  }
}

export default MfaAdminService
