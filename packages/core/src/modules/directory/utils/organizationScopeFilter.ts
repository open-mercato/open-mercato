import type { OrganizationScope } from './organizationScope'

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
    if (Array.isArray(scope?.filterIds) && scope.filterIds.length > 0) return scope.filterIds
    if (scope?.filterIds === null) return undefined
    if (auth?.orgId) return [auth.orgId]
    return undefined
  })()

  return {
    organizationIds,
    where: organizationIds ? { organizationId: { $in: organizationIds } } : {},
    rbacOrganizationId: scope?.selectedId ?? auth?.orgId ?? null,
  }
}
