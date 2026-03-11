import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  EnforcementScope,
  MfaEnforcementPolicy,
  UserMfaMethod,
} from '../data/entities'
import type {
  EnforcementPolicyInput,
  UpdateEnforcementPolicyInput,
} from '../data/validators'
import { emitSecurityEvent } from '../events'

type EnforcementResult = {
  enforced: boolean
  policy?: MfaEnforcementPolicy
}

type ComplianceReport = {
  total: number
  enrolled: number
  pending: number
  overdue: number
}

type EnforcementPolicyListFilters = {
  scope?: EnforcementScope
}

type UserCompliance = {
  compliant: boolean
  deadline?: Date
  enforced: boolean
}

export function isEnforcementDeadlineOverdue(
  deadline?: Date | null,
  now = Date.now(),
): boolean {
  if (!(deadline instanceof Date)) return false
  const deadlineTime = deadline.getTime()
  if (Number.isNaN(deadlineTime)) return false
  return deadlineTime <= now
}

export class MfaEnforcementServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'MfaEnforcementServiceError'
  }
}

export class MfaEnforcementService {
  constructor(private readonly em: EntityManager) {}

  async isEnforced(tenantId: string, orgId?: string): Promise<EnforcementResult> {
    const policy = await this.resolveEffectivePolicy(tenantId, orgId)
    if (!policy || !policy.isEnforced) {
      return { enforced: false, policy: policy ?? undefined }
    }
    return { enforced: true, policy }
  }

  async listPolicies(filters?: EnforcementPolicyListFilters): Promise<MfaEnforcementPolicy[]> {
    return this.em.find(
      MfaEnforcementPolicy,
      {
        deletedAt: null,
        ...(filters?.scope ? { scope: filters.scope } : {}),
      },
      {
        orderBy: { updatedAt: 'desc' },
      },
    )
  }

  async getComplianceReport(
    scope: EnforcementScope,
    scopeId?: string,
  ): Promise<ComplianceReport> {
    const { tenantId, organizationId } = this.resolveScopeFilters(scope, scopeId)
    const users = await this.em.find(User, {
      deletedAt: null,
      ...(tenantId ? { tenantId } : {}),
      ...(organizationId ? { organizationId } : {}),
    })

    const total = users.length
    if (total === 0) {
      return { total: 0, enrolled: 0, pending: 0, overdue: 0 }
    }

    const userIds = users.map((user) => user.id)
    const policy = await this.findPolicyByScope(scope, tenantId, organizationId)
    const methodFilter = this.buildAllowedMethodsFilter(policy?.allowedMethods ?? null)
    const methods = await this.em.find(UserMfaMethod, {
      userId: { $in: userIds },
      isActive: true,
      deletedAt: null,
      ...methodFilter,
    })

    const enrolledUserIds = new Set(methods.map((method) => method.userId))
    const enrolled = enrolledUserIds.size
    const unenrolled = Math.max(0, total - enrolled)

    const now = Date.now()
    const overdue = isEnforcementDeadlineOverdue(policy?.enforcementDeadline, now) ? unenrolled : 0
    const pending = Math.max(0, unenrolled - overdue)

    return {
      total,
      enrolled,
      pending,
      overdue,
    }
  }

  async createPolicy(
    data: EnforcementPolicyInput,
    adminId: string,
  ): Promise<MfaEnforcementPolicy> {
    const normalized = this.normalizePolicyInput(data)
    const existing = await this.findPolicyByScope(
      normalized.scope,
      normalized.tenantId ?? undefined,
      normalized.organizationId ?? undefined,
    )

    if (existing) {
      existing.isEnforced = normalized.isEnforced
      existing.allowedMethods = normalized.allowedMethods
      existing.enforcementDeadline = normalized.enforcementDeadline
      existing.enforcedBy = adminId
      existing.updatedAt = new Date()
      await this.em.flush()

      await emitSecurityEvent('security.enforcement.updated', {
        adminId,
        policyId: existing.id,
        scope: existing.scope,
      })
      await this.emitDeadlineReminderRequest(existing.id)
      return existing
    }

    const now = new Date()
    const policy = this.em.create(MfaEnforcementPolicy, {
      scope: normalized.scope,
      tenantId: normalized.tenantId,
      organizationId: normalized.organizationId,
      isEnforced: normalized.isEnforced,
      allowedMethods: normalized.allowedMethods,
      enforcementDeadline: normalized.enforcementDeadline,
      enforcedBy: adminId,
      createdAt: now,
      updatedAt: now,
    })
    this.em.persist(policy)
    await this.em.flush()

    await emitSecurityEvent('security.enforcement.created', {
      adminId,
      policyId: policy.id,
      scope: policy.scope,
    })
    await this.emitDeadlineReminderRequest(policy.id)
    return policy
  }

