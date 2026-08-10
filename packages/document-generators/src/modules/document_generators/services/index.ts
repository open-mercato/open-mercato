export { BaseDocumentService } from './base-document-service'
export type { DocumentTemplateEntry } from './types'
export { QuotesDocumentService, QUOTES_TEMPLATE_IDS } from './quotes-document-service'
export type { QuoteLineItem } from './quotes-document-service'
export { OrdersDocumentService, ORDERS_TEMPLATE_IDS } from './orders-document-service'
export type { OrderLineItem } from './orders-document-service'
export { GenerationHistoryService } from './generation-history-service'
export { PdfRenderingService } from './pdf-rendering-service'
export type {
  HistoryScope,
  CreateGeneratedDocumentInput,
  ListGeneratedDocumentsQuery,
  GeneratedDocumentDto,
} from './generation-history-service'
