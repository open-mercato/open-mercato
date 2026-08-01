type OrganizationScopedAuth = {
  orgId?: string | null
  actorOrgId?: unknown
} | null | undefined

/**
 * Resolves the organization an integrations request is scoped to.
 *
 * Integrations are configured per organization — `integration_credentials` and
 * `integration_states` both require a non-null `organization_id` — so there is no
 * meaningful "all organizations" view of this module. When an operator selects that
 * option the super-admin cookie override clears `auth.orgId` and preserves the actor's
 * own organization in `actorOrgId`; fall back to it so the module keeps showing the
 * operator's own configuration instead of failing.
 *
 * Answering 401 for that case is not merely wrong but self-perpetuating: `apiFetch`
 * reads 401 as an expired session and redirects through `/api/auth/session/refresh`,
 * which succeeds and returns to the same page, reloading forever.
 */
export function resolveIntegrationsOrganizationId(auth: OrganizationScopedAuth): string | null {
  if (!auth) return null
  const selected = auth.orgId
  if (typeof selected === 'string' && selected.trim().length > 0) return selected
  const actorOrgId = auth.actorOrgId
  if (typeof actorOrgId === 'string' && actorOrgId.trim().length > 0) return actorOrgId
  return null
}
