import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  getCustomerAuthFromRequest,
  requireCustomerFeature,
  type CustomerAuthContext,
} from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import type { CustomerPurchaseApprovalService } from '../services/customerPurchaseApprovalService'
import type { PortalApprovalPrincipal } from './portalApprovalAccess'

// Release 5 Phase 4 (Step 2.6, G5). Portal auth/scope resolution shared by every
// `/api/customer_groups/portal/approvals*` route, mirroring
// `workflows/api/portal/tasks/route.ts`'s direct (static) import of the
// `customer_accounts` auth helpers — both are `packages/core` modules, not an
// extractable-to-its-own-package module like `staff`, so a static import (rather
// than `staff/api/portal/time-reports/route.ts`'s dynamic one) is the established
// convention here.
export type PortalApprovalContext = {
  auth: CustomerAuthContext
  principal: PortalApprovalPrincipal
  em: EntityManager
  approvalService: CustomerPurchaseApprovalService
  container: AppContainer
}

const PORTAL_VIEW_FEATURE = 'customer_groups.portal.approvals.view'
const PORTAL_DECIDE_FEATURE = 'customer_groups.portal.approvals.decide'

export async function resolvePortalApprovalContext(
  req: Request,
  requiredFeature: typeof PORTAL_VIEW_FEATURE | typeof PORTAL_DECIDE_FEATURE,
): Promise<PortalApprovalContext | Response> {
  const { translate } = await resolveTranslations()
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: translate('customer_groups.errors.unauthorized', 'Unauthorized') },
      { status: 401 },
    )
  }
  if (!auth.customerEntityId) {
    return NextResponse.json(
      { ok: false, error: translate('customer_groups.errors.noCompanyAssociation', 'No company association') },
      { status: 403 },
    )
  }

  const container = await createRequestContainer()
  const rbac = container.resolve('customerRbacService') as CustomerRbacService
  try {
    await requireCustomerFeature(auth, [requiredFeature], rbac)
  } catch (response) {
    return response as Response
  }

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const canDecide = await rbac.userHasAllFeatures(auth.sub, [PORTAL_DECIDE_FEATURE], scope)
  const em = (container.resolve('em') as EntityManager).fork()
  const approvalService = container.resolve('customerPurchaseApprovalService') as CustomerPurchaseApprovalService

  return {
    auth,
    principal: {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      customerEntityId: auth.customerEntityId,
      customerUserId: auth.sub,
      canDecide,
    },
    em,
    approvalService,
    container,
  }
}
