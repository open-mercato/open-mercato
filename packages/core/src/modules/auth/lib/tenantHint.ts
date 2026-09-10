/**
 * Tenant continuity hints for unauthenticated auth navigation.
 *
 * The `tenant` query parameter is a navigation hint only — it tells the login
 * entry which tenant the user was already resolved to so it can show tenant
 * branding instead of the generic form. It is never authorization, and it must
 * only ever be derived from a server-resolved user, never from request input.
 */

const TENANT_HINT_PARAM = 'tenant'

export type TenantHintSource = string | null | undefined

function normalizeTenantHint(tenantId: TenantHintSource): string | null {
  const value = tenantId?.trim()
  return value ? value : null
}

/**
 * Adds the tenant hint to an absolute URL (password reset and invitation email
 * links). Returns the URL unchanged for tenantless users or an unparsable URL,
 * so a hint can never cost a user their working link.
 */
export function withTenantHintUrl(url: string, tenantId: TenantHintSource): string {
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
 * users. Encoding and replace-don't-duplicate semantics match
 * {@link withTenantHintUrl}.
 */
export function withTenantHintPath(path: string, tenantId: TenantHintSource): string {
  const tenant = normalizeTenantHint(tenantId)
  if (!tenant) return path
  const [pathname, existingQuery = ''] = path.split('?')
  const params = new URLSearchParams(existingQuery)
  params.set(TENANT_HINT_PARAM, tenant)
  return `${pathname}?${params.toString()}`
}
