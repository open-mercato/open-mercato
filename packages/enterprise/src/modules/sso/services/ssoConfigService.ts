import { organizationEventScope } from '@open-mercato/shared/lib/events/organization-scope'
import { LockMode, type FilterQuery, type RequiredEntityData } from '@mikro-orm/core'
import { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { SsoConfig, ScimToken } from '../data/entities'
import type { SsoConfigAdminCreateInput, SsoConfigAdminUpdateInput, SsoConfigListQuery } from '../data/validators'
import { emitSsoEvent } from '../events'
import { validateDomain, normalizeDomain, uniqueDomains, checkDomainLimit, MAX_DOMAINS_PER_CONFIG, type DomainValidationResult } from '../lib/domains'
import type { SsoProviderRegistry } from '../lib/registry'
import { isBrandedSsoHttpError, type SsoErrorTranslation, type SsoErrorTranslationParams } from '../lib/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { SsoAuthorizationService } from './ssoAuthorizationService'

const logger = createLogger('sso').child({ component: 'config' })

function reportSsoEventFailure(eventError: unknown): void {
  logger.error('SSO event emit failed', { err: eventError })
  try {
    getTelemetryRuntime()?.reportError(eventError, { module: 'sso', code: 'sso.event_emit_failed' })
  } catch (telemetryError) {
    logger.warn('SSO telemetry reporting failed', { err: telemetryError })
  }
}

export interface SsoAdminScope {
  actorUserId?: string | null
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
    private ssoAuthorizationService?: SsoAuthorizationService,
  ) {}

  async list(scope: SsoAdminScope, query: SsoConfigListQuery): Promise<{
    items: SsoConfigPublic[]
    total: number
    totalPages: number
  }> {
    const where: FilterQuery<SsoConfig> = { deletedAt: null }

    if (!scope.isSuperAdmin) {
      if (!scope.organizationId) {
        throw new SsoConfigError('Organization context is required', 403, { key: 'sso.errors.organizationRequired' })
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
      if (!scope.organizationId) throw new SsoConfigError('Organization context is required', 403, { key: 'sso.errors.organizationRequired' })
      where.organizationId = scope.organizationId
    }

    const config = await this.em.findOne(SsoConfig, where)
    return config ? this.toPublic(config) : null
  }

  async create(scope: SsoAdminScope, input: SsoConfigAdminCreateInput): Promise<SsoConfigPublic> {
    const result = await this.em.transactional(async (tx) => {
      const orgId = scope.isSuperAdmin ? input.organizationId : scope.organizationId!
      const tenId = scope.isSuperAdmin ? (input.tenantId ?? null) : scope.tenantId

      const existing = await tx.findOne(SsoConfig, {
        organizationId: orgId,
        deletedAt: null,
      })
      if (existing) {
        const { translate } = await resolveTranslations()
        throw new SsoConfigError(
          translate('sso.admin.error.alreadyExists', 'An SSO configuration already exists for this organization'),
          409,
          { key: 'sso.admin.error.alreadyExists' },
        )
      }

      const domains = uniqueDomains(input.allowedDomains)
      for (const domain of domains) {
        const result = validateDomain(domain)
        if (!result.valid) throw invalidDomainError(domain, result)
      }

      await this.authorizeConfiguration(tx, {
        tenantId: tenId,
        organizationId: orgId,
        appRoleMappings: input.appRoleMappings ?? {},
      } as SsoConfig, scope)

      const encrypted = await this.tenantEncryptionService.encryptEntityPayload(
        'SsoConfig',
        { clientSecretEnc: input.clientSecret },
        tenId,
        orgId,
      )

      const config = tx.create(SsoConfig, {
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
        authorizationUserId: scope.actorUserId,
      } as RequiredEntityData<SsoConfig>)

      await tx.persist(config).flush()

      return this.toPublic(config)
    })

    void emitSsoEvent('sso.config.created', {
      id: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }, organizationEventScope(result)).catch(reportSsoEventFailure)

    return result
  }

  async update(scope: SsoAdminScope, id: string, input: SsoConfigAdminUpdateInput): Promise<SsoConfigPublic> {
    const result = await this.em.transactional(async (tx) => {
      const config = await this.resolveConfig(scope, id, tx, true)
      await this.authorizeConfiguration(tx, {
        ...config,
        appRoleMappings: input.appRoleMappings ?? config.appRoleMappings,
      } as SsoConfig, scope)

      if (input.jitEnabled === true && await tx.count(ScimToken, { ssoConfigId: id, isActive: true }) > 0) {
        throw new SsoConfigError('Cannot enable JIT provisioning while SCIM directory sync is active. Revoke all SCIM tokens first.', 409, { key: 'sso.errors.jitBlockedByScim' })
      }

      config.authorizationUserId = scope.actorUserId
      if (input.name !== undefined) config.name = input.name
      if (input.protocol !== undefined) config.protocol = input.protocol
      if (input.issuer !== undefined) config.issuer = input.issuer
      if (input.clientId !== undefined) config.clientId = input.clientId
      if (input.jitEnabled !== undefined) config.jitEnabled = input.jitEnabled
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

      await tx.flush()

      return this.toPublic(config)
    })

    void emitSsoEvent('sso.config.updated', {
      id: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }, organizationEventScope(result)).catch(reportSsoEventFailure)

    return result
  }

  async delete(scope: SsoAdminScope, id: string): Promise<void> {
    const config = await this.resolveConfig(scope, id)

    if (config.isActive) {
      throw new SsoConfigError('Cannot delete an active SSO configuration — deactivate it first', 400, { key: 'sso.admin.error.deleteActive' })
    }

    config.deletedAt = new Date()
    await this.em.flush()

    void emitSsoEvent('sso.config.deleted', {
      id: config.id,
      tenantId: config.tenantId,
      organizationId: config.organizationId,
    }, organizationEventScope(config)).catch(reportSsoEventFailure)
  }

  async activate(scope: SsoAdminScope, id: string, active: boolean): Promise<SsoConfigPublic> {
    return this.em.transactional(async (txEm) => {
      const tx = txEm as EntityManager
      await this.lockActiveDomainMutation(tx, id)
      const config = await this.resolveConfig(scope, id, tx, true)

      if (active) {
        await this.authorizeConfiguration(tx, config, scope)
        if (config.allowedDomains.length === 0) {
          throw new SsoConfigError('Cannot activate SSO configuration with no allowed domains', 400, { key: 'sso.admin.error.noDomainsForActivation' })
        }

        await this.lockActiveDomains(tx, config.allowedDomains)
        await this.assertActiveDomainAvailability(tx, config.allowedDomains, config.id)

        const testResult = await this.testConnectionInternal(config)
        if (!testResult.ok) {
          throw new SsoConfigError(`Cannot activate — discovery failed: ${testResult.error}`, 400, {
            key: 'sso.errors.activationDiscoveryFailed',
            params: { error: testResult.error ?? '' },
          })
        }
      }

      if (active) config.authorizationUserId = scope.actorUserId
      const wasActive = config.isActive
      config.isActive = active
      await tx.flush()

      if (active && !wasActive) {
        void emitSsoEvent('sso.config.activated', {
          id: config.id,
          tenantId: config.tenantId,
          organizationId: config.organizationId,
        }, organizationEventScope(config)).catch(reportSsoEventFailure)
      } else if (!active && wasActive) {
        void emitSsoEvent('sso.config.deactivated', {
          id: config.id,
          tenantId: config.tenantId,
          organizationId: config.organizationId,
        }, organizationEventScope(config)).catch(reportSsoEventFailure)
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
    if (!validation.valid) throw invalidDomainError(normalized, validation)

    return this.em.transactional(async (txEm) => {
      const tx = txEm as EntityManager
      await this.lockActiveDomainMutation(tx, id, [normalized])
      const config = await this.resolveConfig(scope, id, tx, true)

      await this.authorizeConfiguration(tx, config, scope)

      if (config.allowedDomains.some((d) => normalizeDomain(d) === normalized)) {
        return this.toPublic(config)
      }

      const limitCheck = checkDomainLimit(config.allowedDomains.length, 1)
      if (!limitCheck.ok) {
        throw new SsoConfigError(limitCheck.error!, 400, {
          key: 'sso.admin.wizard.domain.limit',
          params: { max: MAX_DOMAINS_PER_CONFIG },
        })
      }

      if (config.isActive) {
        await this.assertActiveDomainAvailability(tx, [...config.allowedDomains, normalized], config.id)
      }

      config.authorizationUserId = scope.actorUserId
      config.allowedDomains = [...config.allowedDomains, normalized]
      await tx.flush()

      void emitSsoEvent('sso.domain.added', {
        id: config.id,
        tenantId: config.tenantId,
        organizationId: config.organizationId,
        domain: normalized,
      }, organizationEventScope(config)).catch(reportSsoEventFailure)

      return this.toPublic(config)
    })
  }

  async removeDomain(scope: SsoAdminScope, id: string, domain: string): Promise<SsoConfigPublic> {
    const normalized = normalizeDomain(domain)
    const result = await this.em.transactional(async (tx) => {
      const config = await this.resolveConfig(scope, id, tx, true)
      await this.authorizeConfiguration(tx, config, scope)
      config.authorizationUserId = scope.actorUserId

      config.allowedDomains = config.allowedDomains.filter((d) => d !== normalized)
      await tx.flush()

      return this.toPublic(config)
    })

    void emitSsoEvent('sso.domain.removed', {
      id: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      domain: normalized,
    }, organizationEventScope(result)).catch(reportSsoEventFailure)

    return result
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

  private async resolveConfig(scope: SsoAdminScope, id: string, em: EntityManager = this.em, lock = false): Promise<SsoConfig> {
    const where: FilterQuery<SsoConfig> = { id, deletedAt: null }
    if (!scope.isSuperAdmin) {
      if (!scope.organizationId) throw new SsoConfigError('Organization context is required', 403, { key: 'sso.errors.organizationRequired' })
      where.organizationId = scope.organizationId
    }

    const config = await em.findOne(SsoConfig, where, lock ? { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } : {})
    if (!config) {
      const { translate } = await resolveTranslations()
      throw new SsoConfigError(translate('sso.admin.error.notFound', 'SSO configuration not found'), 404, { key: 'sso.admin.error.notFound' })
    }

    return config
  }

  private async authorizeConfiguration(em: EntityManager, config: SsoConfig, scope: SsoAdminScope): Promise<void> {
    if (!this.ssoAuthorizationService) {
      const { translate } = await resolveTranslations()
      throw forbidden(translate('sso.errors.authorizationDenied', 'SSO authorization is unavailable.'))
    }
    await this.ssoAuthorizationService.assertConfiguration(em, config, scope.actorUserId ?? null)
  }

  private async testConnectionInternal(config: SsoConfig): Promise<{ ok: boolean; error?: string }> {
    const provider = this.ssoProviderRegistry.resolve(config.protocol)
    if (!provider) {
      const { translate } = await resolveTranslations()
      return {
        ok: false,
        error: translate('sso.errors.providerUnavailable', `No provider for protocol: ${config.protocol}`, { protocol: config.protocol }),
      }
    }

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
        { key: 'sso.errors.domainClaimed', params: { domain: conflictDomain } },
      )
    }
  }
}

const SSO_CONFIG_ERROR_MARKER = Symbol.for('@open-mercato/sso/SsoConfigError')

export class SsoConfigError extends Error {
  readonly [SSO_CONFIG_ERROR_MARKER] = true

  readonly translationKey?: string
  readonly translationParams?: SsoErrorTranslationParams

  constructor(
    message: string,
    public readonly statusCode: number,
    translation?: SsoErrorTranslation,
  ) {
    super(message)
    this.name = 'SsoConfigError'
    this.translationKey = translation?.key
    this.translationParams = translation?.params
  }
}

function invalidDomainError(domain: string, result: DomainValidationResult): SsoConfigError {
  return new SsoConfigError(`Invalid domain "${domain}": ${result.error}`, 400, {
    key: result.errorKey ?? 'sso.errors.domain.invalidFormat',
    params: { domain },
  })
}

export function isSsoConfigError(error: unknown): error is SsoConfigError {
  return error instanceof SsoConfigError || isBrandedSsoHttpError(error, SSO_CONFIG_ERROR_MARKER, 'SsoConfigError')
}
