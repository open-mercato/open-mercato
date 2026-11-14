import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'

/**
 * Loads a customer user for a staff-initiated read or write, scoped exactly like the
 * admin users list: the caller's tenant plus the organizations the organization
 * switcher grants for this request (the selected organization and its descendants,
 * or every accessible organization under "All organizations").
 *
 * A user outside that scope resolves to `null`, so routes keep answering 404 for
 * organizations the caller cannot access.
 */
export async function findAdminScopedCustomerUser({
  container,
  auth,
  request,
  em,
  userId,
}: {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  request: Request
  em: EntityManager
  userId: string
}): Promise<CustomerUser | null> {
  if (!auth.tenantId) return null
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const where: Record<string, unknown> = {
    id: userId,
    tenantId: auth.tenantId,
    deletedAt: null,
  }
  if (Array.isArray(organizationScope.filterIds)) {
    if (organizationScope.filterIds.length === 0) return null
    where.organizationId = { $in: organizationScope.filterIds }
  }
  return findOneWithDecryption(
    em,
    CustomerUser,
    where as any,
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )
}
