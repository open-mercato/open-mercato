import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { badRequest, CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { hasFeature } from '@open-mercato/shared/security/features'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Role, RoleAcl, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'

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

type UserDestinationRolesInput = {
  em: EntityManager
  targetUserId: string
  destinationTenantId: string | null | undefined
  roleTokens: unknown
}

type UserDestinationScopeCheckInput = GrantCheckContext & {
  actorIsSuperAdmin?: boolean
  allowedOrganizationIds?: string[] | null
  destinationTenantId: string | null | undefined
  destinationOrganizationId: string | null | undefined
  roles: Role[]
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

type UserTargetAccessInput = SuperAdminUserTargetInput & {
  organizationScope: Pick<OrganizationScope, 'allowedIds'>
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

export async function resolveUserDestinationRoles(input: UserDestinationRolesInput): Promise<Role[]> {
  const destinationTenantId = normalizeNullableString(input.destinationTenantId)
  if (Array.isArray(input.roleTokens)) {
    return resolveRolesForGrant(input.em, normalizeStringList(input.roleTokens), destinationTenantId)
  }

  const links = await findWithDecryption(
    input.em,
    UserRole,
    { user: input.targetUserId as unknown as User } as FilterQuery<UserRole>,
    { populate: ['role'] },
    { tenantId: null, organizationId: null },
  )
  const roles: Role[] = []
  for (const link of links) {
    const linkedRole = (link as { role?: Role | string | null }).role
    if (linkedRole && typeof linkedRole === 'object') {
      roles.push(linkedRole)
      continue
    }
    if (typeof linkedRole === 'string') {
      const resolvedRole = await resolveRoleForGrant(input.em, linkedRole, null)
      if (resolvedRole) {
        roles.push(resolvedRole)
        continue
      }
    }
    throw badRequest(await translateAuthError(
      'auth.users.errors.invalidRoleAssignment',
      'User has an invalid role assignment',
    ))
  }
  return roles
}

export async function assertActorCanAssignUserDestination(
  input: UserDestinationScopeCheckInput,
): Promise<void> {
  const destinationTenantId = normalizeNullableString(input.destinationTenantId)
  const destinationOrganizationId = normalizeNullableString(input.destinationOrganizationId)
  if (!destinationTenantId || !destinationOrganizationId) {
    return throwUserDestinationOrganizationNotFound(400)
  }

  for (const role of input.roles) {
    if (normalizeNullableString(role.tenantId) !== destinationTenantId) {
      throw forbidden(await translateAuthError(
        'auth.users.errors.roleOutsideDestinationTenant',
        'Cannot retain or assign a role outside the destination tenant.',
      ))
    }
  }

  if (await resolveActorIsSuperAdmin(input)) return

  const actorTenantId = normalizeNullableString(input.tenantId)
  if (!actorTenantId || actorTenantId !== destinationTenantId) {
    return throwUserDestinationOrganizationNotFound(404)
  }

  const actorAcl = await loadActorAcl(input)
  const allowedOrganizationIds = input.allowedOrganizationIds === undefined
    ? actorAcl.organizations
    : input.allowedOrganizationIds
  if (
    allowedOrganizationIds !== null
    && !allowedOrganizationIds.includes('__all__')
    && !allowedOrganizationIds.includes(destinationOrganizationId)
  ) {
    throw forbidden(await translateAuthError(
      'auth.users.errors.destinationOrganizationOutsideScope',
      'Cannot assign user to a destination organization outside actor scope.',
    ))
  }

  await assertActorCanGrantRoles({
    ...input,
    tenantId: destinationTenantId,
    roles: input.roles,
  })
}

export async function throwUserDestinationOrganizationNotFound(status: 400 | 404): Promise<never> {
  throw new CrudHttpError(status, {
    error: await translateAuthError(
      'auth.users.errors.organizationNotFound',
      'Organization not found',
    ),
  })
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

/**
 * `input.tenantId` is the ACTOR's scope, not the target's: the check below is a
 * comparison between the two, so passing a tenant derived from the target turns
 * it into a tautology. Callers that resolve a record scope separately MUST still
 * hand this guard `auth.tenantId`.
 */
export async function assertActorCanAccessUserTarget(input: UserTargetAccessInput): Promise<void> {
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

  if (input.organizationScope.allowedIds !== null) {
    const targetOrganizationId = normalizeNullableString((target as { organizationId?: string | null }).organizationId)
    if (!targetOrganizationId || !input.organizationScope.allowedIds.includes(targetOrganizationId)) {
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

/**
 * Answers "is this user effectively a super-admin" about a TARGET — the input to
 * `assertActorCanModifySuperAdminUserTarget`, not to any authorization decision
 * about the caller.
 *
 * It is bound to the target's OWN tenant (`users.tenant_id`) and to live grant
 * rows, because that is the reading the two authorities already share:
 * `RbacService.isGlobalSuperAdmin` and `lib/sessionIntegrity.ts`
 * (`userAclGrantsSuperAdmin` / `roleAclGrantsSuperAdmin`). A protection
 * predicate that answered differently would protect people who hold nothing —
 * a grant stamped a foreign tenant, or one that was revoked — while every
 * authorization path treats them as ordinary users. That over-protection does
 * not expire: nothing short of a super-admin could edit such an account again,
 * and revoking someone's super-admin would leave them permanently unmanageable
 * by their own tenant's admins.
 *
 * Two asymmetries with `isGlobalSuperAdmin` are deliberate:
 *
 * - Organization-restricted role grants are NOT excluded. That exclusion only
 *   keeps them out of the GLOBAL answer; `loadAcl`'s scoped projection still
 *   returns `isSuperAdmin: true` for such a role inside the organizations it
 *   names, so its holder is a privileged target. A protection predicate may be
 *   a superset of the authorization answer; it must never be a subset.
 * - The `User` load carries no `deletedAt` filter, matching the load in
 *   `assertActorCanAccessUserTarget` below. A soft-deleted super-admin stays
 *   protected; it is the ACL rows that must be live.
 *
 * "No user row" and "no tenant of their own" both answer false, as
 * `isGlobalSuperAdmin` does. Neither is exploitable, because every call site
 * pairs this guard with `assertActorCanAccessUserTarget`: that one delegates a
 * missing target to the caller's own tenant-scoped load, and 404s a target
 * whose `tenantId` is absent, so no mutation reaches either case.
 */
export async function isUserEffectivelySuperAdmin(em: EntityManager, userId: string): Promise<boolean> {
  const target = await findOneWithDecryption(
    em,
    User,
    { id: userId } as FilterQuery<User>,
    {},
    { tenantId: null, organizationId: null },
  )
  const tenantId = normalizeNullableString((target as { tenantId?: string | null } | null)?.tenantId)
  if (!tenantId) return false
  const directGrant = await em.findOne(
    UserAcl,
    { user: userId as unknown, tenantId, isSuperAdmin: true, deletedAt: null } as FilterQuery<UserAcl>,
  )
  if (directGrant && (directGrant as { isSuperAdmin?: boolean }).isSuperAdmin === true) return true
  const links = await findWithDecryption(
    em,
    UserRole,
    // Roles of the user's own tenant, the same restriction `isGlobalSuperAdmin`
    // applies. The encryption scope stays `{ null, null }`: this is about which
    // rows count, not about which key decrypts them.
    {
      user: userId as unknown,
      deletedAt: null,
      role: { tenantId, deletedAt: null },
    } as FilterQuery<UserRole>,
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
    { role: { $in: roleIds } as unknown, tenantId, isSuperAdmin: true, deletedAt: null } as FilterQuery<RoleAcl>,
  )
  return !!roleGrant && (roleGrant as { isSuperAdmin?: boolean }).isSuperAdmin === true
}

/**
 * The role twin of `isUserEffectivelySuperAdmin`, and it carries the same
 * reading for the same reasons: the grant must be live, and it must be stamped
 * with the role's OWN tenant. A `role_acls` row stamped elsewhere confers
 * nothing (`RbacService.loadAcl` reads role ACLs `{ tenantId, deletedAt: null }`),
 * so protecting a role on the strength of one would refuse an edit that every
 * authorization path considers ordinary.
 *
 * A role that does not exist answers false, which its paired guard
 * `assertActorCanAccessRoleTarget` then delegates to the caller in the same way
 * the user side does.
 */
export async function isRoleEffectivelySuperAdmin(em: EntityManager, roleId: string): Promise<boolean> {
  const role = await findOneWithDecryption(
    em,
    Role,
    { id: roleId } as FilterQuery<Role>,
    {},
    { tenantId: null, organizationId: null },
  )
  const tenantId = normalizeNullableString((role as { tenantId?: string | null } | null)?.tenantId)
  if (!tenantId) return false
  const grant = await em.findOne(
    RoleAcl,
    { role: roleId as unknown, tenantId, isSuperAdmin: true, deletedAt: null } as FilterQuery<RoleAcl>,
  )
  return !!grant && (grant as { isSuperAdmin?: boolean }).isSuperAdmin === true
}

/**
 * The super-admin user ids a non-super-admin must not be shown while looking at
 * `tenantId` — an exclusion list, not an authorization answer.
 *
 * `tenantId` names the tenant whose users are being listed. Because a
 * super-admin grant is bound to the holder's own tenant (see
 * `isUserEffectivelySuperAdmin` above and `RbacService.isGlobalSuperAdmin`),
 * that is also the tenant a grant must be stamped with in order to count here,
 * so the filter is applied to BOTH ACL tables. It used to reach only
 * `user_acls`, which made the two halves disagree about what a tenant-scoped
 * answer meant.
 *
 * The narrowing on `role_acls` is only safe TOGETHER with that tenant binding:
 * while a foreign-stamped row still conferred super-admin, dropping it from this
 * list would have unhidden a real one.
 *
 * The caller owes the other half of the scoping. This returns ids; it is the
 * caller's own subject query that must already be restricted to `tenantId`.
 * Both wired call sites are — `auth/api/users/route.ts` filters the user query
 * by the same tenant, and documents' principals route scopes to `ctx.tenantId`
 * — so a role member living in another tenant is merely excluded from a list
 * they were never in. That is not licence to pass a tenant unrelated to the
 * subject set.
 *
 * Deliberately NOT narrowed further: organization-restricted role grants count
 * (their holders are super-admins inside those organizations), and the
 * `user_roles` expansion stays tenant-less. Over-inclusion there is bounded by
 * the caller's subject scoping, and for an exclusion list hiding one user too
 * many is the safe direction.
 */
export async function listSuperAdminUserIds(em: EntityManager, tenantId: string | null): Promise<Set<string>> {
  const ids = new Set<string>()
  // A revoked override must not keep answering — the same rule the ACL reads in
  // `RbacService` follow.
  const userAclFilter: Record<string, unknown> = { isSuperAdmin: true, deletedAt: null }
  if (tenantId) userAclFilter.tenantId = tenantId
  const userAcls = await em.find(UserAcl, userAclFilter as FilterQuery<UserAcl>)
  for (const acl of userAcls) {
    const userRef = (acl as { user?: { id?: unknown } | string | null }).user
    const userId = userRef && typeof userRef === 'object'
      ? userRef.id
      : userRef
    if (userId) ids.add(String(userId))
  }
  const roleAclFilter: Record<string, unknown> = { isSuperAdmin: true, deletedAt: null }
  if (tenantId) roleAclFilter.tenantId = tenantId
  const roleAcls = await em.find(RoleAcl, roleAclFilter as FilterQuery<RoleAcl>)
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
      {
        deletedAt: null,
        role: { id: { $in: roleIds }, deletedAt: null },
      } as FilterQuery<UserRole>,
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

async function translateAuthError(key: string, fallback: string): Promise<string> {
  const { translate } = await resolveTranslations()
  return translate(key, fallback)
}
