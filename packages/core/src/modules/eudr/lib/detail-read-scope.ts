export type DetailReadScope = {
  tenantId: string
  /** Matches the organization scope the list query itself used. */
  organizationFilter: string | { $in: string[] }
  /**
   * Fallback organization for decryption only. `decryptEntitiesWithFallbackScope`
   * prefers each record's own tenant/organization and consults this only when the
   * record carries none, so a single value stays correct for multi-org reads.
   */
  decryptionOrganizationId: string | null
}

type DetailReadScopeContext = {
  auth?: { tenantId?: string | null; orgId?: string | null } | null
  organizationIds?: string[] | null
  selectedOrganizationId?: string | null
}

/**
 * Resolves the scope for an `afterList` detail re-fetch (the decryption pass).
 *
 * The list query is scoped by the full `organizationIds` array, so re-fetching by
 * a single organization silently drops decrypted fields for a multi-org user who
 * has not selected one. Returns null when no scope can be established, so callers
 * fail closed rather than reading across the tenant.
 */
export function resolveDetailReadScope(ctx: DetailReadScopeContext): DetailReadScope | null {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) return null

  const scopedOrganizationIds = Array.isArray(ctx.organizationIds) && ctx.organizationIds.length
    ? Array.from(new Set(ctx.organizationIds))
    : null
  const singleOrganizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!scopedOrganizationIds && !singleOrganizationId) return null

  return {
    tenantId,
    organizationFilter: scopedOrganizationIds
      ? { $in: scopedOrganizationIds }
      : (singleOrganizationId as string),
    decryptionOrganizationId: singleOrganizationId,
  }
}
