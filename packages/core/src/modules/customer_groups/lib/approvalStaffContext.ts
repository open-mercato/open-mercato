import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CustomerPurchaseApprovalService } from '../services/customerPurchaseApprovalService'
import { organizationIdsFromScope } from './customerScope'

type Translate = (key: string, fallback?: string) => string

export type StaffApprovalContext = {
  userId: string
  tenantId: string
  organizationIds: string[] | null
  em: EntityManager
  approvalService: CustomerPurchaseApprovalService
  container: AppContainer
}

// Release 5 Phase 4 (Step 2.6, §9): the same organization-scope resolution the
// sibling staff credit routes use (`credit-accounts/[id]/adjust`, `/ledger`) — an
// approval outside the caller's organization scope is refused with the unknown-id
// body, never a 403 that would confirm the id exists in another organization.
export async function resolveStaffApprovalScope(req: Request, translate: Translate): Promise<StaffApprovalContext> {
  const auth = await getAuthFromRequest(req)
  if (!auth) throw new CrudHttpError(401, { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') })
  const tenantId = auth.tenantId ?? null
  if (!tenantId) {
    throw new CrudHttpError(400, { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req }).catch(() => null)
  const organizationIds = organizationIdsFromScope(scope, scope?.selectedId ?? auth.orgId ?? null)

  const em = (container.resolve('em') as EntityManager).fork()
  const approvalService = container.resolve('customerPurchaseApprovalService') as CustomerPurchaseApprovalService

  return { userId: auth.sub, tenantId, organizationIds, em, approvalService, container }
}
