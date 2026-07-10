import type { FilterQuery, RequiredEntityData } from '@mikro-orm/core'
import { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { SsoConfig, ScimToken } from '../data/entities'
import type { SsoConfigAdminCreateInput, SsoConfigAdminUpdateInput, SsoConfigListQuery } from '../data/validators'
import { emitSsoEvent } from '../events'
import { validateDomain, normalizeDomain, uniqueDomains, checkDomainLimit } from '../lib/domains'
import type { SsoProviderRegistry } from '../lib/registry'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('sso').child({ component: 'config' })

export interface SsoAdminScope {
  isSuperAdmin: boolean
  organizationId: string | null
  tenantId: string | null
}

export interface SsoConfigPublic {
  id: string
  name: string | null
  tenantId: string | null
  organizationId: string
  protocol: string
  issuer: string | null
  clientId: string | null
  hasClientSecret: boolean
  allowedDomains: string[]
  jitEnabled: boolean
  autoLinkByEmail: boolean
  isActive: boolean
  ssoRequired: boolean
  appRoleMappings: Record<string, string>
  createdAt: Date
  updatedAt: Date
}

export class SsoConfigService {
  constructor(
    private em: EntityManager,
    private tenantEncryptionService: TenantDataEncryptionService,
    private ssoProviderRegistry: SsoProviderRegistry,
  ) {}

  async list(scope: SsoAdminScope, query: SsoConfigListQuery): Promise<{
    items: SsoConfigPublic[]
    total: number
    totalPages: number
  }> {
    const where: FilterQuery<SsoConfig> = { deletedAt: null }

    if (!scope.isSuperAdmin) {
      if (!scope.organizationId) {
        throw new SsoConfigError('Organization context is required', 403)
      }
      where.organizationId = scope.organizationId
    } else {
      if (query.organizationId) where.organizationId = query.organizationId
      if (query.tenantId) where.tenantId = query.tenantId
    }

    if (query.search) {
      const pattern = `%${escapeLikePattern(query.search)}%`
      where.$or = [
        { name: { $ilike: pattern } },
        { issuer: { $ilike: pattern } },
        { clientId: { $ilike: pattern } },
      ]
    }

    const [configs, total] = await this.em.findAndCount(SsoConfig, where, {
      orderBy: { createdAt: 'desc' },
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    })

    return {
      items: configs.map((c) => this.toPublic(c)),
      total,
      totalPages: Math.ceil(total / query.pageSize) || 1,
    }
  }

  async getById(scope: SsoAdminScope, id: string): Promise<SsoConfigPublic | null> {
    const where: FilterQuery<SsoConfig> = { id, deletedAt: null }
    if (!scope.isSuperAdmin) {
      if (!scope.organizationId) throw new SsoConfigError('Organization context is required', 403)
      where.organizationId = scope.organizationId
    }

    const config = await this.em.findOne(SsoConfig, where)
    return config ? this.toPublic(config) : null
  }

  async create(scope: SsoAdminScope, input: SsoConfigAdminCreateInput): Promise<SsoConfigPublic> {
    const orgId = scope.isSuperAdmin ? input.organizationId : scope.organizationId!
    const tenId = scope.isSuperAdmin ? (input.tenantId ?? null) : scope.tenantId

    const existing = await this.em.findOne(SsoConfig, {
      organizationId: orgId,
      deletedAt: null,
    })
    if (existing) {
      throw new SsoConfigError('An SSO configuration already exists for this organization', 409)
    }

    const domains = uniqueDomains(input.allowedDomains)
    for (const d of domains) {
      const result = validateDomain(d)
      if (!result.valid) throw new SsoConfigError(`Invalid domain "${d}": ${result.error}`, 400)
    }

    const encrypted = await this.tenantEncryptionService.encryptEntityPayload(
      'SsoConfig',
      { clientSecretEnc: input.clientSecret },
      tenId,
      orgId,
    )

    const config = this.em.create(SsoConfig, {
      name: input.name,
      tenantId: tenId,
      organizationId: orgId,
      protocol: input.protocol,
      issuer: input.issuer,
      clientId: input.clientId,
      clientSecretEnc: encrypted.clientSecretEnc as string,
      allowedDomains: domains,
      jitEnabled: input.jitEnabled,
      autoLinkByEmail: input.autoLinkByEmail,
      isActive: false,
      ssoRequired: false,
      appRoleMappings: input.appRoleMappings ?? {},
    } as RequiredEntityData<SsoConfig>)

    await this.em.persist(config).flush()

    void emitSsoEvent('sso.config.created', {
      id: config.id,
      tenantId: config.tenantId,
      organizationId: config.organizationId,
    }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))

    return this.toPublic(config)
  }

  async update(scope: SsoAdminScope, id: string, input: SsoConfigAdminUpdateInput): Promise<SsoConfigPublic> {
    const config = await this.resolveConfig(scope, id)

    if (input.name !== undefined) config.name = input.name
    if (input.protocol !== undefined) config.protocol = input.protocol
    if (input.issuer !== undefined) config.issuer = input.issuer
    if (input.clientId !== undefined) config.clientId = input.clientId
    if (input.jitEnabled !== undefined) {
      if (input.jitEnabled) {
        const activeScimCount = await this.em.count(ScimToken, { ssoConfigId: id, isActive: true })
        if (activeScimCount > 0) {
          throw new SsoConfigError('Cannot enable JIT provisioning while SCIM directory sync is active. Revoke all SCIM tokens first.', 409)
        }
      }
      config.jitEnabled = input.jitEnabled
    }
    if (input.autoLinkByEmail !== undefined) config.autoLinkByEmail = input.autoLinkByEmail
    if (input.appRoleMappings !== undefined) config.appRoleMappings = input.appRoleMappings

    if (input.clientSecret !== undefined) {
      const encrypted = await this.tenantEncryptionService.encryptEntityPayload(
        'SsoConfig',
        { clientSecretEnc: input.clientSecret },
        config.tenantId,
        config.organizationId,
      )
      config.clientSecretEnc = encrypted.clientSecretEnc as string
    }

    await this.em.flush()

    void emitSsoEvent('sso.config.updated', {
      id: config.id,
      tenantId: config.tenantId,
      organizationId: config.organizationId,
    }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))

    return this.toPublic(config)
  }

  async delete(scope: SsoAdminScope, id: string): Promise<void> {
    const config = await this.resolveConfig(scope, id)

    if (config.isActive) {
      throw new SsoConfigError('Cannot delete an active SSO configuration — deactivate it first', 400)
    }

    config.deletedAt = new Date()
    await this.em.flush()

    void emitSsoEvent('sso.config.deleted', {
      id: config.id,
      tenantId: config.tenantId,
      organizationId: config.organizationId,
    }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))
  }

  async activate(scope: SsoAdminScope, id: string, active: boolean): Promise<SsoConfigPublic> {
    return this.em.transactional(async (txEm) => {
      const tx = txEm as EntityManager
      await this.lockActiveDomainMutation(tx, id)
      const config = await this.resolveConfig(scope, id, tx)

      if (active) {
        if (config.allowedDomains.length === 0) {
          throw new SsoConfigError('Cannot activate SSO configuration with no allowed domains', 400)
        }

        await this.lockActiveDomains(tx, config.allowedDomains)
        await this.assertActiveDomainAvailability(tx, config.allowedDomains, config.id)

        const testResult = await this.testConnectionInternal(config)
        if (!testResult.ok) {
          throw new SsoConfigError(`Cannot activate — discovery failed: ${testResult.error}`, 400)
        }
      }

      const wasActive = config.isActive
      config.isActive = active
      await tx.flush()

      if (active && !wasActive) {
        void emitSsoEvent('sso.config.activated', {
          id: config.id,
          tenantId: config.tenantId,
          organizationId: config.organizationId,
        }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))
      } else if (!active && wasActive) {
        void emitSsoEvent('sso.config.deactivated', {
          id: config.id,
          tenantId: config.tenantId,
          organizationId: config.organizationId,
        }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))
      }

      return this.toPublic(config)
    })
  }

  async testConnection(scope: SsoAdminScope, id: string): Promise<{ ok: boolean; error?: string }> {
    const config = await this.resolveConfig(scope, id)
    return this.testConnectionInternal(config)
  }

  async addDomain(scope: SsoAdminScope, id: string, domain: string): Promise<SsoConfigPublic> {
    const normalized = normalizeDomain(domain)
    const validation = validateDomain(normalized)
    if (!validation.valid) throw new SsoConfigError(validation.error!, 400)

    return this.em.transactional(async (txEm) => {
      const tx = txEm as EntityManager
      await this.lockActiveDomainMutation(tx, id, [normalized])
      const config = await this.resolveConfig(scope, id, tx)

      if (config.allowedDomains.some((d) => normalizeDomain(d) === normalized)) {
        return this.toPublic(config)
      }

      const limitCheck = checkDomainLimit(config.allowedDomains.length, 1)
      if (!limitCheck.ok) throw new SsoConfigError(limitCheck.error!, 400)

      if (config.isActive) {
        await this.assertActiveDomainAvailability(tx, [...config.allowedDomains, normalized], config.id)
      }

      config.allowedDomains = [...config.allowedDomains, normalized]
      await tx.flush()

      void emitSsoEvent('sso.domain.added', {
        id: config.id,
        tenantId: config.tenantId,
        organizationId: config.organizationId,
        domain: normalized,
      }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))

      return this.toPublic(config)
    })
  }

  async removeDomain(scope: SsoAdminScope, id: string, domain: string): Promise<SsoConfigPublic> {
    const normalized = normalizeDomain(domain)
    const config = await this.resolveConfig(scope, id)

    config.allowedDomains = config.allowedDomains.filter((d) => d !== normalized)
    await this.em.flush()

    void emitSsoEvent('sso.domain.removed', {
      id: config.id,
      tenantId: config.tenantId,
      organizationId: config.organizationId,
      domain: normalized,
    }).catch((eventError) => logger.error('SSO event emit failed', { err: eventError }))

    return this.toPublic(config)
  }

  toPublic(config: SsoConfig): SsoConfigPublic {
    return {
      id: config.id,
      name: config.name ?? null,
      tenantId: config.tenantId ?? null,
      organizationId: config.organizationId,
      protocol: config.protocol,
      issuer: config.issuer ?? null,
      clientId: config.clientId ?? null,
      hasClientSecret: !!config.clientSecretEnc,
      allowedDomains: config.allowedDomains,
      jitEnabled: config.jitEnabled,
      autoLinkByEmail: config.autoLinkByEmail,
      isActive: config.isActive,
      ssoRequired: config.ssoRequired,
      appRoleMappings: config.appRoleMappings ?? {},
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }
  }

  private async resolveConfig(scope: SsoAdminScope, id: string, em: EntityManager = this.em): Promise<SsoConfig> {
    const where: FilterQuery<SsoConfig> = { id, deletedAt: null }
    if (!scope.isSuperAdmin) {
      if (!scope.organizationId) throw new SsoConfigError('Organization context is required', 403)
      where.organizationId = scope.organizationId
    }

    const config = await em.findOne(SsoConfig, where)
    if (!config) throw new SsoConfigError('SSO configuration not found', 404)

    return config
  }

  private async testConnectionInternal(config: SsoConfig): Promise<{ ok: boolean; error?: string }> {
    const provider = this.ssoProviderRegistry.resolve(config.protocol)
    if (!provider) return { ok: false, error: `No provider for protocol: ${config.protocol}` }

    return provider.validateConfig(config)
  }

  private async lockActiveDomainMutation(em: EntityManager, configId: string, domains: string[] = []): Promise<void> {
    const lockKeys = [
      `sso:sso_config:${configId}`,
      ...uniqueDomains(domains)
        .sort((a, b) => a.localeCompare(b))
        .map((domain) => `sso:allowed_domain:${domain}`),
    ]

    await this.lockKeys(em, lockKeys)
  }

  private async lockActiveDomains(em: EntityManager, domains: string[]): Promise<void> {
    const lockKeys = uniqueDomains(domains)
      .sort((a, b) => a.localeCompare(b))
      .map((domain) => `sso:allowed_domain:${domain}`)
    await this.lockKeys(em, lockKeys)
  }

  private async lockKeys(em: EntityManager, lockKeys: string[]): Promise<void> {
    for (const lockKey of lockKeys) {
      await em.getConnection().execute('select pg_advisory_xact_lock(hashtext(?::text))', [lockKey])
    }
  }

  private async assertActiveDomainAvailability(
    em: EntityManager,
    domains: string[],
    currentConfigId: string,
  ): Promise<void> {
    const requestedDomains = new Set(uniqueDomains(domains))
    if (requestedDomains.size === 0) return

    const activeConfigs = await findWithDecryption(
      em,
      SsoConfig,
      { isActive: true, deletedAt: null },
      {},
      { tenantId: null },
    )
    const conflictDomain = activeConfigs
      .filter((config) => config.id !== currentConfigId)
      .flatMap((config) => config.allowedDomains.map(normalizeDomain))
      .find((domain) => requestedDomains.has(domain))

    if (conflictDomain) {
      throw new SsoConfigError(
        `SSO domain "${conflictDomain}" is already claimed by another active SSO configuration`,
        409,
      )
    }
  }
}

export class SsoConfigError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'SsoConfigError'
  }
}
