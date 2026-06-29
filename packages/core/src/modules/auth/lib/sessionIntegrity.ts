import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, RoleAcl, Session, User, UserAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVALID_SCOPE = Symbol('invalid-scope')

type NormalizedScopeId = string | null | typeof INVALID_SCOPE

function normalizeScopeId(value: unknown): NormalizedScopeId {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return INVALID_SCOPE
  const trimmed = value.trim()
  if (!trimmed) return null
  return UUID_RE.test(trimmed) ? trimmed : INVALID_SCOPE
}

function resolveActorTenantId(auth: NonNullable<AuthContext>): NormalizedScopeId {
  const actorTenantId = (auth as { actorTenantId?: unknown }).actorTenantId
  return normalizeScopeId(actorTenantId ?? auth.tenantId ?? null)
}

function resolveActorOrganizationId(auth: NonNullable<AuthContext>): NormalizedScopeId {
  const actorOrgId = (auth as { actorOrgId?: unknown }).actorOrgId
  return normalizeScopeId(actorOrgId ?? auth.orgId ?? null)
}

export async function resolveCanonicalStaffAuthContext(
  em: EntityManager,
  auth: AuthContext,
): Promise<AuthContext> {
  if (!auth) return null
  if (auth.isApiKey) return auth

  const subjectId = normalizeScopeId(auth.sub)
  const actorTenantId = resolveActorTenantId(auth)
  const actorOrganizationId = resolveActorOrganizationId(auth)
  if (
    subjectId === INVALID_SCOPE ||
    actorTenantId === INVALID_SCOPE ||
    actorOrganizationId === INVALID_SCOPE
  ) {
    return null
  }

  // Session binding: when the JWT carries an `sid` claim, require the referenced session to
  // still exist (not soft-deleted, not expired). This is what makes logout / password-reset
  // actually invalidate an already-issued JWT.
  //
  // Legacy tokens (pre-migration, without `sid`) are allowed through during the grace period
  // (controlled by JWT_LEGACY_GRACE_MINUTES) so that rolling deployments don't force-logout
  // every user. Once the grace period expires these tokens will fail signature verification
  // in `verifyJwt` before reaching this point.
  const sessionId = normalizeScopeId(typeof auth.sid === 'string' ? auth.sid : null)
  if (sessionId === INVALID_SCOPE) return null
  if (sessionId === null) {
    // Legacy token without sid — allow only if it was verified via the legacy fallback path.
    // The `_legacyToken` flag is set by `verifyJwt` when a token passes raw-secret verification
    // but fails audience-derived verification. Without this flag, reject.
    if ((auth as Record<string, unknown>)._legacyToken === true) {
      // Allow through without session validation — the token will expire naturally
    } else {
      return null
    }
  }
  // The session-revocation check and the user load are independent (neither reads
  // the other's result), so they run concurrently to collapse two sequential DB
  // round-trips into one. The `em` here is a fresh request-scoped EntityManager
  // (resolved per request, never inside an explicit transaction), so concurrent
  // reads on it are safe.
  //
  // The session lookup is bound to the token subject (`user: subjectId`) so the
  // referenced session must actually belong to the JWT's subject. Without this
  // binding, a forged-but-otherwise-valid token could pair `sub` for one user with
  // a still-live `sid` belonging to another, evading per-user session revocation
  // (logout / deleteAllUserSessions / password reset).
  const sessionPromise = sessionId !== null
    ? findOneWithDecryption(em, Session, { id: sessionId, user: subjectId, deletedAt: null })
    : Promise.resolve(null)
  const userPromise = findOneWithDecryption(
    em,
    User,
    { id: subjectId, deletedAt: null },
    undefined,
    { tenantId: actorTenantId, organizationId: actorOrganizationId },
  )
  const [session, user] = await Promise.all([sessionPromise, userPromise])

  if (sessionId !== null) {
    if (!session) return null
    if (resolveSessionUserId(session) !== subjectId) return null
    if (session.expiresAt.getTime() < Date.now()) return null
  }

  if (!user) return null

  const currentTenantId = normalizeScopeId(user.tenantId ?? null)
  const currentOrganizationId = normalizeScopeId(user.organizationId ?? null)
  if (
    currentTenantId === INVALID_SCOPE ||
    currentOrganizationId === INVALID_SCOPE ||
    currentTenantId !== actorTenantId ||
    currentOrganizationId !== actorOrganizationId
  ) {
    return null
  }

  // Role links and the per-user super-admin flag are likewise independent, so they
  // run concurrently. The role-level super-admin lookup depends on the resolved
  // role ids, so it stays sequential after the links resolve (and is skipped
  // entirely when the per-user flag already grants super-admin).
  const linksPromise = currentTenantId
    ? findWithDecryption(
        em,
        UserRole,
        {
          user: user.id,
          deletedAt: null,
          role: { tenantId: currentTenantId, deletedAt: null } as unknown as Role,
        } as never,
        { populate: ['role'] },
        { tenantId: currentTenantId, organizationId: currentOrganizationId },
      )
    : Promise.resolve([] as UserRole[])
  const userAclSuperAdminPromise = currentTenantId
    ? userAclGrantsSuperAdmin(em, user.id, currentTenantId, currentOrganizationId)
    : Promise.resolve(false)
  const [links, userAclSuperAdmin] = await Promise.all([linksPromise, userAclSuperAdminPromise])

  const linkedRoles = links
    .map((link) => link.role)
    .filter((role): role is Role => !!role)

  const roles = linkedRoles
    .map((role) => role.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)

  const isSuperAdmin = currentTenantId
    ? userAclSuperAdmin || (await roleAclGrantsSuperAdmin(em, linkedRoles, currentTenantId, currentOrganizationId))
    : false

  return {
    ...auth,
    sub: user.id,
    tenantId: currentTenantId,
    orgId: currentOrganizationId,
    roles,
    isSuperAdmin,
  }
}

function resolveSessionUserId(session: Session): string | null {
  const owner = (session as { user?: unknown }).user
  if (typeof owner === 'string') return owner
  if (owner && typeof owner === 'object') {
    const ownerId = (owner as { id?: unknown }).id
    if (typeof ownerId === 'string') return ownerId
  }
  return null
}

async function userAclGrantsSuperAdmin(
  em: EntityManager,
  userId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<boolean> {
  const userAcl = await findOneWithDecryption(
    em,
    UserAcl,
    {
      user: userId,
      tenantId,
      isSuperAdmin: true,
      deletedAt: null,
    } as never,
    undefined,
    { tenantId, organizationId },
  )
  return !!(userAcl && (userAcl as { isSuperAdmin?: boolean }).isSuperAdmin === true)
}

async function roleAclGrantsSuperAdmin(
  em: EntityManager,
  linkedRoles: Role[],
  tenantId: string,
  organizationId: string | null,
): Promise<boolean> {
  const roleIds = Array.from(
    new Set(
      linkedRoles
        .map((role) => (role?.id ? String(role.id) : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  )
  if (!roleIds.length) return false

  const roleAcl = await findOneWithDecryption(
    em,
    RoleAcl,
    {
      tenantId,
      isSuperAdmin: true,
      deletedAt: null,
      role: { $in: roleIds },
    } as never,
    undefined,
    { tenantId, organizationId },
  )
  return !!(roleAcl && (roleAcl as { isSuperAdmin?: boolean }).isSuperAdmin === true)
}

export async function isAuthContextValid(
  em: EntityManager,
  auth: AuthContext,
): Promise<boolean> {
  return (await resolveCanonicalStaffAuthContext(em, auth)) !== null
}
