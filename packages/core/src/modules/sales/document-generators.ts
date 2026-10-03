import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { QuotesDocumentService } from './document-generators/services/quotes-document-service'

export const templates: TemplateEntry[] = [
  ...new QuotesDocumentService().getEntries(),
]
