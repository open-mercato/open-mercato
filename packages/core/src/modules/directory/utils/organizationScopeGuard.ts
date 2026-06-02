import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { isOrganizationAccessAllowed } from '@open-mercato/shared/lib/auth/organizationAccess'
import type { OrganizationScope } from './organizationScope'

export type OrganizationReadAccessInput = {
  scope: OrganizationScope | null | undefined
  auth: AuthContext
  organizationId: string | null
}

/**
 * Fail-closed read guard for single-record detail routes. Centralizes the
 * decision so callers keep their own deny mechanism (throw / return response)
 * and their own i18n key.
 *
 * Unrestricted access (super admin or `scope.allowedIds === null`) is the only
 * bypass. For a restricted principal the allowed set is derived the same way
 * the detail routes always have (`filterIds` narrows the active view, else the
 * principal's home org); an empty derived set denies instead of skipping.
 */
export function isOrganizationReadAccessAllowed(input: OrganizationReadAccessInput): boolean {
  const isSuperAdmin = input.auth?.isSuperAdmin === true
  if (isSuperAdmin || input.scope?.allowedIds === null) return true

  const allowedOrganizationIds = new Set<string>()
  if (input.scope?.filterIds?.length) {
    for (const id of input.scope.filterIds) {
      if (typeof id === 'string' && id.trim().length) allowedOrganizationIds.add(id)
    }
  } else if (input.auth?.orgId) {
    allowedOrganizationIds.add(input.auth.orgId)
  }

  return isOrganizationAccessAllowed({
    isSuperAdmin,
    allowedOrganizationIds: Array.from(allowedOrganizationIds),
    targetOrganizationId: input.organizationId,
  })
}
