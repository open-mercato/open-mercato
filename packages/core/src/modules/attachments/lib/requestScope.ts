import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

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
export async function resolveAttachmentOrganizationId(
  container: AwilixContainer,
  auth: AuthContext,
  request: Request,
): Promise<string | null> {
  if (!auth) return null
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  return scope?.selectedId ?? auth.orgId ?? null
}
