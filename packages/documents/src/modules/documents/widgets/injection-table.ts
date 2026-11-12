import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

const relatedDocuments = {
  widgetId: 'documents.injection.related-documents',
  kind: 'stack' as const,
  priority: 80,
}

// The three CRM detail pages (people-v2, companies-v2, deals) mount the panel
// as a tab of their related-content workspace (#7488). Their tab loaders
// ignore `kind: 'stack'`, hence a separate descriptor; the legacy CRM, sales
// and catalog hosts keep the inline stack below.
const relatedDocumentsTab = {
  widgetId: 'documents.injection.related-documents',
  kind: 'tab' as const,
  groupId: 'related-documents',
  groupLabel: 'documents.relatedDocuments.title',
  icon: 'file-text',
  // Negative: after the host's built-in tabs (#8020 ordering contract).
  priority: -20,
}

export const injectionTable: ModuleInjectionTable = {
  'detail:customers.person:tabs': [relatedDocumentsTab],
  'customers.person.detail:details': [relatedDocuments],
  'detail:customers.company:tabs': [relatedDocumentsTab],
  'customers.company.detail:details': [relatedDocuments],
  'detail:customers.deal:tabs': [relatedDocumentsTab],
  'sales.document.detail.quote:details': [relatedDocuments],
  'sales.document.detail.order:details': [relatedDocuments],
  'crud-form:catalog.product': [relatedDocuments],
}

export default injectionTable