  async updatePolicy(
    id: string,
    data: UpdateEnforcementPolicyInput,
    adminId: string,
  ): Promise<MfaEnforcementPolicy> {
    const policy = await this.em.findOne(MfaEnforcementPolicy, {
      id,
      deletedAt: null,
    })
    if (!policy) {
      throw new MfaEnforcementServiceError('Enforcement policy not found', 404)
    }

    const mergedInput = this.normalizePolicyInput({
      scope: data.scope ?? policy.scope,
      tenantId: data.tenantId ?? policy.tenantId ?? undefined,
      organizationId: data.organizationId ?? policy.organizationId ?? undefined,
      isEnforced: data.isEnforced ?? policy.isEnforced,
      allowedMethods: data.allowedMethods ?? policy.allowedMethods ?? null,
      enforcementDeadline:
        data.enforcementDeadline === undefined
          ? (policy.enforcementDeadline ?? null)
          : data.enforcementDeadline,
    })

    if (
      mergedInput.scope !== policy.scope ||
      mergedInput.tenantId !== (policy.tenantId ?? null) ||
      mergedInput.organizationId !== (policy.organizationId ?? null)
    ) {
      const conflict = await this.findPolicyByScope(
        mergedInput.scope,
        mergedInput.tenantId ?? undefined,
        mergedInput.organizationId ?? undefined,
      )
      if (conflict && conflict.id !== policy.id) {
        throw new MfaEnforcementServiceError('Enforcement policy already exists for this scope', 409)
      }
    }

    policy.scope = mergedInput.scope
    policy.tenantId = mergedInput.tenantId
    policy.organizationId = mergedInput.organizationId
    policy.isEnforced = mergedInput.isEnforced
    policy.allowedMethods = mergedInput.allowedMethods
    policy.enforcementDeadline = mergedInput.enforcementDeadline
    policy.enforcedBy = adminId
    policy.updatedAt = new Date()
    await this.em.flush()

    await emitSecurityEvent('security.enforcement.updated', {
      adminId,
      policyId: policy.id,
      scope: policy.scope,
    })
    await this.emitDeadlineReminderRequest(policy.id)
    return policy
  }

  async deletePolicy(id: string): Promise<void> {
    const policy = await this.em.findOne(MfaEnforcementPolicy, {
      id,
      deletedAt: null,
    })
    if (!policy) {
      throw new MfaEnforcementServiceError('Enforcement policy not found', 404)
    }

    const now = new Date()
    policy.deletedAt = now
    policy.updatedAt = now
    await this.em.flush()
  }

  async checkUserCompliance(userId: string): Promise<UserCompliance> {
    const policy = await this.getEffectivePolicyForUser(userId)
    if (!policy || !policy.isEnforced) {
      return { compliant: true, enforced: false }
    }

    const methodFilter = this.buildAllowedMethodsFilter(policy.allowedMethods ?? null)
    const methodCount = await this.em.count(UserMfaMethod, {
      userId,
      isActive: true,
      deletedAt: null,
      ...methodFilter,
    })

    return {
      compliant: methodCount > 0,
      enforced: true,
      deadline: policy.enforcementDeadline ?? undefined,
    }
  }

  async getEffectivePolicyForUser(userId: string): Promise<MfaEnforcementPolicy | null> {
    const user = await this.findUserById(userId)
    if (!user?.tenantId) {
      throw new MfaEnforcementServiceError('User not found', 404)
    }

    return this.resolveEffectivePolicy(user.tenantId, user.organizationId ?? undefined)
  }

