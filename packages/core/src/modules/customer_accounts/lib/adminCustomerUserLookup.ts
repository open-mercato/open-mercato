import { NextResponse } from 'next/server'
import type { AwilixContainer } from 'awilix'
import type { FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'

export type AdminScopedCustomerUserLookup =
  | { ok: true; user: CustomerUser }
  | { ok: false; response: NextResponse }

/**
 * Loads a customer user for a staff-initiated read or write, scoped exactly like the
 * admin users list: the caller's tenant plus the organizations the organization
 * switcher grants for this request (the selected organization and its descendants,
 * or every accessible organization under "All organizations").
 *
 * A user outside that scope answers 404, so routes do not reveal organizations the
 * caller cannot access. When the user belongs to an organization other than the
 * caller's home organization, `requiredFeatures` are re-checked against the user's
 * own organization and a missing grant answers 403 — the same cross-organization
 * rule `POST /admin/users` and `GET /admin/roles` apply.
 *
 * Pass `mutation: true` from write routes: when the organization switcher selection
 * was rejected by the resolver, the write answers 403 before any record lookup instead
 * of silently running within the resolver fallback scope. Reads keep the fallback.
 */
export async function findAdminScopedCustomerUser({
  container,
  auth,
  request,
  em,
  userId,
  requiredFeatures,
  mutation = false,
}: {
  container: AwilixContainer
  auth: NonNullable<AuthContext>
  request: Request
  em: EntityManager
  userId: string
  requiredFeatures: string[]
  mutation?: boolean
}): Promise<AdminScopedCustomerUserLookup> {
  const notFound = (): AdminScopedCustomerUserLookup => ({
    ok: false,
    response: NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 }),
  })
  if (!auth.tenantId) return notFound()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  if (mutation && organizationScope.selectionRejected) {
    const { translate } = await resolveTranslations()
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: translate(
            'customer_accounts.admin.errors.organizationSelectionRejected',
            'The selected organization is not available. Select an organization and try again.',
          ),
        },
        { status: 403 },
      ),
    }
  }
  const where: FilterQuery<CustomerUser> = {
    id: userId,
    tenantId: auth.tenantId,
    deletedAt: null,
  }
  if (Array.isArray(organizationScope.filterIds)) {
    if (organizationScope.filterIds.length === 0) return notFound()
    where.organizationId = { $in: organizationScope.filterIds }
  }
  const user = await findOneWithDecryption(
    em,
    CustomerUser,
    where,
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )
  if (!user) return notFound()

  if (user.organizationId !== auth.orgId) {
    const rbacService = container.resolve('rbacService') as RbacService
    const hasTargetAccess = await rbacService.userHasAllFeatures(auth.sub, requiredFeatures, {
      tenantId: user.tenantId,
      organizationId: user.organizationId,
    })
    if (!hasTargetAccess) {
      const { translate } = await resolveTranslations()
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: translate('customer_accounts.admin.errors.insufficientPermissions', 'Insufficient permissions') },
          { status: 403 },
        ),
      }
    }
  }

  return { ok: true, user }
}
