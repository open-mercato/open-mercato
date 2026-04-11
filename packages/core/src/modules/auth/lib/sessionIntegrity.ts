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
  // actually invalidate an already-issued JWT. Legacy tokens without `sid` are rejected so
  // callers must re-authenticate after the fix rolls out.
  const sessionId = normalizeScopeId(typeof auth.sid === 'string' ? auth.sid : null)
  if (sessionId === INVALID_SCOPE) return null
  if (sessionId === null) return null
  const session = await findOneWithDecryption(em, Session, { id: sessionId, deletedAt: null })
  if (!session) return null
  if (session.expiresAt.getTime() < Date.now()) return null

  const user = await findOneWithDecryption(
    em,
    User,
    { id: subjectId, deletedAt: null },
    undefined,
    { tenantId: actorTenantId, organizationId: actorOrganizationId },
  )
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

  const links = currentTenantId
    ? await findWithDecryption(
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
    : []

  const linkedRoles = links
    .map((link) => link.role)
    .filter((role): role is Role => !!role)

  const roles = linkedRoles
    .map((role) => role.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)

  const isSuperAdmin = currentTenantId
    ? await hasSuperAdminFlag(em, user.id, linkedRoles, currentTenantId, currentOrganizationId)
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

async function hasSuperAdminFlag(
  em: EntityManager,
  userId: string,
  linkedRoles: Role[],
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
  if (userAcl && (userAcl as { isSuperAdmin?: boolean }).isSuperAdmin === true) {
    return true
  }

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
