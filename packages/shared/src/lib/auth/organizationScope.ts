type OrganizationScopedAuth = {
  orgId?: string | null
  actorOrgId?: unknown
} | null | undefined

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
 * Answering 401 for that case is not merely wrong but self-perpetuating: `apiFetch`
 * reads 401 as an expired session and redirects through `/api/auth/session/refresh`,
 * which succeeds and returns to the same page, reloading forever.
 */
export function resolveActiveOrganizationId(auth: OrganizationScopedAuth): string | null {
  if (!auth) return null
  const selected = auth.orgId
  if (typeof selected === 'string' && selected.trim().length > 0) return selected
  const actorOrgId = auth.actorOrgId
  if (typeof actorOrgId === 'string' && actorOrgId.trim().length > 0) return actorOrgId
  return null
}
