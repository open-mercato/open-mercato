import type { EntityManager } from '@mikro-orm/postgresql'
import { MfaChallenge, UserMfaMethod } from '../data/entities'
import type { MfaProviderRegistry } from '../lib/mfa-provider-registry'
import { emitSecurityEvent } from '../events'
import type { MfaService } from './MfaService'
import type { MfaEnforcementService } from './MfaEnforcementService'
import type { MfaProviderRuntimeContext, MfaVerifyContext } from '../lib/mfa-provider-interface'
import type { SecurityModuleConfig } from '../lib/security-config'
import { readSecurityModuleConfig } from '../lib/security-config'

type AvailableMethod = {
  type: string
  label: string
  icon: string
  components?: {
    list?: string
    details?: string
    challenge?: string
  }
}

type ChallengeCreationResult = {
  challengeId: string
  availableMethods: AvailableMethod[]
}

export class MfaVerificationServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'MfaVerificationServiceError'
  }
}

export class MfaVerificationService {
  constructor(
    private readonly em: EntityManager,
    private readonly mfaProviderRegistry: MfaProviderRegistry,
    private readonly mfaService: MfaService,
    private readonly mfaEnforcementService: MfaEnforcementService,
    private readonly securityConfig: SecurityModuleConfig = readSecurityModuleConfig(),
  ) {}

  async createChallenge(userId: string): Promise<ChallengeCreationResult> {
    const methods = await this.getActiveMethods(userId)
    if (methods.length === 0) {
      throw new MfaVerificationServiceError('No MFA methods configured', 400)
    }

    const challenge = this.em.create(MfaChallenge, {
      userId,
      tenantId: methods[0].tenantId,
      expiresAt: new Date(Date.now() + this.securityConfig.mfa.challengeTtlMs),
      attempts: 0,
      createdAt: new Date(),
    })
    this.em.persist(challenge)
    await this.em.flush()

    const availableMethods = methods
      .map((method) => {
        const provider = this.mfaProviderRegistry.get(method.type)
        if (!provider) return null
        return {
          type: provider.type,
          label: provider.label,
          icon: provider.icon,
          ...(provider.components ? { components: provider.components } : {}),
        }
      })
      .filter((item): item is AvailableMethod => item !== null)
    if (availableMethods.length === 0) {
      throw new MfaVerificationServiceError('No registered MFA providers are available for the configured methods', 400)
    }

    return {
      challengeId: challenge.id,
      availableMethods,
    }
  }

  async prepareChallenge(
    challengeId: string,
    methodType: string,
    context?: MfaProviderRuntimeContext,
  ): Promise<{ clientData?: Record<string, unknown> }> {
    const challenge = await this.getValidChallenge(challengeId)
    const provider = this.mfaProviderRegistry.get(methodType)
    if (!provider) {
      throw new MfaVerificationServiceError(`MFA provider '${methodType}' is not registered`, 400)
    }

    const method = await this.findMethod(challenge.userId, methodType)
    const result = await provider.prepareChallenge(challenge.userId, {
      id: method.id,
      type: method.type,
      userId: method.userId,
      secret: method.secret ?? null,
      providerMetadata: method.providerMetadata,
    }, context)

    challenge.methodType = methodType
    challenge.methodId = method.id
    challenge.providerChallenge = result.verifyContext?.challenge ?? null
    await this.em.flush()
    return result
  }

  async verifyChallenge(
    challengeId: string,
    methodType: string,
    payload: unknown,
    runtimeContext?: MfaProviderRuntimeContext,
  ): Promise<boolean> {
    const challenge = await this.getValidChallenge(challengeId)
    if (challenge.attempts >= this.securityConfig.mfa.maxAttempts) {
      return false
    }

    if (challenge.methodType && challenge.methodType !== methodType) {
      challenge.attempts += 1
      if (challenge.attempts >= this.securityConfig.mfa.maxAttempts) {
        challenge.expiresAt = new Date()
      }
      await this.em.flush()
      return false
    }

    const provider = this.mfaProviderRegistry.get(methodType)
    if (!provider) {
      throw new MfaVerificationServiceError(`MFA provider '${methodType}' is not registered`, 400)
    }

    const method = challenge.methodId
      ? await this.findMethodById(challenge.userId, challenge.methodId)
      : await this.findMethod(challenge.userId, methodType)
    const context: MfaVerifyContext | undefined = challenge.providerChallenge
      ? { challenge: challenge.providerChallenge }
      : undefined
    const verified = await provider.verify(challenge.userId, {
      id: method.id,
      type: method.type,
      userId: method.userId,
      secret: method.secret ?? null,
      providerMetadata: method.providerMetadata,
    }, payload, context, runtimeContext)

    if (verified) {
      challenge.verifiedAt = new Date()
      challenge.methodType = methodType
      method.lastUsedAt = new Date()
      await this.em.flush()
      await emitSecurityEvent('security.mfa.verified', {
        userId: challenge.userId,
        challengeId: challenge.id,
        methodType,
      })
      return true
    }

    challenge.attempts += 1
    if (challenge.attempts >= this.securityConfig.mfa.maxAttempts) {
      challenge.expiresAt = new Date()
    }
    await this.em.flush()
    return false
  }

  async verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
    return this.mfaService.verifyRecoveryCode(userId, code)
  }

  private async getValidChallenge(challengeId: string): Promise<MfaChallenge> {
    const challenge = await this.em.findOne(MfaChallenge, { id: challengeId })
    if (!challenge) {
      throw new MfaVerificationServiceError('MFA challenge not found', 404)
    }
    if (challenge.verifiedAt) {
      throw new MfaVerificationServiceError('MFA challenge already verified', 400)
    }
    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new MfaVerificationServiceError('MFA challenge expired', 400)
    }
    return challenge
  }

  private async getActiveMethods(userId: string): Promise<UserMfaMethod[]> {
    const methods = await this.em.find(
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

    const policy = await this.mfaEnforcementService.getEffectivePolicyForUser(userId)
    if (!policy?.isEnforced || !policy.allowedMethods?.length) {
      return methods
    }

    return methods.filter((method) => policy.allowedMethods?.includes(method.type))
  }

  private async findMethod(userId: string, methodType: string): Promise<UserMfaMethod> {
    const method = await this.em.findOne(UserMfaMethod, {
      userId,
      type: methodType,
      isActive: true,
      deletedAt: null,
    })
    if (!method) {
      throw new MfaVerificationServiceError(`MFA method '${methodType}' not found`, 404)
    }
    return method
  }

  private async findMethodById(userId: string, methodId: string): Promise<UserMfaMethod> {
    const method = await this.em.findOne(UserMfaMethod, {
      id: methodId,
      userId,
      isActive: true,
      deletedAt: null,
    })
    if (!method) {
      throw new MfaVerificationServiceError(`MFA method '${methodId}' not found`, 404)
    }
    return method
  }
}

export default MfaVerificationService
