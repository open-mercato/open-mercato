import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { OptimisticLockCurrentReader } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { registerOptimisticLockReaders } from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import { DefaultSalesCalculationService } from './services/salesCalculationService'
import { DefaultTaxCalculationService } from './services/taxCalculationService'
import { SalesDocumentNumberGenerator } from './services/salesDocumentNumberGenerator'
import { DefaultSalesOrderService } from './services/salesOrderService'
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

const readSalesOrderUpdatedAt: OptimisticLockCurrentReader = async (
  em: EntityManager,
  { resourceId, tenantId, organizationId },
) => {
  const row = await em.findOne(
    SalesOrder,
    {
      id: resourceId,
      tenantId,
      ...(organizationId ? { organizationId } : {}),
      deletedAt: null,
    },
    { fields: ['updatedAt'] as const },
  )
  return row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : null
}

// Hand-wired sales.order reader registered at module-load time so the
// `customer_entities`-style polymorphic-table override pattern stays
// observable for downstream modules. Functionally identical to the
// auto-registered generic reader; kept here as a reference example. The
// guard's mode check short-circuits when `OM_OPTIMISTIC_LOCK=off`.
registerOptimisticLockReaders({
  [RESOURCE_KIND_ORDER]: readSalesOrderUpdatedAt,
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
    salesOrderService: asFunction(({ em }: AppCradle) => {
      return new DefaultSalesOrderService(em)
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
