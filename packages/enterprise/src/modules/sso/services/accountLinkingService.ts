import { EntityManager, type FilterQuery, type RequiredEntityData } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { User, UserRole, Role } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { SsoConfig, SsoIdentity, SsoRoleGrant, ScimToken } from '../data/entities'
import { emitSsoEvent } from '../events'
import { EmailNotVerifiedError, SsoRolesRevokedError, isSsoRolesRevokedError } from '../lib/errors'
import type { SsoIdentityPayload } from '../lib/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { conflict } from '@open-mercato/shared/lib/crud/errors'
import { lockUserRoleWriterAuthorizationState } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'
import { isSsoUserDeactivated } from '../lib/deactivation'
import type { SsoAuthorizationService } from './ssoAuthorizationService'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('sso').child({ component: 'account-linking' })

type AuthorizedSsoAccount = {
  user: User
  identity: SsoIdentity
  authorizedRoleIds: ReadonlySet<string>
}

type PendingIdentityEvent = {
  eventId: 'sso.identity.linked' | 'sso.identity.created'
  id: string
  tenantId: string
  organizationId: string
}

export class AccountLinkingService {
  constructor(
    private em: EntityManager,
    private ssoAuthorizationService?: SsoAuthorizationService,
  ) {}

  async resolveUser(
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
    configVersion: number = config.updatedAt instanceof Date ? config.updatedAt.getTime() : Number.NaN,
  ): Promise<{ user: User; identity: SsoIdentity }> {
    const authorization = this.requireAuthorizationService()
    const pendingEvents: PendingIdentityEvent[] = []
    const result = await this.em.transactional(async (em) => {
      const currentConfig = await findOneWithDecryption(
        em,
        SsoConfig,
        { id: config.id, organizationId: config.organizationId, isActive: true, deletedAt: null },
        { refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE },
        { tenantId: config.tenantId ?? null, organizationId: config.organizationId },
      )
      if (!currentConfig || !Number.isFinite(configVersion) || currentConfig.updatedAt.getTime() !== configVersion) {
        throw new Error('[internal] SSO configuration changed during authentication')
      }
      const resolvedTenantId = await authorization.resolveTenant(em, currentConfig)
      if (tenantId && tenantId !== resolvedTenantId) {
        throw new Error('[internal] SSO tenant scope does not match its organization')
      }
      const existing = await this.findExistingLink(em, currentConfig, idpPayload.subject, resolvedTenantId)
      if (existing) {
        return this.synchronizeExistingUser(em, existing, currentConfig, resolvedTenantId, idpPayload.groups)
      }

      if (idpPayload.emailVerified !== true) {
        throw new EmailNotVerifiedError('IdP did not verify the email claim — cannot link or provision account')
      }

      const emailDomain = idpPayload.email.split('@')[1]?.toLowerCase()
      if (!emailDomain || !currentConfig.allowedDomains.some((domain) => domain.toLowerCase() === emailDomain)) {
        throw new Error('Email domain is not in the allowed domains for this SSO configuration')
      }

      const emailLinked = currentConfig.autoLinkByEmail
        ? await this.linkByEmail(em, currentConfig, idpPayload, resolvedTenantId, pendingEvents)
        : null
      if (emailLinked) {
        return this.synchronizeExistingUser(em, emailLinked, currentConfig, resolvedTenantId, idpPayload.groups)
      }

      await authorization.assertConfiguration(em, currentConfig)
      if (currentConfig.jitEnabled) {
        const scimActive = await em.count(ScimToken, { ssoConfigId: currentConfig.id, isActive: true }) > 0
        if (scimActive) {
          throw new Error('JIT provisioning is disabled because SCIM directory sync is active')
        }
        return this.jitProvision(em, currentConfig, idpPayload, resolvedTenantId, pendingEvents)
      }

      throw new Error('No matching user found and JIT provisioning is disabled')
    })
    for (const { eventId, ...payload } of pendingEvents) {
      void emitSsoEvent(eventId, payload).catch((eventError) => {
        logger.error('SSO event emit failed', { err: eventError })
        try {
          getTelemetryRuntime()?.reportError(eventError, { module: 'sso', code: 'sso.event_emit_failed' })
        } catch (telemetryError) {
          logger.warn('SSO telemetry reporting failed', { err: telemetryError })
        }
      })
    }
    if (isSsoRolesRevokedError(result)) throw result
    return result
  }

