import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

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

const VIEW_TENANT_FEATURES = ['audit_logs.view_tenant'] as const
const organizationIdSchema = z.string().uuid()

/**
 * Decide whether the caller may read other actors' audit-log rows.
 *
 * `audit_logs.view_tenant` must hold for the organization the query actually reads, so the
 * check runs against the organization left after `?organizationId=` narrowing, not the
 * caller's default one. A read with no organization predicate covers every organization of
 * the tenant, and a feature check without an organization is satisfied by a grant that is
 * limited to some organizations. Such a read therefore widens actor visibility only for a
 * grant that is not organization-restricted; otherwise the caller keeps its own rows.
 *
 * The `isSuperAdmin` flag on the auth context is not consulted: it is also set for a
 * super-admin role that is limited to some organizations. A principal without a tenant has
 * no organization grant to compare against and keeps the plain feature result.
 *
 * A request-supplied organization id that is not a UUID never reaches RBAC; the list schema
 * rejects it.
 */
export async function canViewTenantAuditLogs(input: {
  rbac: Pick<RbacService, 'userHasAllFeatures' | 'resolveFeatureOrganizationAccess'>
  auth: ResolvedAuth
  organizationId: string | null | undefined
  requestedOrganizationId?: string | null
}): Promise<boolean> {
  const { rbac, auth } = input
  const organizationId = input.organizationId ?? null
  const tenantId = auth.tenantId ?? null
  const fromRequest = organizationId !== null && organizationId === input.requestedOrganizationId
  if (fromRequest && !organizationIdSchema.safeParse(organizationId).success) return false
  const granted = await rbac.userHasAllFeatures(auth.sub, [...VIEW_TENANT_FEATURES], { tenantId, organizationId })
  if (!granted || organizationId || !tenantId) return granted
  const access = await rbac.resolveFeatureOrganizationAccess(auth.sub, VIEW_TENANT_FEATURES, { tenantId })
  return access.unrestricted
}
