import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

function normalizeTenantValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Every tenant the signed-in actor may legitimately act as, most specific first.
 *
 * `applySuperAdminScope` rewrites `auth.tenantId` from the `om_selected_tenant` cookie and
 * preserves the actor's own tenant under `actorTenantId`. An empty cookie ("all tenants") sets
 * `auth.tenantId` to `null` on an otherwise fully authenticated session, so `auth.tenantId` alone
 * cannot decide whether a request comes from a foreign tenant — an explicitly selected tenant and
 * the actor's home tenant both have to be considered.
 */
function resolveScopedTenantIds(auth: AuthContext): string[] {
  if (!auth) return []
  const selectedTenantId = normalizeTenantValue(auth.tenantId)
  const actorTenantId = normalizeTenantValue((auth as { actorTenantId?: unknown }).actorTenantId)
  const scoped = [selectedTenantId, actorTenantId].filter((value): value is string => value !== null)
  return Array.from(new Set(scoped))
}

/**
 * The tenant a signed-in actor's reads and writes should be narrowed to, preferring an explicit
 * tenant selection over the actor's home tenant. Returns null for anonymous requests, which stay
 * unscoped — the public quote link is intentionally usable without a session.
 */
export function resolveActorTenantId(auth: AuthContext): string | null {
  return resolveScopedTenantIds(auth)[0] ?? null
}

/**
 * True when the request carries a staff session that belongs to a tenant other than the
 * document's. An authenticated session whose tenant cannot be resolved at all counts as foreign:
 * treating "tenant unknown" as "allow" is what defeated this guard in the first place (#4309).
 *
 * Anonymous requests are never foreign — that behavior is the point of the public quote link and
 * must be preserved.
 */
export function isForeignTenantActor(auth: AuthContext, documentTenantId: unknown): boolean {
  if (!auth) return false
  const ownerTenantId = normalizeTenantValue(documentTenantId)?.toLowerCase() ?? null
  if (ownerTenantId === null) return true
  return !resolveScopedTenantIds(auth).some((tenantId) => tenantId.toLowerCase() === ownerTenantId)
}
