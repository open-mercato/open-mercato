import { EntityManager } from '@mikro-orm/postgresql'
import { User, UserRole, Role } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { SsoConfig, SsoIdentity, SsoRoleGrant } from '../data/entities'
import { emitSsoEvent } from '../events'
import type { SsoIdentityPayload } from '../lib/types'

export class AccountLinkingService {
  constructor(private em: EntityManager) {}

  async resolveUser(
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
  ): Promise<{ user: User; identity: SsoIdentity }> {
    const existing = await this.findExistingLink(config.id, idpPayload.subject, tenantId, config.organizationId)
    if (existing) {
      await this.assignRolesFromSso(this.em, existing.user, config, tenantId, idpPayload.groups)
      return existing
    }

    if (idpPayload.emailVerified === false) {
      throw new Error('IdP explicitly reported email as unverified — cannot link or provision account')
    }

    const emailDomain = idpPayload.email.split('@')[1]?.toLowerCase()
    if (!emailDomain || !config.allowedDomains.some((d) => d.toLowerCase() === emailDomain)) {
      throw new Error('Email domain is not in the allowed domains for this SSO configuration')
    }

    const emailLinked = config.autoLinkByEmail
      ? await this.linkByEmail(config, idpPayload, tenantId)
      : null
    if (emailLinked) {
      await this.assignRolesFromSso(this.em, emailLinked.user, config, tenantId, idpPayload.groups)
      return emailLinked
    }

    if (config.jitEnabled) {
      return this.jitProvision(config, idpPayload, tenantId)
    }

    throw new Error('No matching user found and JIT provisioning is disabled')
  }

