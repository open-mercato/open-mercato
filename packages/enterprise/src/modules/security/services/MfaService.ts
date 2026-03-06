import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { EnforcementScope, MfaEnforcementPolicy, MfaRecoveryCode, UserMfaMethod } from '../data/entities'
import { emitSecurityEvent } from '../events'
import type { MfaProviderRegistry } from '../lib/mfa-provider-registry'

const RECOVERY_CODES_COUNT = 10
const RECOVERY_BCRYPT_COST = 10

type SetupResult = {
  setupId: string
  clientData: Record<string, unknown>
}

type ProviderDisplay = {
  type: string
  label: string
  icon: string
  allowMultiple: boolean
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
  ) {}

  async setupMethod(userId: string, providerType: string, payload: unknown): Promise<SetupResult> {
    const provider = this.mfaProviderRegistry.get(providerType)
    if (!provider) {
      throw new MfaServiceError(`MFA provider '${providerType}' is not registered`, 400)
    }

    const user = await this.findUserById(userId)
    if (!user?.tenantId) {
      throw new MfaServiceError('User not found', 404)
    }

    if (!provider.allowMultiple) {
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

    const result = await provider.setup(userId, payload)
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

    const provider = this.mfaProviderRegistry.get(method.type)
    if (!provider) {
      throw new MfaServiceError(`MFA provider '${method.type}' is not registered`, 400)
    }

    const activeMethodsBefore = await this.em.count(UserMfaMethod, {
      userId,
      isActive: true,
      deletedAt: null,
    })

    const confirmation = await provider.confirmSetup(userId, setupId, payload)
    method.providerMetadata = confirmation.metadata
    method.label = this.getLabelFromMetadata(confirmation.metadata) ?? method.label ?? null
    method.isActive = true
    method.secret = null
    method.updatedAt = new Date()
    await this.em.flush()

    const recoveryCodes = activeMethodsBefore === 0
      ? await this.generateRecoveryCodes(userId)
      : undefined

    await emitSecurityEvent('security.mfa.enrolled', {
      userId,
      methodType: method.type,
      methodId: method.id,
    })

    return { recoveryCodes }
  }

  async setupTotp(
    userId: string,
    label?: string,
  ): Promise<{ setupId: string; uri: string; secret: string; qrDataUrl: string }> {
    const result = await this.setupMethod(userId, 'totp', label ? { label } : {})
    const uri = this.readString(result.clientData, 'uri')
    const secret = this.readString(result.clientData, 'secret')
    const qrDataUrl = this.readString(result.clientData, 'qrDataUrl')
    return { setupId: result.setupId, uri, secret, qrDataUrl }
  }

  async confirmTotp(
    userId: string,
    setupId: string,
    code: string,
  ): Promise<{ recoveryCodes?: string[] }> {
    return this.confirmMethod(userId, setupId, { code })
  }

  async getRegistrationOptions(
    userId: string,
    payload?: Record<string, unknown>,
  ): Promise<{ setupId: string; clientData: Record<string, unknown> }> {
    const result = await this.setupMethod(userId, 'passkey', payload ?? {})
    return {
      setupId: result.setupId,
      clientData: result.clientData,
    }
  }

  async completeRegistration(
    userId: string,
    credential: Record<string, unknown>,
    label?: string,
  ): Promise<{ recoveryCodes?: string[] }> {
    const setupId = this.readString(credential, 'setupId')
    const payload = label ? { ...credential, label } : credential
    return this.confirmMethod(userId, setupId, payload)
  }

  async setupOtpEmail(
    userId: string,
    payload?: Record<string, unknown>,
  ): Promise<{ recoveryCodes?: string[] }> {
    const setup = await this.setupMethod(userId, 'otp_email', payload ?? {})
    return this.confirmMethod(userId, setup.setupId, payload ?? {})
  }

  async sendOtpEmail(userId: string, challengeId: string): Promise<void> {
    const method = await this.em.findOne(UserMfaMethod, {
      userId,
      type: 'otp_email',
      isActive: true,
      deletedAt: null,
    })
    if (!method) {
      throw new MfaServiceError('Email OTP method is not configured', 400)
    }
    const provider = this.mfaProviderRegistry.get('otp_email')
    if (!provider) {
      throw new MfaServiceError("MFA provider 'otp_email' is not registered", 400)
    }
    await provider.prepareChallenge(userId, {
      id: method.id,
      type: method.type,
      userId: method.userId,
      providerMetadata: method.providerMetadata,
    })
    await emitSecurityEvent('security.mfa.otp.sent', {
      userId,
      challengeId,
      methodId: method.id,
    })
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
    for (let index = 0; index < RECOVERY_CODES_COUNT; index += 1) {
      const code = this.createRecoveryCode()
      const codeHash = await hash(code, RECOVERY_BCRYPT_COST)
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
      const valid = await compare(code, recoveryCode.codeHash)
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

  private getLabelFromMetadata(metadata: Record<string, unknown>): string | null {
    const value = metadata.label
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  private readString(record: Record<string, unknown>, key: string): string {
    const value = record[key]
    if (typeof value !== 'string' || value.length === 0) {
      throw new MfaServiceError(`Provider response is missing '${key}'`, 500)
    }
    return value
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
