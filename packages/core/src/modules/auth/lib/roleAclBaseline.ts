import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { normalizeRoleAclSnapshot, sameRoleAcl, type RoleAclSnapshot } from './roleAclFingerprint'

/** The role ACL as the editor loaded it, with the tenant it was loaded for (`null` = the role's own). */
export type RoleAclBaseline = RoleAclSnapshot & { tenantId: string | null }

type RoleAclReadResponse = {
  isSuperAdmin?: unknown
  features?: unknown
  organizations?: unknown
}

/** A best-effort read: a 403 means "not available here", never the global access-denied banner. */
const OPTIONAL_READ_HEADERS = { 'x-om-forbidden-redirect': '0' }

/**
 * Before writing a role ACL that has no `updatedAt` to lock on (spec S15), reads it again and
 * compares its access-deciding content with what the editor loaded: a different ACL means someone
 * else changed it, so the write is refused (`aclChanged`). A read the server refuses (401/403/404)
 * leaves the decision to the write itself; any other failed read refuses the write
 * (`aclVerifyFailed`). Nothing is compared when the ACL is saved for another tenant than it was
 * loaded for.
 */
export async function assertRoleAclUnchanged(input: {
  roleId: string
  tenantId: string | null
  roleTenantId: string | null
  baseline: RoleAclBaseline | null
  t: TranslateFn
}): Promise<void> {
  const { baseline } = input
  if (!baseline) return
  const baselineTenantId = baseline.tenantId ?? input.roleTenantId
  if (baselineTenantId !== (input.tenantId ?? input.roleTenantId)) return
  const query = new URLSearchParams({ roleId: input.roleId })
  if (input.tenantId) query.set('tenantId', input.tenantId)
  const current = await apiCall<RoleAclReadResponse>(`/api/auth/roles/acl?${query.toString()}`, { headers: OPTIONAL_READ_HEADERS })
  if (current.ok && current.result) {
    if (!sameRoleAcl(normalizeRoleAclSnapshot(baseline), normalizeRoleAclSnapshot(current.result))) {
      throw createCrudFormError(input.t('auth.roles.form.errors.aclChanged', 'The permissions of this role were changed by someone else. Reload the page and apply your changes again.'))
    }
    return
  }
  if (current.status === 401 || current.status === 403 || current.status === 404) return
  throw createCrudFormError(input.t('auth.roles.form.errors.aclVerifyFailed', 'Could not verify the current permissions of this role. Try again.'))
}
