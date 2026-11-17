import type { OrganizationScope } from './organizationScope'
export { resolveSingleOrganizationIdOrDeny } from '@open-mercato/shared/lib/auth/organizationScope'

export type OrganizationScopeFilter = {
  organizationIds: string[] | undefined
  where: { organizationId?: { $in: string[] } }
  rbacOrganizationId: string | null
}

type OrgAuthLike = { orgId?: string | null } | null | undefined

export function resolveOrganizationScopeFilter(
  scope: OrganizationScope | null | undefined,
  auth: OrgAuthLike,
): OrganizationScopeFilter {
  const organizationIds = (() => {
    if (scope?.selectedId) return [scope.selectedId]
    if (Array.isArray(scope?.filterIds)) return scope.filterIds
    if (scope?.filterIds === null) return undefined
    if (!scope && auth?.orgId) return [auth.orgId]
    return undefined
  })()

  const isExplicitlyEmpty = Array.isArray(scope?.filterIds) && scope.filterIds.length === 0

  return {
    organizationIds,
    where: organizationIds ? { organizationId: { $in: organizationIds } } : {},
    rbacOrganizationId: scope?.selectedId ?? (isExplicitlyEmpty ? null : auth?.orgId ?? null),
  }
}
