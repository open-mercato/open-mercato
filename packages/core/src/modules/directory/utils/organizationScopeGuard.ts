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
 * bypass. For a resolved restricted scope, `filterIds` narrows the active view
 * and an empty array denies. The principal's home organization remains only as
 * the legacy fallback for callers that have no resolved scope object.
 */
export function isOrganizationReadAccessAllowed(input: OrganizationReadAccessInput): boolean {
  const isSuperAdmin = input.auth?.isSuperAdmin === true
  if (isSuperAdmin || input.scope?.allowedIds === null) return true

  const allowedOrganizationIds = new Set<string>()
  if (Array.isArray(input.scope?.filterIds)) {
    for (const id of input.scope.filterIds) {
      if (typeof id === 'string' && id.trim().length) allowedOrganizationIds.add(id)
    }
  } else if (input.scope && Array.isArray(input.scope.allowedIds)) {
    for (const id of input.scope.allowedIds) {
      if (typeof id === 'string' && id.trim().length) allowedOrganizationIds.add(id)
    }
  } else if (!input.scope && input.auth?.orgId) {
    allowedOrganizationIds.add(input.auth.orgId)
  }

  return isOrganizationAccessAllowed({
    isSuperAdmin,
    allowedOrganizationIds: Array.from(allowedOrganizationIds),
    targetOrganizationId: input.organizationId,
  })
}
