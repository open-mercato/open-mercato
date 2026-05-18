import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
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
}