  private async synchronizeExistingUser(
    em: EntityManager,
    existing: AuthorizedSsoAccount,
    config: SsoConfig,
    tenantId: string,
    idpGroups?: string[],
  ): Promise<{ user: User; identity: SsoIdentity } | SsoRolesRevokedError> {
    try {
      await this.assignRolesFromSso(em, existing.user, config, tenantId, idpGroups, existing.authorizedRoleIds)
      return { user: existing.user, identity: existing.identity }
    } catch (error) {
      if (isSsoRolesRevokedError(error)) return error
      throw error
    }
  }

  private requireAuthorizationService(): SsoAuthorizationService {
    if (!this.ssoAuthorizationService) {
      throw new Error('[internal] SSO authorization service is unavailable')
    }
    return this.ssoAuthorizationService
  }

  private async findExistingLink(
    em: EntityManager,
    config: SsoConfig,
    idpSubject: string,
    tenantId: string,
  ): Promise<AuthorizedSsoAccount | null> {
    const identity = await findOneWithDecryption(
      em,
      SsoIdentity,
      { ssoConfigId: config.id, idpSubject, deletedAt: null },
      {},
      { tenantId, organizationId: config.organizationId },
    )
    if (!identity) return null

    const user = await findOneWithDecryption(
      em,
      User,
      { id: identity.userId, tenantId, organizationId: config.organizationId, deletedAt: null },
      {},
      { tenantId, organizationId: config.organizationId },
    )
    if (!user) {
      await this.requireAuthorizationService().assertConfiguration(em, config)
      identity.deletedAt = new Date()
      await em.flush()
      return null
    }

    const authorization = await this.requireAuthorizationService().authorizeAccount(em, config, user)
    await this.requireActiveUser(user.id, config.id, tenantId, config.organizationId, em)

    identity.lastLoginAt = new Date()
    await em.flush()

    return { user, identity, authorizedRoleIds: new Set(authorization.mappedRoleIds) }
  }

  private async linkByEmail(
    em: EntityManager,
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
    pendingEvents: PendingIdentityEvent[],
  ): Promise<AuthorizedSsoAccount | null> {
    const emailHash = computeEmailHash(idpPayload.email)
    const user = await findOneWithDecryption(
      em,
      User,
      {
        tenantId,
        organizationId: config.organizationId,
        deletedAt: null,
        $or: [
          { email: idpPayload.email },
          { emailHash },
        ],
      } as FilterQuery<User>,
      {},
      { tenantId, organizationId: config.organizationId },
    )
    if (!user) return null

    const authorization = await this.requireAuthorizationService().authorizeAccount(em, config, user)
    await this.requireActiveUser(user.id, config.id, tenantId, config.organizationId, em)

    const now = new Date()
    const identity = em.create(SsoIdentity, {
      tenantId,
      organizationId: config.organizationId,
      ssoConfigId: config.id,
      userId: user.id,
      idpSubject: idpPayload.subject,
      idpEmail: idpPayload.email,
      idpName: idpPayload.name ?? null,
      idpGroups: idpPayload.groups ?? [],
      provisioningMethod: 'manual',
      firstLoginAt: now,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    } as RequiredEntityData<SsoIdentity>)
    await em.persist(identity).flush()

    pendingEvents.push({
      eventId: 'sso.identity.linked',
      id: identity.id,
      tenantId,
      organizationId: config.organizationId,
    })

    return { user, identity, authorizedRoleIds: new Set(authorization.mappedRoleIds) }
  }

  private async requireActiveUser(
    userId: string,
    ssoConfigId: string,
    tenantId: string,
    organizationId: string,
    em: EntityManager = this.em,
  ): Promise<void> {
    if (await isSsoUserDeactivated(em, { userId, ssoConfigId, tenantId: tenantId || null, organizationId })) {
      throw new Error('[internal] SSO identity is deactivated')
    }
  }

  private async jitProvision(
    em: EntityManager,
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
    pendingEvents: PendingIdentityEvent[],
  ): Promise<{ user: User; identity: SsoIdentity }> {
    const user = em.create(User, {
      tenantId,
      organizationId: config.organizationId,
      email: idpPayload.email,
      emailHash: computeEmailHash(idpPayload.email),
      name: idpPayload.name ?? null,
      passwordHash: null,
      isConfirmed: true,
      createdAt: new Date(),
    })
    await em.persist(user).flush()

    const authorization = await this.requireAuthorizationService().authorizeAccount(em, config, user)
    await this.assignRolesFromSso(em, user, config, tenantId, idpPayload.groups, new Set(authorization.mappedRoleIds))

    const now = new Date()
    const identity = em.create(SsoIdentity, {
      tenantId,
      organizationId: config.organizationId,
      ssoConfigId: config.id,
      userId: user.id,
      idpSubject: idpPayload.subject,
      idpEmail: idpPayload.email,
      idpName: idpPayload.name ?? null,
      idpGroups: idpPayload.groups ?? [],
      provisioningMethod: 'jit',
      firstLoginAt: now,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    } as RequiredEntityData<SsoIdentity>)
    await em.persist(identity).flush()

    pendingEvents.push({
      eventId: 'sso.identity.created',
      id: identity.id,
      tenantId,
      organizationId: config.organizationId,
    })

    return { user, identity }
  }

