import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { MfaRecoveryCode, UserMfaMethod } from '../data/entities'
import { emitSecurityEvent } from '../events'
import type { MfaEnforcementService } from './MfaEnforcementService'

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

  async resetUserMfa(adminId: string, userId: string, reason: string): Promise<void> {
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

    const user = await this.findUserById(userId)
    if (!user) {
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

  async getUserMfaStatus(userId: string): Promise<UserMfaStatus> {
    if (!userId.trim()) {
      throw new MfaAdminServiceError('User ID is required', 400)
    }

    const user = await this.findUserById(userId)
    if (!user) {
      throw new MfaAdminServiceError('User not found', 404)
    }

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

  async bulkComplianceCheck(tenantId: string): Promise<BulkComplianceStatus[]> {
    if (!tenantId.trim()) {
      throw new MfaAdminServiceError('Tenant ID is required', 400)
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

  private async findUserById(userId: string): Promise<User | null> {
    return this.em.findOne(User, { id: userId, deletedAt: null })
  }
}

export default MfaAdminService
