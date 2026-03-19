import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'

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

export async function isAuthContextValid(
  em: EntityManager,
  auth: AuthContext,
): Promise<boolean> {
  if (!auth) return false
  if (auth.isApiKey) return true

  const subjectId = normalizeScopeId(auth.sub)
  const actorTenantId = resolveActorTenantId(auth)
  const actorOrganizationId = resolveActorOrganizationId(auth)
  if (
    subjectId === INVALID_SCOPE ||
    actorTenantId === INVALID_SCOPE ||
    actorOrganizationId === INVALID_SCOPE
  ) {
    return false
  }

  const user = await findOneWithDecryption(
    em,
    User,
    { id: subjectId, deletedAt: null },
    undefined,
    { tenantId: actorTenantId, organizationId: actorOrganizationId },
  )
  if (!user) return false

  return (
    normalizeScopeId(user.tenantId ?? null) === actorTenantId &&
    normalizeScopeId(user.organizationId ?? null) === actorOrganizationId
  )
}
