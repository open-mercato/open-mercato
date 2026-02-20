import { EntityManager } from '@mikro-orm/postgresql'
import { User, UserRole, Role } from '@open-mercato/core/modules/auth/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { computeEmailHash } from '@open-mercato/core/modules/auth/lib/emailHash'
import { SsoConfig, SsoIdentity } from '../data/entities'
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
      await this.assignRolesFromSso(this.em, existing.user, config.defaultRoleId ?? null, tenantId, idpPayload.groups)
      return existing
    }

    if (!idpPayload.emailVerified) {
      throw new Error('IdP email is not verified — cannot link or provision account')
    }

    const emailDomain = idpPayload.email.split('@')[1]?.toLowerCase()
    if (!emailDomain || !config.allowedDomains.some((d) => d.toLowerCase() === emailDomain)) {
      throw new Error('Email domain is not in the allowed domains for this SSO configuration')
    }

    const emailLinked = config.autoLinkByEmail
      ? await this.linkByEmail(config, idpPayload, tenantId)
      : null
    if (emailLinked) {
      await this.assignRolesFromSso(this.em, emailLinked.user, config.defaultRoleId ?? null, tenantId, idpPayload.groups)
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
    if (!user) return null

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

      await this.assignRolesFromSso(txEm, user as User, config.defaultRoleId ?? null, tenantId, idpPayload.groups)

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

  private async assignDefaultRole(em: EntityManager, user: User, defaultRoleId: string | null): Promise<void> {
    if (!defaultRoleId) return
    const role = await em.findOne(Role, { id: defaultRoleId, deletedAt: null })
    if (!role) return
    await this.ensureUserRole(em, user, role)
  }

  private async assignRolesFromSso(
    em: EntityManager,
    user: User,
    defaultRoleId: string | null,
    tenantId: string,
    idpGroups?: string[],
  ): Promise<void> {
    await this.assignForcedRoleFromEnv(em, user, tenantId)
    await this.assignDefaultRole(em, user, defaultRoleId)
    await this.assignMappedRoles(em, user, tenantId, idpGroups)
  }

  private async assignForcedRoleFromEnv(em: EntityManager, user: User, tenantId: string): Promise<void> {
    const forcedRoleName = normalizeToken(process.env.SSO_FORCE_ROLE_ON_LOGIN)
    if (!forcedRoleName) return

    const resolvedTenantId = tenantId || user.tenantId || ''
    if (!resolvedTenantId) return

    const roles = await em.find(Role, { tenantId: resolvedTenantId, deletedAt: null } as any)
    const matchedRole = roles.find((role) => normalizeToken(role.name) === forcedRoleName)
    if (!matchedRole) return

    await this.ensureUserRole(em, user, matchedRole)
  }

  private async assignMappedRoles(
    em: EntityManager,
    user: User,
    tenantId: string,
    idpGroups?: string[],
  ): Promise<void> {
    const resolvedTenantId = tenantId || user.tenantId || ''
    if (!resolvedTenantId) return

    const roleNames = resolveRoleNamesFromIdpGroups(idpGroups)
    if (roleNames.length === 0) return

    const roles = await em.find(Role, { tenantId: resolvedTenantId, deletedAt: null } as any)
    const roleNameSet = new Set(roleNames)

    for (const role of roles) {
      if (!roleNameSet.has(normalizeToken(role.name) ?? '')) continue
      await this.ensureUserRole(em, user, role)
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

function resolveRoleNamesFromIdpGroups(idpGroups?: string[]): string[] {
  if (!Array.isArray(idpGroups) || idpGroups.length === 0) return []

  const normalizedGroups = idpGroups
    .map((group) => normalizeToken(group))
    .filter((group): group is string => group !== null)
  if (normalizedGroups.length === 0) return []

  const explicitMappings = loadGroupRoleMappings()
  const roleNames = new Set<string>()

  for (const group of normalizedGroups) {
    const mapped = explicitMappings.get(group)
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

function loadGroupRoleMappings(): Map<string, string[]> {
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
