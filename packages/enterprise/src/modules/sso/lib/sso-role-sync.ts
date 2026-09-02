import { EntityManager, type FilterQuery, type RequiredEntityData } from '@mikro-orm/postgresql'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { SsoConfig, SsoRoleGrant } from '../data/entities'

export async function syncSsoRoleGrants(
  em: EntityManager,
  user: User,
  config: SsoConfig,
  tenantId: string,
  idpGroups?: string[],
): Promise<void> {
  const resolvedTenantId = tenantId || user.tenantId || ''
  if (!resolvedTenantId) return

  const allRoles = await em.find(Role, { tenantId: resolvedTenantId, deletedAt: null } as FilterQuery<Role>)
  const roleByNormalizedName = new Map<string, Role>()
  for (const role of allRoles) {
    const normalized = normalizeToken(role.name)
    if (normalized) roleByNormalizedName.set(normalized, role)
  }

  const desiredRoleNames = resolveRoleNamesFromIdpGroups(idpGroups, config.appRoleMappings)
  const desiredRoleIds = new Set<string>()
  for (const roleName of desiredRoleNames) {
    const role = roleByNormalizedName.get(roleName)
    if (role) desiredRoleIds.add(role.id)
  }

  const existingGrants = await em.find(SsoRoleGrant, {
    userId: user.id,
    ssoConfigId: config.id,
    organizationId: config.organizationId,
  })
  const existingGrantedRoleIds = new Set(existingGrants.map((grant) => grant.roleId))
  const toAdd = [...desiredRoleIds].filter((roleId) => !existingGrantedRoleIds.has(roleId))
  const toRemove = existingGrants.filter((grant) => !desiredRoleIds.has(grant.roleId))

  for (const roleId of toAdd) {
    const role = allRoles.find((candidate) => candidate.id === roleId)
    if (!role) continue
    await ensureUserRole(em, user, role)
    em.persist(em.create(SsoRoleGrant, {
      tenantId: resolvedTenantId,
      organizationId: config.organizationId,
      userId: user.id,
      roleId,
      ssoConfigId: config.id,
    } as RequiredEntityData<SsoRoleGrant>))
  }

  for (const grant of toRemove) {
    const userRole = await em.findOne(UserRole, {
      user: user.id,
      role: grant.roleId,
      deletedAt: null,
    } as FilterQuery<UserRole>)
    if (userRole) em.remove(userRole)
    em.remove(grant)
  }

  const userRoles = await em.find(UserRole, { user: user.id } as FilterQuery<UserRole>)
  for (const userRole of userRoles) {
    if (userRole.deletedAt) em.remove(userRole)
  }

  if (toAdd.length > 0 || toRemove.length > 0 || userRoles.some((userRole) => userRole.deletedAt)) {
    await em.flush()
  }
}

export function resolveRoleNamesFromIdpGroups(
  idpGroups?: string[],
  configMappings?: Record<string, string>,
): string[] {
  if (!Array.isArray(idpGroups) || idpGroups.length === 0) return []

  const normalizedGroups = idpGroups
    .map((group) => normalizeToken(group))
    .filter((group): group is string => group !== null)
  if (normalizedGroups.length === 0) return []

  const mappings = new Map<string, string>()
  for (const [group, roleName] of Object.entries(configMappings ?? {})) {
    const normalizedGroup = normalizeToken(group)
    const normalizedRole = normalizeToken(roleName)
    if (normalizedGroup && normalizedRole) mappings.set(normalizedGroup, normalizedRole)
  }

  const roleNames = new Set<string>()
  for (const group of normalizedGroups) {
    const mappedRole = mappings.get(group)
    if (mappedRole) roleNames.add(mappedRole)
  }
  return Array.from(roleNames)
}

async function ensureUserRole(em: EntityManager, user: User, role: Role): Promise<void> {
  const existing = await em.findOne(UserRole, {
    user: user.id,
    role: role.id,
    deletedAt: null,
  } as FilterQuery<UserRole>)
  if (existing) return

  await em.persist(em.create(UserRole, { user, role, createdAt: new Date() })).flush()
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}
