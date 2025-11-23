import type { AuthContext } from '@/lib/auth/server'
import type { Attachment, AttachmentPartition } from '../data/entities'

export function isSuperAdminAuth(auth: AuthContext | null | undefined): boolean {
  if (!auth) return false
  if ((auth as any).isSuperAdmin === true) return true
  const roles = Array.isArray(auth.roles) ? auth.roles : []
  return roles.some((role) => typeof role === 'string' && role.trim().toLowerCase() === 'superadmin')
}

function isSameScope(auth: AuthContext | null | undefined, attachment: Attachment): boolean {
  if (!auth) return false
  const sameTenant = attachment.tenantId ? attachment.tenantId === auth.tenantId : true
  const sameOrg = attachment.organizationId ? attachment.organizationId === auth.orgId : true
  return sameTenant && sameOrg
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

  if (auth && !superAdmin && !isSameScope(auth, attachment)) {
    return { ok: false, status: 403 }
  }
  return { ok: true }
}
