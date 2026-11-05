import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isExplicitlyEmptyOrganizationScope } from '@open-mercato/shared/lib/auth/organizationScope'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'

export type AttachmentRequestScope = {
  /**
   * The caller's organization scope resolved to an explicitly empty set, so they can
   * reach no attachment at all. Routes MUST answer with their own not-found response:
   * widening back to `auth.orgId` would reopen the fail-open hole, and letting the
   * resolver throw turns the deny into an unhandled 500 (the file/image routes have no
   * `CrudHttpError` handler of their own).
   */
  denied: boolean
  organizationId: string | null
}

/**
 * Resolve the organization an attachment request should act within.
 *
 * `auth.orgId` alone is NOT selected-organization aware for non-superadmin
 * principals: `applySuperAdminScope` only rewrites `orgId` from the
 * `om_selected_org` cookie for superadmins, so a regular multi-org admin who
 * switches the header organization keeps `auth.orgId` pinned to their own home
 * organization. The CRUD factory and other org-scoped routes derive the active
 * organization via `resolveOrganizationScopeForRequest` (cookie-driven and
 * RBAC-validated for ALL users, falling back to the home org when the selection
 * is absent or inaccessible). Attachments must do the same so uploaded files
 * land under — and are read back from — the currently selected organization
 * rather than the uploader's home organization (#3765).
 */
export async function resolveAttachmentRequestScope(
  container: AwilixContainer,
  auth: AuthContext,
  request: Request,
): Promise<AttachmentRequestScope> {
  if (!auth) return { denied: false, organizationId: null }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  if (isExplicitlyEmptyOrganizationScope(scope)) return { denied: true, organizationId: null }
  return { denied: false, organizationId: scope?.selectedId ?? auth.orgId ?? null }
}

/**
 * @deprecated Use {@link resolveAttachmentRequestScope}, which reports a denied
 * scope instead of throwing so each route can answer with its own status. Kept
 * for third-party callers; it fails closed on a denied scope rather than
 * returning `null`, because every in-repo consumer reads `null` as "no
 * organization filter" — i.e. the whole tenant.
 */
export async function resolveAttachmentOrganizationId(
  container: AwilixContainer,
  auth: AuthContext,
  request: Request,
): Promise<string | null> {
  const scope = await resolveAttachmentRequestScope(container, auth, request)
  if (scope.denied) throw forbidden()
  return scope.organizationId
}
