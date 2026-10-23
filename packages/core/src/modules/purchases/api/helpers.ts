import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '../../directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '../../directory/utils/organizationScopeFilter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { PurchaseOrderService } from '../services/purchaseOrderService'
import type { VendorPricelistService } from '../services/vendorPricelistService'
import type { PurchaseReceiptService } from '../services/purchaseReceiptService'
import type { ThreeWayMatchService } from '../services/threeWayMatchService'
import type { ReorderingEngine } from '../services/reorderingEngine'

export type PurchasesApiContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: EntityManager
  purchaseOrderService: PurchaseOrderService
  vendorPricelistService: VendorPricelistService
  purchaseReceiptService: PurchaseReceiptService
  threeWayMatchService: ThreeWayMatchService
  reorderingEngine: ReorderingEngine
  auth: NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export async function resolvePurchasesApiContext(req: Request): Promise<PurchasesApiContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('purchases.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  let organizationId = resolveSingleOrganizationIdOrDeny(scope, auth)

  const em = container.resolve<EntityManager>('em')

  if (!organizationId) {
    const orgs = await em.getConnection().execute<Array<{ id: string }>>(
      'SELECT id FROM organizations WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1',
      [auth.tenantId]
    )
    if (Array.isArray(orgs) && orgs.length > 0) {
      organizationId = orgs[0].id
    }
  }

  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('purchases.errors.organization_required', 'Organization scope is required'),
    })
  }

  const purchaseOrderService = container.resolve<PurchaseOrderService>('purchaseOrderService')
  const vendorPricelistService = container.resolve<VendorPricelistService>('vendorPricelistService')
  const purchaseReceiptService = container.resolve<PurchaseReceiptService>('purchaseReceiptService')
  const threeWayMatchService = container.resolve<ThreeWayMatchService>('threeWayMatchService')
  const reorderingEngine = container.resolve<ReorderingEngine>('reorderingEngine')

  return {
    container,
    em,
    purchaseOrderService,
    vendorPricelistService,
    purchaseReceiptService,
    threeWayMatchService,
    reorderingEngine,
    auth,
    tenantId: auth.tenantId,
    organizationId,
    translate,
  }
}

export function formatZodError(err: { issues: Array<{ path: unknown[]; message: string }> }): string {
  return err.issues.map((i) => `${i.path.map(String).join('.') || 'field'}: ${i.message}`).join('; ')
}