  private async resolveEffectivePolicy(
    tenantId: string,
    orgId?: string,
  ): Promise<MfaEnforcementPolicy | null> {
    if (orgId) {
      const organizationPolicy = await this.findPolicyByScope(
        EnforcementScope.ORGANISATION,
        tenantId,
        orgId,
      )
      if (organizationPolicy) return organizationPolicy
    }

    const tenantPolicy = await this.findPolicyByScope(EnforcementScope.TENANT, tenantId, undefined)
    if (tenantPolicy) return tenantPolicy

    return this.findPolicyByScope(EnforcementScope.PLATFORM, undefined, undefined)
  }

  private async findPolicyByScope(
    scope: EnforcementScope,
    tenantId?: string,
    organizationId?: string,
  ): Promise<MfaEnforcementPolicy | null> {
    return this.em.findOne(
      MfaEnforcementPolicy,
      {
        scope,
        tenantId: tenantId ?? null,
        organizationId: organizationId ?? null,
        deletedAt: null,
      },
      {
        orderBy: { updatedAt: 'desc' },
      },
    )
  }

  private resolveScopeFilters(
    scope: EnforcementScope,
    scopeId?: string,
  ): { tenantId?: string; organizationId?: string } {
    if (scope === EnforcementScope.PLATFORM) {
      return {}
    }

    if (!scopeId) {
      throw new MfaEnforcementServiceError('scopeId is required for tenant and organisation scopes', 400)
    }

    if (scope === EnforcementScope.TENANT) {
      return { tenantId: scopeId }
    }

    const [tenantId, organizationId] = scopeId.split(':')
    if (!tenantId || !organizationId) {
      throw new MfaEnforcementServiceError(
        "organisation scopeId must use '<tenantId>:<organizationId>' format",
        400,
      )
    }

    return { tenantId, organizationId }
  }

  private normalizePolicyInput(data: {
    scope: EnforcementScope
    tenantId?: string | null
    organizationId?: string | null
    isEnforced?: boolean
    allowedMethods?: string[] | null
    enforcementDeadline?: Date | null
  }): {
    scope: EnforcementScope
    tenantId: string | null
    organizationId: string | null
    isEnforced: boolean
    allowedMethods: string[] | null
    enforcementDeadline: Date | null
  } {
    const isEnforced = data.isEnforced ?? true
    const allowedMethods = this.normalizeAllowedMethods(data.allowedMethods)
    const enforcementDeadline = data.enforcementDeadline ?? null

    if (data.scope === EnforcementScope.PLATFORM) {
      return {
        scope: data.scope,
        tenantId: null,
        organizationId: null,
        isEnforced,
        allowedMethods,
        enforcementDeadline,
      }
    }

    if (data.scope === EnforcementScope.TENANT) {
      if (!data.tenantId) {
        throw new MfaEnforcementServiceError('tenantId is required for tenant scope', 400)
      }
      return {
        scope: data.scope,
        tenantId: data.tenantId,
        organizationId: null,
        isEnforced,
        allowedMethods,
        enforcementDeadline,
      }
    }

    if (!data.tenantId || !data.organizationId) {
      throw new MfaEnforcementServiceError(
        'tenantId and organizationId are required for organisation scope',
        400,
      )
    }

    return {
      scope: data.scope,
      tenantId: data.tenantId,
      organizationId: data.organizationId,
      isEnforced,
      allowedMethods,
      enforcementDeadline,
    }
  }

  private normalizeAllowedMethods(allowedMethods?: string[] | null): string[] | null {
    if (!allowedMethods || allowedMethods.length === 0) {
      return null
    }
    return Array.from(new Set(allowedMethods.map((method) => method.trim()).filter(Boolean)))
  }

  private buildAllowedMethodsFilter(
    allowedMethods?: string[] | null,
  ): { type?: { $in: string[] } } {
    if (!allowedMethods || allowedMethods.length === 0) {
      return {}
    }
    return { type: { $in: allowedMethods } }
  }

  private async findUserById(userId: string): Promise<User | null> {
    return findOneWithDecryption(this.em, User, { id: userId, deletedAt: null }, undefined, {})
  }

  private async emitDeadlineReminderRequest(policyId: string): Promise<void> {
    await emitSecurityEvent('security.enforcement.deadline_reminder_requested', {
      policyId,
    })
  }
}

export default MfaEnforcementService
