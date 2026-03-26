import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { EnforcementScope, MfaEnforcementPolicy, MfaRecoveryCode, UserMfaMethod } from '../data/entities'
import { emitSecurityEvent } from '../events'
import type { MfaProviderRegistry } from '../lib/mfa-provider-registry'
import type { MfaProviderRuntimeContext } from '../lib/mfa-provider-interface'
import type { SecurityModuleConfig } from '../lib/security-config'
import { readSecurityModuleConfig } from '../lib/security-config'

type SetupResult = {
  setupId: string
  clientData: Record<string, unknown>
}

type ProviderDisplay = {
  type: string
  label: string
  icon: string
  allowMultiple: boolean
  components?: {
    setup?: string
    list?: string
    details?: string
    challenge?: string
  }
}

export class MfaServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'MfaServiceError'
  }
}

export class MfaService {
  constructor(
    private readonly em: EntityManager,
    private readonly mfaProviderRegistry: MfaProviderRegistry,
    private readonly securityConfig: SecurityModuleConfig = readSecurityModuleConfig(),
  ) {}

  async setupMethod(
    userId: string,
    providerType: string,
    payload: unknown,
    context?: MfaProviderRuntimeContext,
  ): Promise<SetupResult> {
    const provider = this.mfaProviderRegistry.get(providerType)
    if (!provider) {
      throw new MfaServiceError(`MFA provider '${providerType}' is not registered`, 400)
    }

    const user = await this.findUserById(userId)
    if (!user?.tenantId) {
      throw new MfaServiceError('User not found', 404)
    }

    await this.ensureProviderCanBeConfigured(userId, providerType, provider.allowMultiple)

    const resolvedPayload = provider.resolveSetupPayload
      ? await provider.resolveSetupPayload({
        id: user.id,
        email: user.email ?? null,
        tenantId: user.tenantId,
        organizationId: user.organizationId ?? null,
      }, payload)
      : payload

    const result = context
      ? await provider.setup(userId, resolvedPayload, context)
      : await provider.setup(userId, resolvedPayload)
    const now = new Date()
    const method = this.em.create(UserMfaMethod, {
      userId,
      tenantId: user.tenantId,
      organizationId: user.organizationId ?? null,
      type: providerType,
      isActive: false,
      secret: result.setupId,
      providerMetadata: null,
      createdAt: now,
      updatedAt: now,
    })
    this.em.persist(method)
    await this.em.flush()

    return result
  }

  async confirmMethod(
    userId: string,
    setupId: string,
    payload: unknown,
    providerType?: string,
    context?: MfaProviderRuntimeContext,
  ): Promise<{ recoveryCodes?: string[] }> {
    const method = await this.em.findOne(UserMfaMethod, {
      userId,
      isActive: false,
      deletedAt: null,
      secret: setupId,
    })
    if (!method) {
      throw new MfaServiceError('MFA setup session not found', 404)
    }
    if (providerType && method.type !== providerType) {
      throw new MfaServiceError('MFA setup session does not match the requested provider', 400)
    }

    const provider = this.mfaProviderRegistry.get(method.type)
    if (!provider) {
      throw new MfaServiceError(`MFA provider '${method.type}' is not registered`, 400)
    }

    await this.ensureProviderCanBeConfigured(userId, method.type, provider.allowMultiple)

    const confirmation = await provider.confirmSetup(userId, setupId, payload, context)
    const resolvedLabel = this.getLabelFromMetadata(confirmation.metadata) ?? method.label ?? null

    if (resolvedLabel && provider.allowMultiple) {
      const duplicate = await this.em.findOne(UserMfaMethod, {
        userId,
        type: method.type,
        label: resolvedLabel,
        isActive: true,
        deletedAt: null,
      })
      if (duplicate) {
        throw new MfaServiceError(`An MFA method with this name already exists`, 409)
      }
    }

    method.providerMetadata = confirmation.metadata
    method.secret = confirmation.secret ?? null
    method.label = resolvedLabel
    method.isActive = true
    method.updatedAt = new Date()
    await this.em.flush()

    await emitSecurityEvent('security.mfa.enrolled', {
      userId,
      tenantId: method.tenantId,
      organizationId: method.organizationId ?? null,
      methodType: method.type,
      methodId: method.id,
      enrolledAt: new Date().toISOString(),
    })

    return {}
  }

  async getUserMethods(userId: string): Promise<UserMfaMethod[]> {
    return this.em.find(
      UserMfaMethod,
      {
        userId,
        isActive: true,
        deletedAt: null,
      },
      {
        orderBy: { createdAt: 'asc' },
      },
    )
  }

  async getAvailableProviders(tenantId: string, orgId?: string): Promise<ProviderDisplay[]> {
    const activePolicy = await this.resolveActiveEnforcementPolicy(tenantId, orgId)
    const providers = this.mfaProviderRegistry.listAvailable(activePolicy?.allowedMethods ?? null)
    return providers.map((provider) => ({
      type: provider.type,
      label: provider.label,
      icon: provider.icon,
      allowMultiple: provider.allowMultiple,
      ...(provider.components ? { components: provider.components } : {}),
    }))
  }

