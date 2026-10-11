import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

// Policy writes go through `makeCrudRoute`, which scopes them to the organization
// selected in the header (`ctx.selectedOrganizationId`). `getAuthFromRequest` applies
// that selection to `auth.orgId` for superadmins only, so the hand-written reads
// resolve it the same way the CRUD factory does; otherwise a user working in a second
// organization would write policies there and read them from the home organization.
export async function resolveAvailabilityOrganizationId(
  container: AwilixContainer,
  auth: AuthContext,
  request: Request,
): Promise<string | null> {
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request }).catch(() => null)
  return scope?.selectedId ?? resolveActiveOrganizationId(auth)
}