  private async assignRolesFromSso(
    em: EntityManager,
    user: User,
    config: SsoConfig,
    tenantId: string,
    idpGroups: string[] | undefined,
    authorizedRoleIds: ReadonlySet<string>,
  ): Promise<void> {
    const hasMappings = config.appRoleMappings && Object.keys(config.appRoleMappings).length > 0
    if (!hasMappings) return

    const synchronize = async (transactionalEm: EntityManager): Promise<boolean> => {
      const managedUser = typeof transactionalEm.getReference === 'function'
        ? transactionalEm.getReference(User, String(user.id))
        : user
      await this.syncMappedRoles(transactionalEm, managedUser, config, tenantId, idpGroups, authorizedRoleIds)
      const remainingGrant = await transactionalEm.findOne(SsoRoleGrant, {
        userId: user.id,
        ssoConfigId: config.id,
      })
      return remainingGrant !== null
    }
    const hasAnySsoRole = typeof em.isInTransaction === 'function' && em.isInTransaction()
      ? await synchronize(em)
      : await em.transactional(synchronize)
    if (!hasAnySsoRole) {
      throw new SsoRolesRevokedError(
        String(user.id),
        'No roles could be resolved from IdP groups — login denied. Configure role mappings or ensure the IdP sends matching group claims.',
      )
    }
  }

  /**
   * Sync/replace SSO-sourced roles: on each login, SSO-managed roles are replaced
   * with what the IdP sends, while manually-assigned roles are preserved.
   */
  private async syncMappedRoles(
    em: EntityManager,
    user: User,
    config: SsoConfig,
    tenantId: string,
    idpGroups: string[] | undefined,
    authorizedRoleIds: ReadonlySet<string>,
  ): Promise<void> {
    const resolvedTenantId = tenantId || user.tenantId || ''
    if (!resolvedTenantId) return

    const desiredRoleNames = resolveRoleNamesFromIdpGroups(idpGroups, config.appRoleMappings)
    let allRoles = await em.find(Role, {
      tenantId: resolvedTenantId,
      deletedAt: null,
    } as FilterQuery<Role>)
    let desiredRoleIds = resolveActiveRoleIds(allRoles, desiredRoleNames)
    assertRoleMutationFootprintWasLocked(desiredRoleIds, authorizedRoleIds)

    // Query current SSO grants for this user+config
    let existingGrants = await em.find(SsoRoleGrant, {
      userId: user.id,
      ssoConfigId: config.id,
    })
    let allUserRoles = await em.find(UserRole, { user: user.id } as FilterQuery<UserRole>)
    const lockedRoleIds = new Set([
      ...desiredRoleIds,
      ...existingGrants.map((grant) => grant.roleId),
      ...allUserRoles
        .filter((userRole) => userRole.deletedAt)
        .map((userRole) => String(userRole.role?.id ?? userRole.role)),
    ])
    await lockUserRoleWriterAuthorizationState(em, {
      userIds: [String(user.id)],
      roleIds: Array.from(lockedRoleIds),
    })
    await this.requireActiveUser(user.id, config.id, resolvedTenantId, config.organizationId, em)
    allRoles = await em.find(Role, {
      tenantId: resolvedTenantId,
      deletedAt: null,
    } as FilterQuery<Role>, { refresh: true })
    existingGrants = await em.find(SsoRoleGrant, {
      userId: user.id,
      ssoConfigId: config.id,
    }, { refresh: true })
    allUserRoles = await em.find(
      UserRole,
      { user: user.id } as FilterQuery<UserRole>,
      { refresh: true },
    )

    desiredRoleIds = resolveActiveRoleIds(allRoles, desiredRoleNames)
    assertRoleMutationFootprintWasLocked(desiredRoleIds, authorizedRoleIds)
    const existingGrantedRoleIds = new Set(existingGrants.map((g) => g.roleId))

    // Compute diff
    const toAdd = [...desiredRoleIds].filter((id) => !existingGrantedRoleIds.has(id))
    const toRemove = existingGrants.filter((g) => !desiredRoleIds.has(g.roleId))
    const softDeletedUserRoles = allUserRoles.filter((userRole) => userRole.deletedAt)
    assertRoleMutationFootprintWasLocked([
      ...desiredRoleIds,
      ...toRemove.map((grant) => grant.roleId),
      ...softDeletedUserRoles.map((userRole) => String(userRole.role?.id ?? userRole.role)),
    ], lockedRoleIds)

    // Add new roles
    for (const roleId of toAdd) {
      const role = allRoles.find((r) => r.id === roleId)
      if (!role) continue
      await this.ensureUserRole(em, user, role)
      const grant = em.create(SsoRoleGrant, {
        tenantId: resolvedTenantId,
        organizationId: config.organizationId,
        userId: user.id,
        roleId,
        ssoConfigId: config.id,
      } as RequiredEntityData<SsoRoleGrant>)
      em.persist(grant)
    }

    // Remove stale SSO-sourced roles
    for (const grant of toRemove) {
      const userRole = await em.findOne(UserRole, {
        user: user.id,
        role: grant.roleId,
        deletedAt: null,
      } as FilterQuery<UserRole>)
      if (userRole) {
        em.remove(userRole)
      }
      em.remove(grant)
    }

    // Clean up orphaned soft-deleted UserRole rows (ghost rows from previous soft-delete logic)
    for (const userRole of softDeletedUserRoles) {
      em.remove(userRole)
    }

    if (toAdd.length > 0 || toRemove.length > 0 || softDeletedUserRoles.length > 0) {
      await em.flush()
    }
  }

