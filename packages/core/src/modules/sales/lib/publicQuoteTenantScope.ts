import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeTenantValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!UUID_RE.test(trimmed)) return null
  return trimmed.toLowerCase()
}

/**
 * The tenant a signed-in actor's reads and writes are scoped to, or null when none can be
 * resolved (including anonymous requests).
 *
 * `applySuperAdminScope` rewrites `auth.tenantId` from the `om_selected_tenant` cookie and
 * preserves the actor's own tenant under `actorTenantId`. An explicit selection is an intentional
 * scope and wins; an empty cookie ("all tenants") sets `auth.tenantId` to null on an otherwise
 * fully authenticated session, so the actor's own tenant is the fallback. `auth.tenantId` alone
 * cannot decide the scope, which is what defeated the public quote guard in #4309.
 *
 * A value that is not a well-formed UUID is treated as unresolvable rather than passed through to
 * a `uuid` column filter, since the cookie is attacker-controllable by the actor themselves.
 */
export function resolveEffectiveTenantId(auth: AuthContext): string | null {
  if (!auth) return null
  const selectedTenantId = normalizeTenantValue(auth.tenantId)
  if (selectedTenantId !== null) return selectedTenantId
  return normalizeTenantValue((auth as { actorTenantId?: unknown }).actorTenantId)
}

/**
 * True when the request carries a session belonging to a tenant other than the document's.
 *
 * An authenticated session whose tenant cannot be resolved counts as foreign — treating
 * "tenant unknown" as "allow" is the #4309 bug. Two cases are deliberately NOT foreign:
 *
 * - Anonymous requests. The public quote link is meant to work without a session, and denying
 *   here would break the endpoint's entire purpose.
 * - API keys with no tenant. `ApiKey.tenantId` is nullable, so a global key legitimately resolves
 *   to no tenant. Denying it would reject a more-privileged caller than the anonymous one that
 *   the same link already serves.
 */
export function isForeignTenantActor(auth: AuthContext, documentTenantId: unknown): boolean {
  if (!auth) return false
  const effectiveTenantId = resolveEffectiveTenantId(auth)
  if (effectiveTenantId === null) return auth.isApiKey !== true
  return effectiveTenantId !== normalizeTenantValue(documentTenantId)
}
