export type OrganizationAccessDecisionInput = {
  isSuperAdmin: boolean
  allowedOrganizationIds: readonly string[] | null
  targetOrganizationId: string | null
}

export type UnrestrictedOrganizationScopeInput = {
  isSuperAdmin: boolean
  allowedOrganizationIds: readonly string[] | null | undefined
}

export function isUnrestrictedOrganizationScope(input: UnrestrictedOrganizationScopeInput): boolean {
  return input.isSuperAdmin || input.allowedOrganizationIds === null
}

/**
 * Fail-closed organization-access predicate. The single source of truth for
 * "may this principal act on `targetOrganizationId`".
 *
 * Decision table:
 * - `isSuperAdmin === true`            -> allow (global access)
 * - `allowedOrganizationIds === null`  -> allow (truly unrestricted)
 * - restricted + no target org         -> deny (empty/unknown scope is not a bypass)
 * - restricted + target org            -> allow iff the target is a member of the allowed set
 */
export function isOrganizationAccessAllowed(input: OrganizationAccessDecisionInput): boolean {
  if (isUnrestrictedOrganizationScope(input)) return true
  if (!input.targetOrganizationId) return false
  return (input.allowedOrganizationIds ?? []).includes(input.targetOrganizationId)
}
