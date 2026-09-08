export type DocumentsOrganizationAcl = {
  isSuperAdmin: boolean
  organizations: string[] | null
}

export type ResolvedDocumentsOrganizationScope = {
  selectedId?: string | null
  allowedIds?: string[] | null
}

function normalizeIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)))
}

/**
 * Validate a Documents organization decision against the raw, current ACL.
 *
 * The shared organization resolver intentionally falls back to the account
 * organization when an allowlist expands to no persisted organizations. That
 * behavior is useful for ordinary account navigation, but an authorization
 * boundary must not let an empty or stale allowlist acquire access through
 * that fallback. Requiring both the selected organization and at least one
 * original grant in the expanded set preserves parent-to-child grants while
 * failing closed for empty or unresolved grant lists.
 */
export function hasResolvedDocumentsOrganizationAccess(
  acl: DocumentsOrganizationAcl,
  organizationId: string,
  scope?: ResolvedDocumentsOrganizationScope | null,
): boolean {
  if (acl.isSuperAdmin || acl.organizations === null) return true

  const grants = normalizeIds(acl.organizations)
  if (grants.includes('__all__')) return true
  if (grants.includes(organizationId)) return true
  if (grants.length === 0) return false

  const allowedIds = normalizeIds(scope?.allowedIds)
  return allowedIds.includes(organizationId)
    && grants.some((grant) => allowedIds.includes(grant))
}
