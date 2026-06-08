import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { hasFeature } from '@open-mercato/shared/security/features'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type ActorAcl = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

type GrantCheckContext = {
  em: EntityManager
  rbacService: RbacService
  actorUserId: string | null | undefined
  tenantId: string | null | undefined
  organizationId?: string | null | undefined
}

type RoleGrantCheckInput = GrantCheckContext & {
  roles: Role[]
}

type RoleTokenGrantCheckInput = GrantCheckContext & {
  roleTokens: unknown
}

type FeatureGrantCheckInput = GrantCheckContext & {
  features: unknown
  isSuperAdmin?: boolean
  organizations?: string[] | null
}

type SuperAdminUserTargetInput = GrantCheckContext & {
  targetUserId: string
  actorIsSuperAdmin?: boolean
}

type SuperAdminRoleTargetInput = GrantCheckContext & {
  targetRoleId: string
  actorIsSuperAdmin?: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function assertActorCanGrantRoleTokens(input: RoleTokenGrantCheckInput): Promise<Role[]> {
  const tokens = normalizeStringList(input.roleTokens)
  if (!tokens.length) return []

  const tenantId = normalizeNullableString(input.tenantId)
  const roles = await resolveRolesForGrant(input.em, tokens, tenantId)
  await assertActorCanGrantRoles({ ...input, tenantId, roles })
  return roles
}

export async function assertActorCanGrantRoles(input: RoleGrantCheckInput): Promise<void> {
  if (!input.roles.length) return

  const tenantId = normalizeNullableString(input.tenantId)
  const actorAcl = await loadActorAcl({ ...input, tenantId })
  if (actorAcl.isSuperAdmin) return

  if (!tenantId) {
    throw forbidden('Tenant context is required to grant roles.')
  }

  for (const role of input.roles) {
    const roleTenantId = normalizeNullableString(role.tenantId)
    if (roleTenantId !== tenantId) {
      throw forbidden('Cannot grant a role outside the target tenant.')
    }

    const acl = await findOneWithDecryption(
      input.em,
      RoleAcl,
      { role, tenantId } as FilterQuery<RoleAcl>,
      {},
      { tenantId, organizationId: null },
    )
    if (!acl) continue

    assertActorCanGrantAclSnapshot(actorAcl, {
      isSuperAdmin: !!acl.isSuperAdmin,
      features: normalizeStringList(acl.featuresJson),
      organizations: normalizeOrganizationList(acl.organizationsJson),
    })
  }
}

export async function assertActorCanGrantAcl(input: FeatureGrantCheckInput): Promise<void> {
  const actorAcl = await loadActorAcl(input)
  if (actorAcl.isSuperAdmin) return

  const tenantId = normalizeNullableString(input.tenantId)
  if (!tenantId) {
    throw forbidden('Tenant context is required to grant ACL features.')
  }

  assertActorCanGrantAclSnapshot(actorAcl, {
    isSuperAdmin: !!input.isSuperAdmin,
    features: normalizeStringList(input.features),
    organizations: input.organizations === undefined ? undefined : normalizeOrganizationList(input.organizations),
  })
}

export function normalizeGrantFeatureList(features: unknown): string[] {
  return normalizeStringList(features)
}

export async function assertActorCanModifySuperAdminUserTarget(input: SuperAdminUserTargetInput): Promise<void> {
  const actorIsSuperAdmin = await resolveActorIsSuperAdmin(input)
  if (actorIsSuperAdmin) return
  const targetIsSuperAdmin = await isUserEffectivelySuperAdmin(input.em, input.targetUserId)
  if (targetIsSuperAdmin) {
    throw forbidden('Only super administrators can modify super administrator accounts.')
  }
}

export async function assertActorCanModifySuperAdminRoleTarget(input: SuperAdminRoleTargetInput): Promise<void> {
  const actorIsSuperAdmin = await resolveActorIsSuperAdmin(input)
  if (actorIsSuperAdmin) return
  const targetIsSuperAdmin = await isRoleEffectivelySuperAdmin(input.em, input.targetRoleId)
  if (targetIsSuperAdmin) {
    throw forbidden('Only super administrators can modify super administrator roles.')
  }
}

export async function assertActorCanAccessUserTarget(input: SuperAdminUserTargetInput): Promise<void> {
  const isSuperAdmin = await resolveActorIsSuperAdmin(input)
  if (isSuperAdmin) return

  const target = await findOneWithDecryption(
    input.em,
    User,
    { id: input.targetUserId } as FilterQuery<User>,
    {},
    { tenantId: null, organizationId: null },
  )
  // Not found (incl. soft-deleted, which MikroORM's soft-delete filter hides):
  // delegate to the caller. Every wired call site is itself tenant-scoped — the
  // ACL/consents reads filter by auth.tenantId and the user commands re-load by
  // id within tenant — so a missing target yields a safe empty/404 there. The
  // guard's job is to block a foreign *existing* target, below.
  if (!target) return

  const actorTenantId = normalizeNullableString(input.tenantId)
  const targetTenantId = normalizeNullableString((target as { tenantId?: string | null }).tenantId)
  if (!targetTenantId || targetTenantId !== actorTenantId) {
    throw new CrudHttpError(404, { error: 'User not found' })
  }

  const actorAcl = await loadActorAcl(input)
  if (actorAcl.organizations !== null && !actorAcl.organizations.includes('__all__')) {
    const targetOrganizationId = normalizeNullableString((target as { organizationId?: string | null }).organizationId)
    if (!targetOrganizationId || !actorAcl.organizations.includes(targetOrganizationId)) {
      throw forbidden('Not authorized to access this user.')
    }
  }
}

export async function assertActorCanAccessRoleTarget(input: SuperAdminRoleTargetInput): Promise<void> {
  const isSuperAdmin = await resolveActorIsSuperAdmin(input)
  if (isSuperAdmin) return

  const target = await findOneWithDecryption(
    input.em,
    Role,
    { id: input.targetRoleId } as FilterQuery<Role>,
    {},
    { tenantId: null, organizationId: null },
  )
  // Not found (incl. soft-deleted): delegate (see assertActorCanAccessUserTarget).
  if (!target) return

  const actorTenantId = normalizeNullableString(input.tenantId)
  const targetTenantId = normalizeNullableString((target as { tenantId?: string | null }).tenantId)
  if (!targetTenantId || targetTenantId !== actorTenantId) {
    throw new CrudHttpError(404, { error: 'Role not found' })
  }
}

async function resolveActorIsSuperAdmin(input: GrantCheckContext & { actorIsSuperAdmin?: boolean }): Promise<boolean> {
  if (typeof input.actorIsSuperAdmin === 'boolean') return input.actorIsSuperAdmin
  const acl = await loadActorAcl(input)
  return acl.isSuperAdmin
}

export async function isUserEffectivelySuperAdmin(em: EntityManager, userId: string): Promise<boolean> {
  const directGrant = await em.findOne(
    UserAcl,
    { user: userId as unknown, isSuperAdmin: true } as FilterQuery<UserAcl>,
  )
  if (directGrant && (directGrant as { isSuperAdmin?: boolean }).isSuperAdmin === true) return true
  const links = await findWithDecryption(
    em,
    UserRole,
    { user: userId as unknown } as FilterQuery<UserRole>,
    { populate: ['role'] },
    { tenantId: null, organizationId: null },
  )
  const roleIds = (Array.isArray(links) ? links : [])
    .map((link) => {
      const role = (link as { role?: { id?: unknown } | string | null }).role
      if (!role) return null
      if (typeof role === 'string') return role
      return role.id ? String(role.id) : null
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (!roleIds.length) return false
  const roleGrant = await em.findOne(
    RoleAcl,
    { role: { $in: roleIds } as unknown, isSuperAdmin: true } as FilterQuery<RoleAcl>,
  )
  return !!roleGrant && (roleGrant as { isSuperAdmin?: boolean }).isSuperAdmin === true
}

export async function isRoleEffectivelySuperAdmin(em: EntityManager, roleId: string): Promise<boolean> {
  const grant = await em.findOne(
    RoleAcl,
    { role: roleId as unknown, isSuperAdmin: true } as FilterQuery<RoleAcl>,
  )
  return !!grant && (grant as { isSuperAdmin?: boolean }).isSuperAdmin === true
}

export async function listSuperAdminUserIds(em: EntityManager, tenantId: string | null): Promise<Set<string>> {
  const ids = new Set<string>()
  const userAclFilter: Record<string, unknown> = { isSuperAdmin: true }
  if (tenantId) userAclFilter.tenantId = tenantId
  const userAcls = await em.find(UserAcl, userAclFilter as FilterQuery<UserAcl>)
  for (const acl of userAcls) {
    const userRef = (acl as { user?: { id?: unknown } | string | null }).user
    const userId = userRef && typeof userRef === 'object'
      ? userRef.id
      : userRef
    if (userId) ids.add(String(userId))
  }
  const roleAcls = await em.find(
    RoleAcl,
    { isSuperAdmin: true } as FilterQuery<RoleAcl>,
  )
  const roleIds = roleAcls
    .map((acl) => {
      const roleRef = (acl as { role?: { id?: unknown } | string | null }).role
      if (!roleRef) return null
      if (typeof roleRef === 'string') return roleRef
      return roleRef.id ? String(roleRef.id) : null
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (roleIds.length) {
    const links = await findWithDecryption(
      em,
      UserRole,
      { role: { $in: roleIds } as unknown } as FilterQuery<UserRole>,
      {},
      { tenantId: null, organizationId: null },
    )
    for (const link of Array.isArray(links) ? links : []) {
      const userRef = (link as { user?: { id?: unknown } | string | null }).user
      const userId = userRef && typeof userRef === 'object'
        ? userRef.id
        : userRef
      if (userId) ids.add(String(userId))
    }
  }
  return ids
}

async function loadActorAcl(input: GrantCheckContext): Promise<ActorAcl> {
  const actorUserId = normalizeNullableString(input.actorUserId)
  if (!actorUserId) throw forbidden('Not authorized to grant ACL privileges.')

  const acl = await input.rbacService.loadAcl(actorUserId, {
    tenantId: normalizeNullableString(input.tenantId),
    organizationId: normalizeNullableString(input.organizationId),
  })

  return {
    isSuperAdmin: !!acl?.isSuperAdmin,
    features: normalizeStringList(acl?.features),
    organizations: normalizeOrganizationList(acl?.organizations),
  }
}

async function resolveRolesForGrant(
  em: EntityManager,
  roleTokens: string[],
  tenantId: string | null,
): Promise<Role[]> {
  const roles: Role[] = []
  const missingRoles: string[] = []

  for (const token of roleTokens) {
    const role = await resolveRoleForGrant(em, token, tenantId)
    if (!role) {
      missingRoles.push(token)
    } else {
      roles.push(role)
    }
  }

  if (missingRoles.length) {
    const labels = missingRoles.map((role) => `"${role}"`).join(', ')
    throw new CrudHttpError(400, { error: `Role(s) not found: ${labels}` })
  }

  return roles
}

async function resolveRoleForGrant(
  em: EntityManager,
  token: string,
  tenantId: string | null,
): Promise<Role | null> {
  const where: Record<string, unknown> = UUID_RE.test(token)
    ? { id: token, deletedAt: null }
    : { name: token, deletedAt: null }
  if (tenantId) where.tenantId = tenantId
  return findOneWithDecryption(
    em,
    Role,
    where as FilterQuery<Role>,
    {},
    { tenantId, organizationId: null },
  )
}

function assertActorCanGrantAclSnapshot(
  actorAcl: ActorAcl,
  requested: {
    isSuperAdmin: boolean
    features: string[]
    organizations?: string[] | null
  },
): void {
  if (requested.isSuperAdmin) {
    throw forbidden('Only super administrators can grant super admin access.')
  }

  const actorGrantableFeatures = actorAcl.features.filter((grant) => grant !== '*')
  for (const feature of requested.features) {
    if (feature === '*') {
      throw forbidden('Only super administrators can grant global wildcard access.')
    }
    if (isWildcardFeature(feature)) {
      if (!hasFeature(actorGrantableFeatures, feature)) {
        throw forbidden(`Cannot grant feature wildcard ${feature}.`)
      }
      continue
    }
    if (!hasFeature(actorGrantableFeatures, feature)) {
      throw forbidden(`Cannot grant feature ${feature}.`)
    }
  }

  if (requested.organizations !== undefined) {
    assertActorCanGrantOrganizations(actorAcl.organizations, requested.organizations)
  }
}

function assertActorCanGrantOrganizations(
  actorOrganizations: string[] | null,
  requestedOrganizations: string[] | null,
): void {
  if (actorOrganizations === null || actorOrganizations.includes('__all__')) return

  if (requestedOrganizations === null || requestedOrganizations.includes('__all__')) {
    throw forbidden('Cannot grant unrestricted organization access.')
  }

  for (const organizationId of requestedOrganizations) {
    if (!actorOrganizations.includes(organizationId)) {
      throw forbidden('Cannot grant organization access outside actor scope.')
    }
  }
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const dedup = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    dedup.add(trimmed)
  }
  return Array.from(dedup)
}

function normalizeOrganizationList(values: unknown): string[] | null {
  if (values === null || values === undefined) return null
  return normalizeStringList(values)
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isWildcardFeature(feature: string): boolean {
  return feature.endsWith('.*')
}
