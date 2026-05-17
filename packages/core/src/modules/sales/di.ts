import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { EventBus } from '@open-mercato/events'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultSalesCalculationService } from './services/salesCalculationService'
import { DefaultTaxCalculationService } from './services/taxCalculationService'
import { SalesDocumentNumberGenerator } from './services/salesDocumentNumberGenerator'
import {
  SalesOrder,
  SalesQuote,
  SalesChannel,
  SalesShipment,
  SalesInvoice,
  SalesCreditMemo,
  SalesPayment,
  SalesReturn,
  SalesOrderLine,
  SalesQuoteLine,
  SalesNote,
  SalesDocumentAddress,
  SalesDocumentTag,
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
    SalesQuote: asValue(SalesQuote),
    SalesChannel: asValue(SalesChannel),
    SalesShipment: asValue(SalesShipment),
    SalesInvoice: asValue(SalesInvoice),
    SalesCreditMemo: asValue(SalesCreditMemo),
    SalesPayment: asValue(SalesPayment),
    SalesReturn: asValue(SalesReturn),
    SalesOrderLine: asValue(SalesOrderLine),
    SalesQuoteLine: asValue(SalesQuoteLine),
    SalesNote: asValue(SalesNote),
    SalesDocumentAddress: asValue(SalesDocumentAddress),
    SalesDocumentTag: asValue(SalesDocumentTag),
    SalesShippingMethod: asValue(SalesShippingMethod),
    SalesDeliveryWindow: asValue(SalesDeliveryWindow),
    SalesPaymentMethod: asValue(SalesPaymentMethod),
    SalesTaxRate: asValue(SalesTaxRate),
  })
}
