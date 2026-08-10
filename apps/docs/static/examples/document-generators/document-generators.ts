import { ExampleInvoicesDocumentService } from './invoice/services/example-invoice-document-service'

// Convention file — picked up by `mercato generate registry` to register external PDF templates.
// Place this file at the root of your module (sibling of acl.ts, setup.ts, index.ts).
const service = new ExampleInvoicesDocumentService()

export const templates = service.getEntries()
export default templates