  async removeMethod(userId: string, methodId: string): Promise<void> {
    const method = await this.em.findOne(UserMfaMethod, {
      id: methodId,
      userId,
      isActive: true,
      deletedAt: null,
    })
    if (!method) {
      throw new MfaServiceError('MFA method not found', 404)
    }

    method.isActive = false
    method.deletedAt = new Date()
    method.updatedAt = new Date()
    await this.em.flush()

    await emitSecurityEvent('security.mfa.removed', {
      userId,
      methodId: method.id,
      methodType: method.type,
    })
  }

  async generateRecoveryCodes(userId: string): Promise<string[]> {
    const user = await this.findUserById(userId)
    if (!user?.tenantId) {
      throw new MfaServiceError('User not found', 404)
    }

    const existingCodes = await this.em.find(MfaRecoveryCode, {
      userId,
      isUsed: false,
    })
    const now = new Date()
    for (const code of existingCodes) {
      code.isUsed = true
      code.usedAt = now
    }

    const plaintextCodes: string[] = []
    for (let index = 0; index < this.securityConfig.recoveryCodes.count; index += 1) {
      const code = this.createRecoveryCode()
      const codeHash = await hash(code, this.securityConfig.recoveryCodes.bcryptCost)
      const recoveryCode = this.em.create(MfaRecoveryCode, {
        userId,
        tenantId: user.tenantId,
        codeHash,
        isUsed: false,
        createdAt: new Date(),
      })
      this.em.persist(recoveryCode)
      plaintextCodes.push(code)
    }

    await this.em.flush()
    await emitSecurityEvent('security.recovery.regenerated', {
      userId,
      total: plaintextCodes.length,
    })
    return plaintextCodes
  }

  async verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
    const candidates = this.buildRecoveryCodeCandidates(code)
    if (candidates.length === 0) {
      return false
    }

    const recoveryCodes = await this.em.find(
      MfaRecoveryCode,
      {
        userId,
        isUsed: false,
      },
      {
        orderBy: { createdAt: 'asc' },
      },
    )

    for (const recoveryCode of recoveryCodes) {
      let valid = false
      for (const candidate of candidates) {
        if (await compare(candidate, recoveryCode.codeHash)) {
          valid = true
          break
        }
      }
      if (!valid) continue
      recoveryCode.isUsed = true
      recoveryCode.usedAt = new Date()
      await this.em.flush()
      const remaining = await this.em.count(MfaRecoveryCode, { userId, isUsed: false })
      await emitSecurityEvent('security.recovery.used', { userId, remaining })
      return true
    }

    return false
  }

  private createRecoveryCode(): string {
    return randomBytes(5).toString('hex').toUpperCase()
  }

  private buildRecoveryCodeCandidates(input: string): string[] {
    const trimmed = input.trim()
    const compact = trimmed.replace(/[\s-]/g, '')
    const normalized = compact.toUpperCase()
    const candidates = [trimmed, trimmed.toUpperCase(), compact, normalized]
      .filter((value) => value.length > 0)
    return [...new Set(candidates)]
  }

  private getLabelFromMetadata(metadata: Record<string, unknown>): string | null {
    const value = metadata.label
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  private async ensureProviderCanBeConfigured(
    userId: string,
    providerType: string,
    allowMultiple: boolean,
  ): Promise<void> {
    if (allowMultiple) return

    const existingMethod = await this.em.findOne(UserMfaMethod, {
      userId,
      type: providerType,
      isActive: true,
      deletedAt: null,
    })
    if (existingMethod) {
      throw new MfaServiceError(`MFA provider '${providerType}' is already configured`, 409)
    }
  }

  private async findUserById(userId: string): Promise<User | null> {
    return findOneWithDecryption(this.em, User, { id: userId, deletedAt: null }, undefined, {})
  }

  private async resolveActiveEnforcementPolicy(
    tenantId: string,
    orgId?: string,
  ): Promise<MfaEnforcementPolicy | null> {
    if (orgId) {
      const organizationPolicy = await this.em.findOne(MfaEnforcementPolicy, {
        scope: EnforcementScope.ORGANISATION,
        tenantId,
        organizationId: orgId,
        isEnforced: true,
        deletedAt: null,
      })
      if (organizationPolicy) return organizationPolicy
    }

    const tenantPolicy = await this.em.findOne(MfaEnforcementPolicy, {
      scope: EnforcementScope.TENANT,
      tenantId,
      isEnforced: true,
      deletedAt: null,
    })
    if (tenantPolicy) return tenantPolicy

    return this.em.findOne(MfaEnforcementPolicy, {
      scope: EnforcementScope.PLATFORM,
      isEnforced: true,
      deletedAt: null,
    })
  }
}

export default MfaService
