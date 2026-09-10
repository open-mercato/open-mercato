/**
 * Tenant continuity hints for unauthenticated auth navigation.
 *
 * The `tenant` query parameter is a navigation hint only — it tells the login
 * entry which tenant the user was already resolved to so it can show tenant
 * branding instead of the generic form. It is never authorization, and it must
 * only ever be derived from a server-resolved user, never from request input.
 */

const TENANT_HINT_PARAM = 'tenant'

function normalizeTenantHint(tenantId: unknown): string | null {
  if (tenantId == null) return null
  const value = String(tenantId).trim()
  return value.length > 0 ? value : null
}

/**
 * Adds the tenant hint to an absolute URL (password reset and invitation email
 * links). Returns the URL unchanged for tenantless users or an unparsable URL,
 * so a hint can never cost a user their working link.
 */
export function withTenantHintUrl(url: string, tenantId: unknown): string {
  const tenant = normalizeTenantHint(tenantId)
  if (!tenant) return url
  try {
    const parsed = new URL(url)
    parsed.searchParams.set(TENANT_HINT_PARAM, tenant)
    return parsed.toString()
  } catch {
    return url
  }
}

/**
 * Adds the tenant hint to an app-relative path (the redirect handed back to the
 * browser after a successful reset). Returns the path unchanged for tenantless
 * users.
 */
export function withTenantHintPath(path: string, tenantId: unknown): string {
  const tenant = normalizeTenantHint(tenantId)
  if (!tenant) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}${TENANT_HINT_PARAM}=${encodeURIComponent(tenant)}`
}
