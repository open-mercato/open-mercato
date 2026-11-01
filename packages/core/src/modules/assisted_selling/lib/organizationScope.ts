import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { OrganizationScope } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

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

type ResolveScopeParams = Parameters<typeof resolveOrganizationScopeForRequest>[0]

/**
 * Every staff route in this module resolves `organizationIds` the same way: call
 * `resolveOrganizationScopeForRequest`, then narrow it with
 * `organizationIdsFromAssistedSellingScope`. A scope-resolution failure MUST fail CLOSED —
 * every call site used to swallow it into a `null` scope (`.catch(() => null)`), which falls
 * through to this module's own "no real scope" fallback: the caller's raw `auth.orgId` (or,
 * for a superadmin with none selected, fully unrestricted). That silently turns a transient
 * resolution failure (a DB hiccup, a cache miss that throws) into whatever access the
 * fallback happens to grant — potentially WIDER than the caller's real, unresolved scope
 * would have allowed — instead of refusing the request the way an invalid scope normally
 * does (root AGENTS.md § Access Control: "invalid scope ... deny before ... wildcard grants").
 */
export async function resolveAssistedSellingOrganizationIds(params: ResolveScopeParams): Promise<string[] | null> {
  let scope: OrganizationScope
  try {
    scope = await resolveOrganizationScopeForRequest(params)
  } catch (err) {
    getTelemetryRuntime()?.reportError(err, { module: 'assisted_selling', code: 'assisted_selling.scope_resolution_failed' })
    throw new CrudHttpError(503, {
      error: '[internal] organization scope could not be resolved',
      code: 'organization_scope_unavailable',
    })
  }
  return organizationIdsFromAssistedSellingScope(scope, scope?.selectedId ?? params.auth?.orgId ?? null)
}