  private async ensureUserRole(em: EntityManager, user: User, role: Role): Promise<void> {
    const existingLink = await em.findOne(UserRole, {
      user: user.id,
      role: role.id,
      deletedAt: null,
    } as FilterQuery<UserRole>)
    if (existingLink) return

    const userRole = em.create(UserRole, { user, role, createdAt: new Date() })
    em.persist(userRole)
  }
}

function assertRoleMutationFootprintWasLocked(
  roleIds: Iterable<string>,
  lockedRoleIds: ReadonlySet<string>,
): void {
  for (const roleId of roleIds) {
    if (!lockedRoleIds.has(roleId)) {
      throw conflict('[internal] Authorization state changed while acquiring its lock footprint')
    }
  }
}

function resolveActiveRoleIds(roles: Role[], desiredRoleNames: string[]): Set<string> {
  const roleByNormalizedName = new Map<string, Role>()
  const desiredNameSet = new Set(desiredRoleNames)
  for (const role of roles) {
    const normalized = normalizeToken(role.name)
    if (!normalized || !desiredNameSet.has(normalized)) continue
    if (roleByNormalizedName.has(normalized)) {
      throw conflict('[internal] SSO role mapping is ambiguous')
    }
    roleByNormalizedName.set(normalized, role)
  }

  const desiredRoleIds = new Set<string>()
  for (const roleName of desiredRoleNames) {
    const role = roleByNormalizedName.get(roleName)
    if (role) desiredRoleIds.add(role.id)
  }
  return desiredRoleIds
}

function resolveRoleNamesFromIdpGroups(
  idpGroups?: string[],
  configMappings?: Record<string, string>,
): string[] {
  if (!Array.isArray(idpGroups) || idpGroups.length === 0) return []

  const normalizedGroups = idpGroups
    .map((group) => normalizeToken(group))
    .filter((group): group is string => group !== null)
  if (normalizedGroups.length === 0) return []

  const mergedMappings = loadMergedMappings(configMappings)
  const roleNames = new Set<string>()

  for (const group of normalizedGroups) {
    const mapped = mergedMappings.get(group)
    if (!mapped?.length) continue

    for (const role of mapped) roleNames.add(role)
  }

  return Array.from(roleNames)
}

function loadMergedMappings(configMappings?: Record<string, string>): Map<string, string[]> {
  const mappings = new Map<string, string[]>()

  if (configMappings && Object.keys(configMappings).length > 0) {
    for (const [group, roleName] of Object.entries(configMappings)) {
      const normalizedGroup = normalizeToken(group)
      if (!normalizedGroup) continue
      const normalizedRole = normalizeToken(roleName)
      if (!normalizedRole) continue
      mappings.set(normalizedGroup, [normalizedRole])
    }
  }

  return mappings
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}
