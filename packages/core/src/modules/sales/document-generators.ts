import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { OrdersDocumentService } from './document-generators/services/orders-document-service'
import { QuotesDocumentService } from './document-generators/services/quotes-document-service'

const services = [new OrdersDocumentService(), new QuotesDocumentService()]

export const templates: TemplateEntry[] = services.flatMap((service) => service.getEntries())

export default templates
