import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  dedupeSudoTargets,
  getSecuritySudoTargetEntries,
  type SecuritySudoTarget,
} from '../lib/module-security-registry'
import {
  ChallengeMethod,
  SudoChallengeConfig,
  SudoChallengeMethodUsed,
  SudoSession,
} from '../data/entities'
import { emitSecurityEvent } from '../events'
import type {
  SudoConfigInput,
  SudoConfigUpdateInput,
} from '../data/validators'
import type { PasswordService } from './PasswordService'
import type { MfaService } from './MfaService'
import type { MfaVerificationService } from './MfaVerificationService'
import { sudoTargets as defaultSudoTargets } from '../security.sudo'
import type { SecurityModuleConfig } from '../lib/security-config'
import { readSecurityModuleConfig } from '../lib/security-config'

type SudoMethod = 'password' | 'mfa'

export type SudoAvailableMethod = {
  type: string
  label: string
  icon: string
}

export type SudoProtectionResolution = {
  protected: boolean
  config?: SudoChallengeConfig
}

type SignedSudoTokenPayload = {
  sid: string
  sub: string
  tid: string | null
  oid: string | null
  tgt: string
  exp: number
}

type UserScope = {
  id: string
  tenantId: string | null
  organizationId: string | null
}

type DeveloperDefaultPayload = {
  targetIdentifier: string
  label?: string | null
  ttlSeconds?: number
  challengeMethod?: ChallengeMethod
}

export class SudoChallengeServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'SudoChallengeServiceError'
  }
}

export class SudoChallengeService {
  constructor(
    private readonly em: EntityManager,
    private readonly passwordService: PasswordService,
    private readonly mfaService: MfaService,
    private readonly mfaVerificationService: MfaVerificationService,
    private readonly securityConfig: SecurityModuleConfig = readSecurityModuleConfig(),
  ) {}

  async listConfigs(): Promise<SudoChallengeConfig[]> {
    await this.ensureDeveloperDefaultsRegistered()
    return this.em.find(
      SudoChallengeConfig,
      { deletedAt: null },
      {
        orderBy: {
          targetIdentifier: 'asc',
          tenantId: 'asc',
          organizationId: 'asc',
          createdAt: 'asc',
        },
      },
    )
  }

  async getConfigById(id: string): Promise<SudoChallengeConfig | null> {
    await this.ensureDeveloperDefaultsRegistered()
    return this.em.findOne(SudoChallengeConfig, { id, deletedAt: null })
  }

  async isProtected(
    targetIdentifier: string,
    tenantId?: string | null,
    organizationId?: string | null,
  ): Promise<SudoProtectionResolution> {
    await this.ensureDeveloperDefaultsRegistered()

    const candidates = await this.em.find(SudoChallengeConfig, {
      targetIdentifier,
      deletedAt: null,
    })

    const resolved = candidates
      .filter((config) => this.matchesScope(config, tenantId ?? null, organizationId ?? null))
      .sort((left, right) => this.compareConfigPriority(left, right, tenantId ?? null, organizationId ?? null))[0]

    if (!resolved || !resolved.isEnabled) {
      return { protected: false }
    }

    return { protected: true, config: resolved }
  }

