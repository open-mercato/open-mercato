import type { EntityManager as CoreEntityManager } from '@mikro-orm/core'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'

// Matches no organization row, so a caller with nothing in scope reads an empty result set
// instead of being told their session failed. A 401 here is not merely wrong but harmful:
// `apiFetch` treats it as an expired session and bounces through /api/auth/session/refresh,
// which succeeds and returns to the same page — an endless reload.
export const NO_ORGANIZATION_SENTINEL = '00000000-0000-0000-0000-000000000000'

/**
 * Resolves the organization ids a deals read should filter by.
 *
 * `scope.filterIds === null` is the resolver's "all organizations" signal — it is only
 * returned once RBAC has cleared the caller for every org in the tenant, so it must widen
 * the read rather than narrow it. `auth.orgId` is null in exactly that case (the super-admin
 * org cookie override clears it), which is why it cannot be used as a fallback there.
 *
 * Always returns at least one id, so callers can rely on `[0]` for the single-organization
 * lookups (base currency, exchange-rate scope) these routes still perform.
 */
export async function resolveDealsOrganizationIds(params: {
  em: CoreEntityManager
  scope: Pick<OrganizationScope, 'filterIds'>
  auth: { orgId?: string | null }
  tenantId: string
}): Promise<string[]> {
  const { em, scope, auth, tenantId } = params
  if (Array.isArray(scope.filterIds) && scope.filterIds.length > 0) {
    return scope.filterIds.filter((id) => typeof id === 'string' && id.length > 0)
  }
  if (scope.filterIds === null) {
    const rows = await em.getConnection().execute<Array<{ id: string }>>(
      `SELECT id FROM organizations WHERE tenant_id = ? AND deleted_at IS NULL`,
      [tenantId],
    )
    const ids = rows.map((row: { id: string }) => String(row.id)).filter((id: string) => id.length > 0)
    if (ids.length > 0) return ids
  }
  return auth.orgId ? [auth.orgId] : [NO_ORGANIZATION_SENTINEL]
}
