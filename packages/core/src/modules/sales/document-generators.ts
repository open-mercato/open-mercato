import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { OrdersDocumentService } from './document-generators/services/orders-document-service'
import { QuotesDocumentService } from './document-generators/services/quotes-document-service'

export const templates: TemplateEntry[] = [
  ...new QuotesDocumentService().getEntries(),
  ...new OrdersDocumentService().getEntries(),
]
