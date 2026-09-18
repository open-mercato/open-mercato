type OrganizationScopedAuth = {
  orgId?: string | null
  actorOrgId?: unknown
  tenantId?: string | null
  actorTenantId?: unknown
} | null | undefined

function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Resolves the organization a request is scoped to when the caller may be viewing
 * "all organizations".
 *
 * Organization-scoped configuration modules (integrations credentials/state, data sync
 * mappings/schedules/runs) all require a non-null `organization_id`, so there is no
 * meaningful "all organizations" view of them. When an operator selects that option the
 * super-admin cookie override clears `auth.orgId` and preserves the actor's own
 * organization in `actorOrgId`; fall back to it so those modules keep showing the
 * operator's own configuration instead of failing.
 *
 * The fallback is only valid while the effective tenant is still the actor's own tenant.
 * When the super-admin cookie override also switched tenants (`actorTenantId` is present
 * and differs from `auth.tenantId`), the actor's organization belongs to another tenant —
 * scoping to it would persist a cross-tenant `{ organizationId, tenantId }` pair. Return
 * `null` instead and let the route answer with `organizationScopeRequiredResponse()`.
 *
 * Answering 401 for an unresolvable scope is not merely wrong but self-perpetuating:
 * `apiFetch` reads 401 as an expired session and redirects through
 * `/api/auth/session/refresh`, which succeeds and returns to the same page, reloading
 * forever. That is why the missing-scope answer is a 400, never a 401.
 */
export function resolveActiveOrganizationId(auth: OrganizationScopedAuth): string | null {
  if (!auth) return null
  const selected = normalizeId(auth.orgId)
  if (selected) return selected
  const actorOrgId = normalizeId(auth.actorOrgId)
  if (!actorOrgId) return null
  if ('actorTenantId' in auth) {
    const actorTenantId = normalizeId(auth.actorTenantId)
    const effectiveTenantId = normalizeId(auth.tenantId)
    if (!actorTenantId || actorTenantId !== effectiveTenantId) return null
  }
  return actorOrgId
}

export const ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE = 'organization_scope_required'

/**
 * 400 response for an authenticated caller whose organization scope cannot be resolved
 * (e.g. a super-admin viewing a foreign tenant with "all organizations" selected).
 * Deliberately not a 401: the session is valid, so refreshing it would loop.
 */
export function organizationScopeRequiredResponse(): Response {
  return Response.json(
    {
      error: 'Select an organization to access this resource',
      code: ORGANIZATION_SCOPE_REQUIRED_ERROR_CODE,
    },
    { status: 400 },
  )
}
