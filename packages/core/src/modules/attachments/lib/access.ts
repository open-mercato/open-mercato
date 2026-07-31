import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type { Attachment, AttachmentPartition } from '../data/entities'

export type AttachmentScope = {
  tenantId?: string | null
  organizationId?: string | null
}

function normalizeScopeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Enforce the attachments scope invariant at every creation boundary:
 * an attachment is either fully **global** (both `tenant_id` and
 * `organization_id` null) or fully **scoped** (both set) — never partial.
 *
 * `isSameScope` deliberately treats a partial-null row as inaccessible to
 * every non-superadmin principal (fail-closed, #2107), so a partial-null row
 * is dead data that can only ever leak through a future code path that skips
 * the access check. Guarding creation keeps that class of fail-open bug from
 * re-emerging (#2109). Call this before persisting any `Attachment`.
 */
export function assertAttachmentScopeInvariant(scope: AttachmentScope): void {
  const tenantId = normalizeScopeValue(scope.tenantId)
  const organizationId = normalizeScopeValue(scope.organizationId)
  const tenantSet = tenantId !== null
  const organizationSet = organizationId !== null
  if (tenantSet !== organizationSet) {
    const missing = tenantSet ? 'organization_id' : 'tenant_id'
    throw new Error(
      `[internal] Attachment scope invariant violated: ${missing} is null while the other scope column is set. ` +
        'Attachments must be either fully scoped (both tenant_id and organization_id) or fully global (both null).',
    )
  }
}

export function isSuperAdminAuth(auth: AuthContext | null | undefined): boolean {
  if (!auth) return false
  if ((auth as any).isSuperAdmin === true) return true
  const roles = Array.isArray(auth.roles) ? auth.roles : []
  return roles.some((role) => typeof role === 'string' && role.trim().toLowerCase() === 'superadmin')
}

function isSameScope(auth: AuthContext | null | undefined, attachment: Attachment): boolean {
  if (!auth) return false
  const attachmentTenant = attachment.tenantId ?? null
  const attachmentOrg = attachment.organizationId ?? null
  // Preserve the legacy "global attachment" semantics: a row with both scope
  // columns null is treated as accessible to any authenticated principal.
  // The unauthenticated branch in checkAttachmentAccess already gates this on
  // partition.isPublic.
  if (attachmentTenant === null && attachmentOrg === null) {
    return true
  }
  // Fail-closed on partial-null scope. Previously a missing tenant_id or
  // organization_id was treated as "matches any auth value", which allowed
  // cross-tenant / cross-org access on private partitions when an attachment
  // ended up with one scope column unset. Mirrors the fail-closed pattern
  // from #2012 (mergeIdFilter).
  return attachmentTenant === auth.tenantId && attachmentOrg === auth.orgId
}

export function checkAttachmentAccess(
  auth: AuthContext | null | undefined,
  attachment: Attachment,
  partition: AttachmentPartition,
  options?: { requireAuthForPublic?: boolean }
): { ok: true } | { ok: false; status: number } {
  const superAdmin = isSuperAdminAuth(auth)
  const requireAuth = !partition.isPublic || options?.requireAuthForPublic === true

  if (requireAuth) {
    if (!auth) {
      return { ok: false, status: 401 }
    }
    if (superAdmin || isSameScope(auth, attachment)) {
      return { ok: true }
    }
    return { ok: false, status: 403 }
  }

  if (!auth) {
    const isTenantScoped = !!attachment.tenantId || !!attachment.organizationId
    if (isTenantScoped) {
      return { ok: false, status: 401 }
    }
    return { ok: true }
  }

  if (!superAdmin && !isSameScope(auth, attachment)) {
    return { ok: false, status: 403 }
  }
  return { ok: true }
}
