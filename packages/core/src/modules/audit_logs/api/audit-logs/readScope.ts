import { NextResponse } from 'next/server'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

type ResolvedAuth = NonNullable<AuthContext>

// `isSuperAdmin` is not part of the declared `AuthContext` shape — it reaches callers
// through the type's index signature — so read it exactly the way
// `shared/lib/auth/server.ts` does instead of widening the shared contract here.
function isSuperAdmin(auth: ResolvedAuth): boolean {
  return (auth as Record<string, unknown>).isSuperAdmin === true
}

/**
 * Fail closed on tenant scope for audit-log reads.
 *
 * `audit_logs.view_tenant` only widens visibility WITHIN a tenant, so cross-tenant reads
 * must be gated on `isSuperAdmin`, never on the caller's tenant being empty: a tenant-less
 * principal (unscoped API key or global account) holding `view_tenant` otherwise drops the
 * tenant, organization and actor predicates at once and reads decrypted action-log rows for
 * every tenant in the instance (issues #3817, #3818).
 *
 * Plain truthiness is deliberate — it matches the `if (parsed.tenantId)` predicate guard in
 * ActionLogService/AccessLogService, so every value that would skip it is rejected here.
 */
export function requireResolvedTenantScope(auth: ResolvedAuth): NextResponse | null {
  if (auth.tenantId || isSuperAdmin(auth)) return null
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