  async initiate(
    userId: string,
    targetIdentifier: string,
    options?: { tenantId?: string | null; organizationId?: string | null },
  ): Promise<{
    required: boolean
    sessionId?: string
    method?: SudoMethod
    availableMfaMethods?: SudoAvailableMethod[]
    expiresAt?: Date
  }> {
    const protection = await this.isProtected(
      targetIdentifier,
      options?.tenantId ?? null,
      options?.organizationId ?? null,
    )

    if (!protection.protected || !protection.config) {
      return { required: false }
    }

    const user = await this.findUserScope(userId)
    if (!user?.tenantId) {
      throw new SudoChallengeServiceError('User not found', 404)
    }

    const userMethods = await this.mfaService.getUserMethods(userId)
    const method = this.resolveChallengeMethod(protection.config.challengeMethod, userMethods.length)

    let sessionToken = randomBytes(16).toString('hex')
    let availableMfaMethods: SudoAvailableMethod[] | undefined
    if (method === 'mfa') {
      const challenge = await this.mfaVerificationService.createChallenge(userId)
      sessionToken = challenge.challengeId
      availableMfaMethods = challenge.availableMethods
    }

    const expiresAt = new Date(Date.now() + this.securityConfig.sudo.pendingChallengeTtlMs)
    const session = this.em.create(SudoSession, {
      userId,
      tenantId: user.tenantId,
      sessionToken,
      challengeMethod: method,
      expiresAt,
      createdAt: new Date(),
    })
    this.em.persist(session)
    await this.em.flush()

    await emitSecurityEvent('security.sudo.challenged', {
      userId,
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      targetIdentifier,
      method,
    })

    return {
      required: true,
      sessionId: session.id,
      method,
      availableMfaMethods,
      expiresAt,
    }
  }

  async prepare(
    sessionId: string,
    methodType: string,
    request?: Request,
  ): Promise<{ clientData?: Record<string, unknown> }> {
    const session = await this.getPendingSession(sessionId)
    if (session.challengeMethod !== 'mfa') {
      throw new SudoChallengeServiceError('This sudo session does not require MFA', 400)
    }
    return this.mfaVerificationService.prepareChallenge(session.sessionToken, methodType, { request })
  }

  async verify(
    sessionId: string,
    methodType: string,
    payload: unknown,
    options: {
      expectedUserId?: string
      tenantId?: string | null
      organizationId?: string | null
      targetIdentifier: string
    },
    request?: Request,
  ): Promise<{ sudoToken: string; expiresAt: Date }> {
    const session = await this.getPendingSession(sessionId)
    if (options.expectedUserId && session.userId !== options.expectedUserId) {
      throw new SudoChallengeServiceError('Sudo challenge user mismatch', 403)
    }
    const user = await this.findUserScope(session.userId)
    if (!user?.tenantId) {
      throw new SudoChallengeServiceError('User not found', 404)
    }

    const scopeTenantId = options.tenantId !== undefined ? options.tenantId : user.tenantId
    const scopeOrganizationId = options.organizationId !== undefined ? options.organizationId : user.organizationId
    const protection = await this.isProtected(
      options.targetIdentifier,
      scopeTenantId,
      scopeOrganizationId,
    )
    if (!protection.protected || !protection.config) {
      throw new SudoChallengeServiceError('Sudo protection is not configured for this target', 404)
    }

    let verified = false
    let methodUsed: string = methodType
    if (session.challengeMethod === 'password') {
      const password = this.readPassword(payload)
      verified = await this.passwordService.verifyPassword(session.userId, password)
      methodUsed = SudoChallengeMethodUsed.PASSWORD
    } else {
      verified = await this.mfaVerificationService.verifyChallenge(session.sessionToken, methodType, payload, { request })
    }

    if (!verified) {
      await emitSecurityEvent('security.sudo.failed', {
        userId: session.userId,
        tenantId: user.tenantId,
        organizationId: user.organizationId,
        targetIdentifier: options.targetIdentifier,
        method: methodUsed,
      })
      throw new SudoChallengeServiceError('Unable to verify sudo challenge', 401)
    }

    const ttlSeconds = this.normalizeTtl(protection.config.ttlSeconds)
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    const sudoToken = this.signToken({
      sid: session.id,
      sub: session.userId,
      tid: scopeTenantId,
      oid: scopeOrganizationId,
      tgt: options.targetIdentifier,
      exp: expiresAt.getTime(),
    })

    session.sessionToken = sudoToken
    session.challengeMethod = methodUsed
    session.expiresAt = expiresAt
    await this.em.flush()

    await emitSecurityEvent('security.sudo.verified', {
      userId: session.userId,
      tenantId: scopeTenantId,
      organizationId: scopeOrganizationId,
      targetIdentifier: options.targetIdentifier,
      method: methodUsed,
      expiresAt: expiresAt.toISOString(),
    })

    return { sudoToken, expiresAt }
  }

