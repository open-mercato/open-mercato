import { templateRegistry } from '../lib/template-registry'
import { QuotesDocumentService, QUOTES_TEMPLATE_IDS } from '../services/quotes-document-service'
import { OrdersDocumentService, ORDERS_TEMPLATE_IDS } from '../services/orders-document-service'

const quotesService = new QuotesDocumentService()
const ordersService = new OrdersDocumentService()

templateRegistry.registerInternal([
  ...quotesService.getEntries(),
  ...ordersService.getEntries(),
])

/** Built-in template IDs — for TemplateId type derivation only, not for runtime use. */
export const REGISTRY = [...QUOTES_TEMPLATE_IDS, ...ORDERS_TEMPLATE_IDS] as const
