import type { EntityManager } from '@mikro-orm/postgresql'
import { ZodError } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { MfaChallenge, MfaVerificationState, UserMfaMethod } from '../data/entities'
import type { MfaProviderRegistry } from '../lib/mfa-provider-registry'
import { emitSecurityEvent } from '../events'
import type { MfaService } from './MfaService'
import type { MfaEnforcementService } from './MfaEnforcementService'
import type { MfaMethodRecord, MfaProviderRuntimeContext, MfaVerifyContext } from '../lib/mfa-provider-interface'
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

export type MfaVerificationAuthScope = {
  userId: string
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

  /**
   * @deprecated Since 0.6 — pass an {@link MfaVerificationAuthScope} bound to the
   *   authenticated user (`auth.sub`). The no-scope overload now treats the caller as
   *   unknown and rejects every challenge lookup with 404; it will be removed in a
   *   future release.
   */
  async prepareChallenge(
    challengeId: string,
    methodType: string,
    context?: MfaProviderRuntimeContext,
  ): Promise<{ clientData?: Record<string, unknown> }>
  async prepareChallenge(
    challengeId: string,
    methodType: string,
    context: MfaProviderRuntimeContext | undefined,
    scope: MfaVerificationAuthScope,
  ): Promise<{ clientData?: Record<string, unknown> }>
  async prepareChallenge(
    challengeId: string,
    methodType: string,
    context?: MfaProviderRuntimeContext,
    scope?: MfaVerificationAuthScope,
  ): Promise<{ clientData?: Record<string, unknown> }> {
    if (!scope) {
      throw new MfaVerificationServiceError('MFA challenge not found', 404)
    }
    const challenge = await this.getValidChallenge(challengeId, scope)
    await this.assertMethodAllowedByPolicy(challenge.userId, methodType)
    const provider = this.mfaProviderRegistry.get(methodType)
    if (!provider) {
      throw new MfaVerificationServiceError(`MFA provider '${methodType}' is not registered`, 400)
    }

    const method = await this.findMethod(challenge.userId, methodType)
    const result = await provider.prepareChallenge(challenge.userId, {
      id: method.id,
      type: method.type,
      userId: method.userId,
      tenantId: method.tenantId,
      organizationId: method.organizationId ?? null,
      secret: method.secret ?? null,
      providerMetadata: method.providerMetadata,
    }, context)

    challenge.methodType = methodType
    challenge.methodId = method.id
    challenge.providerChallenge = result.verifyContext?.challenge ?? null
    await this.em.flush()
    return result
  }

  /**
   * @deprecated Since 0.6 — pass an {@link MfaVerificationAuthScope} bound to the
   *   authenticated user (`auth.sub`). The no-scope overload now treats the caller as
   *   unknown and rejects every challenge lookup with 404; it will be removed in a
   *   future release.
   */
  async verifyChallenge(
    challengeId: string,
    methodType: string,
    payload: unknown,
    runtimeContext?: MfaProviderRuntimeContext,
  ): Promise<boolean>
  async verifyChallenge(
    challengeId: string,
    methodType: string,
    payload: unknown,
    runtimeContext: MfaProviderRuntimeContext | undefined,
    scope: MfaVerificationAuthScope,
  ): Promise<boolean>
  async verifyChallenge(
    challengeId: string,
    methodType: string,
    payload: unknown,
    runtimeContext?: MfaProviderRuntimeContext,
    scope?: MfaVerificationAuthScope,
  ): Promise<boolean> {
    if (!scope) {
      throw new MfaVerificationServiceError('MFA challenge not found', 404)
    }
    const initialChallenge = await this.getValidChallenge(challengeId, scope)
    await this.assertMethodAllowedByPolicy(scope.userId, methodType)
    const result = await this.em.transactional(async (transactionalEm) => {
      const [lock] = await transactionalEm.execute<Array<{ locked: boolean }>>(
        'select pg_try_advisory_xact_lock(hashtextextended(?::text, 0)) as locked',
        [`security:mfa:${initialChallenge.tenantId}:${scope.userId}`],
      )
      if (!lock?.locked) return { verified: false }

      const challenge = await this.getValidChallenge(challengeId, scope, transactionalEm)
      const now = new Date()
      const state = await this.getVerificationState(transactionalEm, challenge, now)
      if (state.lockedUntil && state.lockedUntil > now) return { verified: false }
      if (challenge.attempts >= this.securityConfig.mfa.maxAttempts) return { verified: false }
      if (state.resetAt <= now) {
        state.attempts = 0
        state.lockedUntil = null
        state.resetAt = new Date(now.getTime() + this.securityConfig.mfa.challengeTtlMs)
      }

      if (challenge.methodType && challenge.methodType !== methodType) {
        return this.registerFailedAttempt(challenge, state, now)
      }
      const provider = this.mfaProviderRegistry.get(methodType)
      if (!provider) {
        throw new MfaVerificationServiceError(`MFA provider '${methodType}' is not registered`, 400)
      }
      const method = await findOneWithDecryption(transactionalEm, UserMfaMethod, {
        ...(challenge.methodId ? { id: challenge.methodId } : { type: methodType }),
        userId: challenge.userId,
        tenantId: challenge.tenantId,
        isActive: true,
        deletedAt: null,
      }, { refresh: true }, { tenantId: challenge.tenantId })
      if (!method || method.type !== methodType) {
        throw new MfaVerificationServiceError('MFA method not found', 404)
      }
      const context: MfaVerifyContext | undefined = challenge.providerChallenge
        ? { challenge: challenge.providerChallenge }
        : undefined
      const providerMethod: MfaMethodRecord = {
        id: method.id,
        type: method.type,
        userId: method.userId,
        tenantId: method.tenantId,
        organizationId: method.organizationId ?? null,
        secret: method.secret ?? null,
        providerMetadata: structuredClone(method.providerMetadata),
      }
      let verified: boolean
      try {
        verified = await provider.verify(challenge.userId, providerMethod, payload, context, runtimeContext)
      } catch (error) {
        if (!(error instanceof ZodError)) throw error
        return { ...this.registerFailedAttempt(challenge, state, now), validationError: error }
      }
      if (!verified) return this.registerFailedAttempt(challenge, state, now)

      challenge.verifiedAt = now
      challenge.methodType = methodType
      method.providerMetadata = providerMethod.providerMetadata
      method.lastUsedAt = now
      state.attempts = 0
      state.lockedUntil = null
      state.resetAt = new Date(now.getTime() + this.securityConfig.mfa.challengeTtlMs)
      return { verified: true }
    })

    if ('lockedUntil' in result && result.lockedUntil) {
      await emitSecurityEvent('security.mfa.verification_locked', {
        userId: scope.userId,
        tenantId: initialChallenge.tenantId,
        lockedUntil: result.lockedUntil.toISOString(),
      })
    }
    if (result.verified) {
      await emitSecurityEvent('security.mfa.verified', {
        userId: scope.userId,
        challengeId,
        methodType,
      })
    }
    if ('validationError' in result) throw result.validationError
    return result.verified
  }

  async verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
    return this.mfaService.verifyRecoveryCode(userId, code)
  }

  private async getValidChallenge(
    challengeId: string,
    scope: MfaVerificationAuthScope,
    em: EntityManager = this.em,
  ): Promise<MfaChallenge> {
    const challenge = await findOneWithDecryption(em, MfaChallenge, {
      id: challengeId,
      userId: scope.userId,
    }, { refresh: true })
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

  private async assertMethodAllowedByPolicy(userId: string, methodType: string): Promise<void> {
    const policy = await this.mfaEnforcementService.getEffectivePolicyForUser(userId)
    if (!policy?.isEnforced || !policy.allowedMethods?.length) {
      return
    }
    if (!policy.allowedMethods.includes(methodType)) {
      throw new MfaVerificationServiceError(`MFA method '${methodType}' is not allowed by the enforcement policy`, 403)
    }
  }

  private registerFailedAttempt(
    challenge: MfaChallenge,
    state: MfaVerificationState,
    now: Date,
  ): { verified: false; lockedUntil?: Date } {
    challenge.attempts += 1
    state.attempts += 1
    if (challenge.attempts >= this.securityConfig.mfa.maxAttempts) {
      challenge.expiresAt = now
    }
    if (state.attempts >= this.securityConfig.mfa.maxAttempts) {
      state.lockedUntil = new Date(now.getTime() + this.securityConfig.mfa.challengeTtlMs)
      state.resetAt = state.lockedUntil
      return { verified: false, lockedUntil: state.lockedUntil }
    }
    return { verified: false }
  }

  private async getVerificationState(
    em: EntityManager,
    challenge: MfaChallenge,
    now: Date,
  ): Promise<MfaVerificationState> {
    const state = await findOneWithDecryption(em, MfaVerificationState, {
      userId: challenge.userId,
      tenantId: challenge.tenantId,
    }, { refresh: true }, { tenantId: challenge.tenantId })
    if (state) return state
    const created = em.create(MfaVerificationState, {
      userId: challenge.userId,
      tenantId: challenge.tenantId,
      attempts: 0,
      resetAt: new Date(now.getTime() + this.securityConfig.mfa.challengeTtlMs),
      updatedAt: now,
    })
    em.persist(created)
    return created
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

}

export default MfaVerificationService
