import type { OrganizationHierarchyService } from '@open-mercato/shared/lib/auth/principal-service'
import type { RoleAcl } from '../data/entities'

export type RoleOrganizationScope = ReadonlySet<string> | null

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function resolveRoleOrganizationScope(
  hierarchyService: OrganizationHierarchyService | null | undefined,
  tenantId: string | null | undefined,
  organizationId: string | null | undefined,
): Promise<RoleOrganizationScope> {
  const selectedId = normalizeId(organizationId)
  if (!selectedId) return null
  const normalizedTenantId = normalizeId(tenantId)
  if (!normalizedTenantId) return new Set()

  const ids = new Set<string>([selectedId])
  // Auth remains independently usable when Directory is disabled: exact-org
  // grants still apply, while parent-to-descendant expansion fails closed.
  if (!hierarchyService) return ids

  const ancestorIds = await hierarchyService.resolveAncestorIds({
    tenantId: normalizedTenantId,
    organizationId: selectedId,
  })
  // A registered Directory seam can prove an invalid/wrong-tenant selection.
  // Fail closed for restricted roles in that case.
  if (ancestorIds === null) return new Set()
  for (const ancestorId of ancestorIds) {
    const normalized = normalizeId(ancestorId)
    if (normalized) ids.add(normalized)
  }
  return ids
}

export function roleAclAllowsOrganization(
  acl: Pick<RoleAcl, 'organizationsJson'>,
  scope: RoleOrganizationScope,
): boolean {
  if (!scope) return true
  const organizations = Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null
  if (!organizations || organizations.length === 0 || organizations.includes('__all__')) return true
  return organizations.some((organizationId) => scope.has(organizationId))
}

/**
 * Principal eligibility — which roles may be selected as, or resolved into, an explicit share
 * target — follows the human-principal deny-all contract instead: an empty allowlist grants no
 * organization reach, so such a role must not become a share principal here (#4033).
 *
 * This deliberately differs from `roleAclAllowsOrganization` above, which governs *feature*
 * evaluation and keeps the wider "an empty list applies everywhere" meaning, and from the
 * API-key projection, where an empty list means "inherit the key's own organization binding".
 * Without this split a user who reaches an organization through a second role could inherit
 * viewer/editor access from a share assigned to a deny-all role.
 */
export function roleAclGrantsPrincipalOrganization(
  acl: Pick<RoleAcl, 'organizationsJson'>,
  scope: RoleOrganizationScope,
): boolean {
  if (!scope) return true
  const organizations = Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null
  if (!organizations) return true
  if (organizations.length === 0) return false
  if (organizations.includes('__all__')) return true
  return organizations.some((organizationId) => scope.has(organizationId))
}
