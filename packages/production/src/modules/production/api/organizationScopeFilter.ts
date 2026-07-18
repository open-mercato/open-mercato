/**
 * Builds the MikroORM `organizationId` filter clause for a single-record
 * detail lookup, mirroring the resolution `makeCrudRoute` uses for list
 * queries (`packages/shared/src/lib/crud/factory.ts`): when the caller has a
 * resolved multi-organization scope (`organizationIds`, e.g. the org switcher
 * is in "All Organizations" mode) filter with `$in`; otherwise fall back to
 * the single `selectedOrganizationId`.
 *
 * Pure/unit-testable on purpose — the `[id]` detail routes (boms, routings)
 * need this same clause for both the parent entity load and the child
 * items/operations lookup, and getting it wrong 404s legitimate rows for
 * multi-org users (see task 1.3 review finding).
 */
export function resolveOrganizationScopeFilter(scope: {
  organizationIds?: string[] | null
  selectedOrganizationId?: string | null
}): { organizationId: string | { $in: string[] } | undefined } {
  if (Array.isArray(scope.organizationIds) && scope.organizationIds.length > 0) {
    return { organizationId: { $in: scope.organizationIds } }
  }
  return { organizationId: scope.selectedOrganizationId ?? undefined }
}
