import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { hasFeature } from '@open-mercato/shared/security/features'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Role, RoleAcl } from '@open-mercato/core/modules/auth/data/entities'
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

  for (const feature of requested.features) {
    if (feature === '*') {
      throw forbidden('Only super administrators can grant global wildcard access.')
    }
    if (isWildcardFeature(feature)) {
      if (!actorAcl.features.includes(feature)) {
        throw forbidden(`Cannot grant feature wildcard ${feature}.`)
      }
      continue
    }
    if (!hasFeature(actorAcl.features.filter((grant) => grant !== '*'), feature)) {
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
