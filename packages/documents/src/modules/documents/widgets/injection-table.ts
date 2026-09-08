import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

const relatedDocuments = {
  widgetId: 'documents.injection.related-documents',
  kind: 'stack' as const,
  priority: 80,
}

export const injectionTable: ModuleInjectionTable = {
  'detail:customers.person:footer': [relatedDocuments],
  'customers.person.detail:details': [relatedDocuments],
  'detail:customers.company:footer': [relatedDocuments],
  'customers.company.detail:details': [relatedDocuments],
  'detail:customers.deal:footer': [relatedDocuments],
  'sales.document.detail.quote:details': [relatedDocuments],
  'sales.document.detail.order:details': [relatedDocuments],
  'crud-form:catalog.product': [relatedDocuments],
}

export default injectionTable
