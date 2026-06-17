import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { OptimisticLockCurrentReader } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { registerOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { DefaultSalesCalculationService } from './services/salesCalculationService'
import { DefaultTaxCalculationService } from './services/taxCalculationService'
import { SalesDocumentNumberGenerator } from './services/salesDocumentNumberGenerator'
import {
  SalesOrder,
  SalesOrderLine,
  SalesOrderAdjustment,
  SalesQuote,
  SalesQuoteLine,
  SalesQuoteAdjustment,
  SalesChannel,
  SalesShipment,
  SalesShipmentItem,
  SalesInvoice,
  SalesInvoiceLine,
  SalesCreditMemo,
  SalesCreditMemoLine,
  SalesPayment,
  SalesPaymentAllocation,
  SalesReturn,
  SalesReturnLine,
  SalesNote,
  SalesDocumentAddress,
  SalesDocumentTag,
  SalesDocumentTagAssignment,
  SalesShippingMethod,
  SalesDeliveryWindow,
  SalesPaymentMethod,
  SalesTaxRate,
} from './data/entities'

type AppCradle = AppContainer['cradle'] & {
  em: EntityManager
  eventBus?: EventBus | null
}

const RESOURCE_KIND_ORDER = 'sales.order'
const RESOURCE_KIND_PAYMENT = 'sales.payment'
const RESOURCE_KIND_SHIPMENT = 'sales.shipment'

async function readOrderUpdatedAtById(
  em: EntityManager,
  orderId: string | null | undefined,
  tenantId: string | null | undefined,
  organizationId: string | null | undefined,
): Promise<string | null> {
  if (!orderId) return null
  const row = await em.findOne(
    SalesOrder,
    {
      id: orderId,
      ...(tenantId ? { tenantId } : {}),
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const },
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

const readSalesOrderUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId },
) => readOrderUpdatedAtById(em, resourceId, tenantId, organizationId)

// Payments and shipments are guarded against the PARENT ORDER's aggregate
// version (their mutations recalc order totals / fulfilled quantities, so the
// order is the consistency boundary — same model as lines/adjustments/returns).
// The CRUD-layer guard therefore must compare against the order, not the
// payment/shipment row: resolve the parent order from the sub-resource id and
// return its `updated_at`. This keeps the single optimistic-lock header
// consistent across the makeCrudRoute guard and the command-level
// `enforceSalesDocumentOptimisticLock` guard (both read the order version).
const readPaymentParentOrderUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId },
) => {
  const payment = await em.findOne(
    SalesPayment,
    {
      id: resourceId,
      ...(tenantId ? { tenantId } : {}),
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['order'] as const },
  )
  const orderId = (payment as { order?: { id?: string } | string | null } | null)?.order
  const resolvedOrderId = typeof orderId === 'string' ? orderId : orderId?.id ?? null
  return readOrderUpdatedAtById(em, resolvedOrderId, tenantId, organizationId)
}

const readShipmentParentOrderUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId },
) => {
  const shipment = await em.findOne(
    SalesShipment,
    {
      id: resourceId,
      ...(tenantId ? { tenantId } : {}),
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['order'] as const },
  )
  const orderId = (shipment as { order?: { id?: string } | string | null } | null)?.order
  const resolvedOrderId = typeof orderId === 'string' ? orderId : orderId?.id ?? null
  return readOrderUpdatedAtById(em, resolvedOrderId, tenantId, organizationId)
}

// Hand-wired sales readers registered at module-load time. `sales.order` mirrors
// the auto-registered generic reader (kept as the polymorphic-table override
// reference). `sales.payment`/`sales.shipment` redirect the CRUD-layer guard to
// the parent order so payments/shipments guard the aggregate (Phase 3 Gap A/B)
// instead of their own row. The guard's mode check short-circuits when
// `OM_OPTIMISTIC_LOCK=off`.
registerOptimisticLockReaders({
  [RESOURCE_KIND_ORDER]: readSalesOrderUpdatedAt,
  [RESOURCE_KIND_PAYMENT]: readPaymentParentOrderUpdatedAt,
  [RESOURCE_KIND_SHIPMENT]: readShipmentParentOrderUpdatedAt,
})

export function register(container: AppContainer) {
  container.register({
    salesCalculationService: asFunction(({ eventBus }: AppCradle) => {
      return new DefaultSalesCalculationService(eventBus ?? null)
    })
      .singleton()
      .proxy(),
    taxCalculationService: asFunction(({ em, eventBus }: AppCradle) => {
      return new DefaultTaxCalculationService(em, eventBus ?? null)
    })
      .singleton()
      .proxy(),
    salesDocumentNumberGenerator: asFunction(({ em }: AppCradle) => {
      return new SalesDocumentNumberGenerator(em)
    })
      .singleton()
      .proxy(),
    SalesOrder: asValue(SalesOrder),
    SalesOrderLine: asValue(SalesOrderLine),
    SalesOrderAdjustment: asValue(SalesOrderAdjustment),
    SalesQuote: asValue(SalesQuote),
    SalesQuoteLine: asValue(SalesQuoteLine),
    SalesQuoteAdjustment: asValue(SalesQuoteAdjustment),
    SalesChannel: asValue(SalesChannel),
    SalesShipment: asValue(SalesShipment),
    SalesShipmentItem: asValue(SalesShipmentItem),
    SalesInvoice: asValue(SalesInvoice),
    SalesInvoiceLine: asValue(SalesInvoiceLine),
    SalesCreditMemo: asValue(SalesCreditMemo),
    SalesCreditMemoLine: asValue(SalesCreditMemoLine),
    SalesPayment: asValue(SalesPayment),
    SalesPaymentAllocation: asValue(SalesPaymentAllocation),
    SalesReturn: asValue(SalesReturn),
    SalesReturnLine: asValue(SalesReturnLine),
    SalesNote: asValue(SalesNote),
    SalesDocumentAddress: asValue(SalesDocumentAddress),
    SalesDocumentTag: asValue(SalesDocumentTag),
    SalesDocumentTagAssignment: asValue(SalesDocumentTagAssignment),
    SalesShippingMethod: asValue(SalesShippingMethod),
    SalesDeliveryWindow: asValue(SalesDeliveryWindow),
    SalesPaymentMethod: asValue(SalesPaymentMethod),
    SalesTaxRate: asValue(SalesTaxRate),
  })

  // `crudMutationGuardService` is registered platform-wide in the shared
  // DI bootstrap (`packages/shared/src/lib/di/container.ts`). The
  // hand-wired sales.order reader above already lives in the global store,
  // so this module no longer needs its own DI binding.
}