  async validateToken(
    token: string,
    targetIdentifier: string,
    options?: {
      expectedUserId?: string
      tenantId?: string | null
      organizationId?: string | null
    },
  ): Promise<boolean> {
    if (!token) return false
    const payload = this.readSignedToken(token)
    if (!payload) return false
    if (payload.exp <= Date.now()) return false
    if (payload.tgt !== targetIdentifier) return false
    if (options?.expectedUserId && payload.sub !== options.expectedUserId) return false
    if (options?.tenantId !== undefined && payload.tid !== (options.tenantId ?? null)) return false
    if (options?.organizationId !== undefined && payload.oid !== (options.organizationId ?? null)) return false

    const session = await this.em.findOne(SudoSession, {
      id: payload.sid,
      userId: payload.sub,
      sessionToken: token,
    } as FilterQuery<SudoSession>)

    return Boolean(session && session.expiresAt.getTime() > Date.now())
  }

  async createConfig(input: SudoConfigInput, configuredBy: string): Promise<SudoChallengeConfig> {
    await this.ensureDeveloperDefaultsRegistered()
    this.validateScope(input.tenantId ?? null, input.organizationId ?? null)
    await this.ensureUniqueConfig(input.targetIdentifier, input.tenantId ?? null, input.organizationId ?? null)

    const config = this.em.create(SudoChallengeConfig, {
      tenantId: input.tenantId ?? null,
      organizationId: input.organizationId ?? null,
      label: input.label ?? null,
      targetIdentifier: input.targetIdentifier,
      isEnabled: input.isEnabled,
      ttlSeconds: this.normalizeTtl(input.ttlSeconds),
      challengeMethod: input.challengeMethod,
      configuredBy,
      isDeveloperDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    this.em.persist(config)
    await this.em.flush()

    await emitSecurityEvent('security.sudo.config.created', {
      id: config.id,
      targetIdentifier: config.targetIdentifier,
      configuredBy,
    })

    return config
  }

  async updateConfig(id: string, input: SudoConfigUpdateInput, configuredBy: string): Promise<SudoChallengeConfig> {
    await this.ensureDeveloperDefaultsRegistered()
    const config = await this.em.findOne(SudoChallengeConfig, { id, deletedAt: null })
    if (!config) {
      throw new SudoChallengeServiceError('Sudo configuration not found', 404)
    }

    const nextTenantId = input.tenantId !== undefined ? input.tenantId ?? null : config.tenantId ?? null
    const nextOrganizationId = input.organizationId !== undefined ? input.organizationId ?? null : config.organizationId ?? null
    const nextTargetIdentifier = input.targetIdentifier ?? config.targetIdentifier
    this.validateScope(nextTenantId, nextOrganizationId)
    await this.ensureUniqueConfig(nextTargetIdentifier, nextTenantId, nextOrganizationId, config.id)

    if (input.tenantId !== undefined) config.tenantId = input.tenantId ?? null
    if (input.organizationId !== undefined) config.organizationId = input.organizationId ?? null
    if (input.label !== undefined) config.label = input.label ?? null
    if (input.targetIdentifier !== undefined) config.targetIdentifier = input.targetIdentifier
    if (input.isEnabled !== undefined) config.isEnabled = input.isEnabled
    if (input.ttlSeconds !== undefined) config.ttlSeconds = this.normalizeTtl(input.ttlSeconds)
    if (input.challengeMethod !== undefined) config.challengeMethod = input.challengeMethod
    config.configuredBy = configuredBy
    config.updatedAt = new Date()
    await this.em.flush()

    await emitSecurityEvent('security.sudo.config.updated', {
      id: config.id,
      targetIdentifier: config.targetIdentifier,
      configuredBy,
    })

    return config
  }

  async deleteConfig(id: string): Promise<void> {
    const config = await this.em.findOne(SudoChallengeConfig, { id, deletedAt: null })
    if (!config) {
      throw new SudoChallengeServiceError('Sudo configuration not found', 404)
    }
    config.deletedAt = new Date()
    config.updatedAt = new Date()
    await this.em.flush()

    await emitSecurityEvent('security.sudo.config.deleted', {
      id: config.id,
      targetIdentifier: config.targetIdentifier,
    })
  }

  async registerDeveloperDefault(
    input: DeveloperDefaultPayload,
  ): Promise<void> {
    const existing = await this.em.findOne(SudoChallengeConfig, {
      targetIdentifier: input.targetIdentifier,
      tenantId: null,
      organizationId: null,
      isDeveloperDefault: true,
    })

    if (existing) {
      existing.isEnabled = true
      existing.deletedAt = null
      existing.ttlSeconds = this.normalizeTtl(input.ttlSeconds)
      existing.challengeMethod = input.challengeMethod ?? ChallengeMethod.AUTO
      existing.updatedAt = new Date()
      await this.em.flush()
      return
    }

    const config = this.em.create(SudoChallengeConfig, {
      tenantId: null,
      organizationId: null,
      label: input.label ?? null,
      targetIdentifier: input.targetIdentifier,
      isEnabled: true,
      isDeveloperDefault: true,
      ttlSeconds: this.normalizeTtl(input.ttlSeconds),
      challengeMethod: input.challengeMethod ?? ChallengeMethod.AUTO,
      configuredBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    this.em.persist(config)
    await this.em.flush()
  }

  async cleanupExpired(): Promise<number> {
    return this.em.nativeDelete(SudoSession, {
      expiresAt: { $lte: new Date() },
    })
  }

  private async ensureDeveloperDefaultsRegistered(): Promise<void> {
    const registryEntries = getSecuritySudoTargetEntries()
    const registryTargets = registryEntries.flatMap((entry) => entry.targets ?? [])
    const fallbackTargets = registryEntries.length === 0 ? defaultSudoTargets : []

    for (const target of dedupeSudoTargets([
      ...registryTargets,
      ...fallbackTargets,
    ])) {
      await this.registerDeveloperDefault(this.readDeveloperDefault(target))
    }
  }

  private readDeveloperDefault(target: SecuritySudoTarget): DeveloperDefaultPayload {
    return {
      targetIdentifier: target.identifier,
      label: target.label ?? null,
      ttlSeconds: target.ttlSeconds,
      challengeMethod: this.toChallengeMethod(target.challengeMethod),
    }
  }

  private async ensureUniqueConfig(
    targetIdentifier: string,
    tenantId: string | null,
    organizationId: string | null,
    ignoreId?: string,
  ): Promise<void> {
    const existing = await this.em.findOne(SudoChallengeConfig, {
      targetIdentifier,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (existing && existing.id !== ignoreId) {
      throw new SudoChallengeServiceError('A sudo configuration for this target and scope already exists', 409)
    }
  }

  private validateScope(tenantId: string | null, organizationId: string | null): void {
    if (organizationId && !tenantId) {
      throw new SudoChallengeServiceError('Organization-scoped sudo config requires a tenant', 400)
    }
  }

  private resolveChallengeMethod(
    configuredMethod: ChallengeMethod,
    availableMfaMethodCount: number,
  ): SudoMethod {
    if (this.securityConfig.mfa.emergencyBypass) {
      return 'password'
    }
    if (configuredMethod === ChallengeMethod.PASSWORD) return 'password'
    if (configuredMethod === ChallengeMethod.MFA) {
      if (availableMfaMethodCount === 0) {
        throw new SudoChallengeServiceError('This sudo target requires MFA, but no MFA methods are configured', 400)
      }
      return 'mfa'
    }
    return availableMfaMethodCount > 0 ? 'mfa' : 'password'
  }

  private matchesScope(config: SudoChallengeConfig, tenantId: string | null, organizationId: string | null): boolean {
    if (config.organizationId) {
      return config.organizationId === organizationId && config.tenantId === tenantId
    }
    if (config.tenantId) {
      return config.tenantId === tenantId
    }
    return true
  }

  private compareConfigPriority(
    left: SudoChallengeConfig,
    right: SudoChallengeConfig,
    tenantId: string | null,
    organizationId: string | null,
  ): number {
    const leftScore = this.getScopePriority(left, tenantId, organizationId)
    const rightScore = this.getScopePriority(right, tenantId, organizationId)
    if (leftScore !== rightScore) return leftScore - rightScore
    if (left.isDeveloperDefault !== right.isDeveloperDefault) {
      return left.isDeveloperDefault ? 1 : -1
    }
    return right.updatedAt.getTime() - left.updatedAt.getTime()
  }

  private getScopePriority(
    config: SudoChallengeConfig,
    tenantId: string | null,
    organizationId: string | null,
  ): number {
    if (config.organizationId === organizationId && config.tenantId === tenantId) return 0
    if (!config.organizationId && config.tenantId === tenantId) return 1
    if (!config.organizationId && !config.tenantId && !config.isDeveloperDefault) return 2
    if (!config.organizationId && !config.tenantId && config.isDeveloperDefault) return 3
    return 4
  }

  private async getPendingSession(sessionId: string): Promise<SudoSession> {
    const session = await this.em.findOne(SudoSession, { id: sessionId })
    if (!session) {
      throw new SudoChallengeServiceError('Sudo challenge session not found', 404)
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new SudoChallengeServiceError('Sudo challenge session expired', 400)
    }
    return session
  }

  private async findUserScope(userId: string): Promise<UserScope | null> {
    const user = await findOneWithDecryption(
      this.em,
      User,
      { id: userId, deletedAt: null },
      undefined,
      {},
    )

    if (!user) return null
    return {
      id: String(user.id),
      tenantId: user.tenantId ? String(user.tenantId) : null,
      organizationId: user.organizationId ? String(user.organizationId) : null,
    }
  }

  private normalizeTtl(value?: number | null): number {
    const rawValue = value ?? this.securityConfig.sudo.defaultTtlSeconds
    return Math.min(
      Math.max(rawValue, this.securityConfig.sudo.minTtlSeconds),
      this.securityConfig.sudo.maxTtlSeconds,
    )
  }

  private readPassword(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      throw new SudoChallengeServiceError('Password is required', 400)
    }
    const maybePassword = (payload as Record<string, unknown>).password
    if (typeof maybePassword !== 'string' || maybePassword.trim().length === 0) {
      throw new SudoChallengeServiceError('Password is required', 400)
    }
    return maybePassword
  }

  private signToken(payload: SignedSudoTokenPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', this.getSudoSecret()).update(encodedPayload).digest('base64url')
    return `${encodedPayload}.${signature}`
  }

  private readSignedToken(token: string): SignedSudoTokenPayload | null {
    const [encodedPayload, signature] = token.split('.')
    if (!encodedPayload || !signature) return null

    const expected = createHmac('sha256', this.getSudoSecret()).update(encodedPayload).digest('base64url')
    const signatureBuffer = Buffer.from(signature)
    const expectedBuffer = Buffer.from(expected)
    if (signatureBuffer.length !== expectedBuffer.length) return null
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null

    try {
      const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as SignedSudoTokenPayload
      if (!parsed || typeof parsed !== 'object') return null
      return parsed
    } catch {
      return null
    }
  }

  private getSudoSecret(): string {
    return process.env.OM_SECURITY_SUDO_SECRET
      ?? process.env.AUTH_JWT_SECRET
      ?? process.env.JWT_SECRET
      ?? 'open-mercato-sudo-secret'
  }

  private toChallengeMethod(
    method: SecuritySudoTarget['challengeMethod'],
  ): ChallengeMethod | undefined {
    switch (method) {
      case 'password':
        return ChallengeMethod.PASSWORD
      case 'mfa':
        return ChallengeMethod.MFA
      case 'auto':
      default:
        return ChallengeMethod.AUTO
    }
  }
}

export default SudoChallengeService
