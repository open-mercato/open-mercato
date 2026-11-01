import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'

// Step 4.4 (S9). `POST /threads` and `GET /threads` need the SAME `organizationIds` list
// derivation `makeCrudRoute` already applies internally for a multi-org caller — this module
// has no `makeCrudRoute`-backed route yet, so it resolves its own `OrganizationScope` and has
// no factory to derive it for it. Reimplemented locally rather than imported from `cart/lib/
// adminCartScope.ts#organizationIdsFromCartScope` (module-private per that file's own header
// comment: "root AGENTS.md forbids a cross-module import of another module's internal `lib/`
// helper") — same algorithm, the third module in this codebase to need it (after
// `customer_groups` and `cart`).
export function organizationIdsFromAssistedSellingScope(
  scope: OrganizationScope | null,
  fallbackOrganizationId: string | null,
): string[] | null {
  if (!scope) return fallbackOrganizationId ? [fallbackOrganizationId] : null
  const filterIds = Array.isArray(scope.filterIds)
    ? scope.filterIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : null
  if (filterIds === null) {
    if (scope.allowedIds === null) return null
    return fallbackOrganizationId ? [fallbackOrganizationId] : null
  }
  if (filterIds.length > 0) return Array.from(new Set(filterIds))
  if (!fallbackOrganizationId) return []
  const allowedIds = Array.isArray(scope.allowedIds) ? scope.allowedIds : null
  if (allowedIds === null || allowedIds.length === 0 || allowedIds.includes(fallbackOrganizationId)) {
    return [fallbackOrganizationId]
  }
  return []
}
