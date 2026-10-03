import type { TemplateEntry } from '@open-mercato/shared/modules/document-generators'
import { InvoicesDocumentService } from './document-generators/services/invoices-document-service'

export const templates: TemplateEntry[] = [...new InvoicesDocumentService().getEntries()]
