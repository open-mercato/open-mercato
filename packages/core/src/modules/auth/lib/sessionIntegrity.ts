import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, User, UserRole } from '@open-mercato/core/modules/auth/data/entities'

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

  const roles = links
    .map((link) => link.role?.name)
    .filter((role): role is string => typeof role === 'string' && role.trim().length > 0)

  return {
    ...auth,
    sub: user.id,
    tenantId: currentTenantId,
    orgId: currentOrganizationId,
    roles,
    isSuperAdmin: roles.some((role) => role.trim().toLowerCase() === 'superadmin'),
  }
}

export async function isAuthContextValid(
  em: EntityManager,
  auth: AuthContext,
): Promise<boolean> {
  return (await resolveCanonicalStaffAuthContext(em, auth)) !== null
}