  private async findExistingLink(
    ssoConfigId: string,
    idpSubject: string,
    tenantId: string,
    organizationId: string,
  ): Promise<{ user: User; identity: SsoIdentity } | null> {
    const identity = await findOneWithDecryption(
      this.em,
      SsoIdentity,
      { ssoConfigId, idpSubject, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    if (!identity) return null

    const user = await findOneWithDecryption(
      this.em,
      User,
      { id: identity.userId, deletedAt: null },
      {},
      { tenantId, organizationId },
    )
    if (!user) {
      identity.deletedAt = new Date()
      await this.em.flush()
      return null
    }

    identity.lastLoginAt = new Date()
    await this.em.flush()

    return { user, identity }
  }

  private async linkByEmail(
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
  ): Promise<{ user: User; identity: SsoIdentity } | null> {
    const emailHash = computeEmailHash(idpPayload.email)
    const user = await findOneWithDecryption(
      this.em,
      User,
      {
        organizationId: config.organizationId,
        deletedAt: null,
        $or: [
          { email: idpPayload.email },
          { emailHash },
        ],
      } as any,
      {},
      { tenantId, organizationId: config.organizationId },
    )
    if (!user) return null

    const now = new Date()
    const identity = this.em.create(SsoIdentity, {
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
    } as any)
    await this.em.persistAndFlush(identity)

    void emitSsoEvent('sso.identity.linked', {
      id: identity.id,
      tenantId,
      organizationId: config.organizationId,
    }).catch(() => undefined)

    return { user, identity: identity as SsoIdentity }
  }

  private async jitProvision(
    config: SsoConfig,
    idpPayload: SsoIdentityPayload,
    tenantId: string,
  ): Promise<{ user: User; identity: SsoIdentity }> {
    return this.em.transactional(async (txEm) => {
      const user = txEm.create(User, {
        tenantId,
        organizationId: config.organizationId,
        email: idpPayload.email,
        emailHash: computeEmailHash(idpPayload.email),
        name: idpPayload.name ?? null,
        passwordHash: null,
        isConfirmed: true,
      } as any)
      await txEm.persistAndFlush(user)

      await this.assignRolesFromSso(txEm, user as User, config, tenantId, idpPayload.groups)

      const now = new Date()
      const identity = txEm.create(SsoIdentity, {
        tenantId,
        organizationId: config.organizationId,
        ssoConfigId: config.id,
        userId: (user as User).id,
        idpSubject: idpPayload.subject,
        idpEmail: idpPayload.email,
        idpName: idpPayload.name ?? null,
        idpGroups: idpPayload.groups ?? [],
        provisioningMethod: 'jit',
        firstLoginAt: now,
        lastLoginAt: now,
      } as any)
      await txEm.persistAndFlush(identity)

      void emitSsoEvent('sso.identity.created', {
        id: identity.id,
        tenantId,
        organizationId: config.organizationId,
      }).catch(() => undefined)

      return { user: user as User, identity: identity as SsoIdentity }
    })
  }

  private async assignRolesFromSso(
    em: EntityManager,
    user: User,
    config: SsoConfig,
    tenantId: string,
    idpGroups?: string[],
  ): Promise<void> {
    await this.syncMappedRoles(em, user, config, tenantId, idpGroups)

    const hasAnySsoRole = await em.findOne(SsoRoleGrant, {
      userId: user.id,
      ssoConfigId: config.id,
    })
    if (!hasAnySsoRole) {
      throw new Error('No roles could be resolved from IdP groups — login denied. Configure role mappings or ensure the IdP sends matching group claims.')
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
    idpGroups?: string[],
  ): Promise<void> {
    const resolvedTenantId = tenantId || user.tenantId || ''
    if (!resolvedTenantId) return

    const allRoles = await em.find(Role, { tenantId: resolvedTenantId, deletedAt: null } as any)
    const roleByNormalizedName = new Map<string, Role>()
    for (const role of allRoles) {
      const normalized = normalizeToken(role.name)
      if (normalized) roleByNormalizedName.set(normalized, role)
    }

    // Resolve desired role IDs from IdP groups using merged mappings
    const desiredRoleNames = resolveRoleNamesFromIdpGroups(idpGroups, config.appRoleMappings)
    const desiredRoleIds = new Set<string>()
    for (const roleName of desiredRoleNames) {
      const role = roleByNormalizedName.get(roleName)
      if (role) desiredRoleIds.add(role.id)
    }

    // Query current SSO grants for this user+config
    const existingGrants = await em.find(SsoRoleGrant, {
      userId: user.id,
      ssoConfigId: config.id,
    })
    const existingGrantedRoleIds = new Set(existingGrants.map((g) => g.roleId))

    // Compute diff
    const toAdd = [...desiredRoleIds].filter((id) => !existingGrantedRoleIds.has(id))
    const toRemove = existingGrants.filter((g) => !desiredRoleIds.has(g.roleId))

    // Add new roles
    for (const roleId of toAdd) {
      const role = allRoles.find((r) => r.id === roleId)
      if (!role) continue
      await this.ensureUserRole(em, user, role)
      const grant = em.create(SsoRoleGrant, {
        tenantId: resolvedTenantId,
        userId: user.id,
        roleId,
        ssoConfigId: config.id,
      } as any)
      em.persist(grant)
    }

    // Remove stale SSO-sourced roles
    for (const grant of toRemove) {
      const userRole = await em.findOne(UserRole, {
        user: user.id,
        role: grant.roleId,
        deletedAt: null,
      } as any)
      if (userRole) {
        userRole.deletedAt = new Date()
      }
      em.remove(grant)
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      await em.flush()
    }
  }

  private async ensureUserRole(em: EntityManager, user: User, role: Role): Promise<void> {
    const existingLink = await em.findOne(UserRole, {
      user: user.id,
      role: role.id,
      deletedAt: null,
    } as any)
    if (existingLink) return

    const userRole = em.create(UserRole, { user, role } as any)
    await em.persistAndFlush(userRole)
  }
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
    if (mapped?.length) {
      for (const role of mapped) roleNames.add(role)
      continue
    }

    roleNames.add(group)
    const segmented = group.split(/[\\/:]/).map((part) => normalizeToken(part)).filter((part): part is string => part !== null)
    for (const candidate of segmented) {
      roleNames.add(candidate)
    }
  }

  return Array.from(roleNames)
}

function loadMergedMappings(configMappings?: Record<string, string>): Map<string, string[]> {
  const envMappings = loadGroupRoleMappingsFromEnv()

  // Per-config mappings take precedence over env var
  if (configMappings && Object.keys(configMappings).length > 0) {
    for (const [group, roleName] of Object.entries(configMappings)) {
      const normalizedGroup = normalizeToken(group)
      if (!normalizedGroup) continue
      const normalizedRole = normalizeToken(roleName)
      if (!normalizedRole) continue
      envMappings.set(normalizedGroup, [normalizedRole])
    }
  }

  return envMappings
}

function loadGroupRoleMappingsFromEnv(): Map<string, string[]> {
  const raw = process.env.SSO_GROUP_ROLE_MAP
  if (!raw) return new Map()

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out = new Map<string, string[]>()
    for (const [group, roleValue] of Object.entries(parsed)) {
      const normalizedGroup = normalizeToken(group)
      if (!normalizedGroup) continue
      const roles = normalizeRoleList(roleValue)
      if (roles.length > 0) out.set(normalizedGroup, roles)
    }
    return out
  } catch {
    return new Map()
  }
}

function normalizeRoleList(value: unknown): string[] {
  if (typeof value === 'string') {
    const token = normalizeToken(value)
    return token ? [token] : []
  }

  if (Array.isArray(value)) {
    const out = new Set<string>()
    for (const entry of value) {
      const token = normalizeToken(entry)
      if (token) out.add(token)
    }
    return Array.from(out)
  }

  return []
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}
