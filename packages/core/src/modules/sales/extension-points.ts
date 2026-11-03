import { dataTableExtensionHost, defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'sales',
  hosts: {
    ordersTable: dataTableExtensionHost({ tableId: 'sales.orders', source: 'components/documents/SalesDocumentsTable.tsx' }),
    quotesTable: dataTableExtensionHost({ tableId: 'sales.quotes', source: 'components/documents/SalesDocumentsTable.tsx' }),
    paymentsTable: dataTableExtensionHost({ tableId: 'sales.payments', source: 'components/documents/PaymentsSection.tsx' }),
    orderItemColumns: injectionExtensionHost({
      family: 'detail',
      spotId: 'data-table:sales.order.items:columns',
      supported: ['column-widget'],
      source: 'components/documents/ItemsSection.tsx',
    }),
    orderShipping: injectionExtensionHost({
      family: 'detail',
      spotId: 'detail:sales.order:shipping',
      supported: ['render-widget'],
      source: 'backend/sales/documents/[id]/page.tsx',
    }),
    documentStageBar: injectionExtensionHost({
      family: 'detail',
      pattern: 'detail:sales.{kind}:stage-bar',
      parameters: {
        kind: { source: 'SalesDocumentExtensionContext.kind', pattern: '^(order|quote)$' },
      },
      supported: ['render-widget'],
      source: ['components/documents/SalesDocumentExtensionSpot.tsx', 'backend/sales/documents/[id]/page.tsx'],
      contextContract: 'SalesDocumentExtensionContext: kind, documentId, record, formId, resourceKind, resourceId, retryLastMutation, organizationId, tenantId',
      dataContract: 'Current sales order or quote record; onDataChange updates the in-page record only',
      scopeContract: 'organizationId and tenantId from the loaded, server-scoped document; widget writes must enforce their own authorization',
      runtimeContract: 'Rendered below the document header; no native stage transition or mutation lifecycle is added',
    }),
    documentClosure: injectionExtensionHost({
      family: 'detail',
      pattern: 'detail:sales.{kind}:closure',
      parameters: {
        kind: { source: 'SalesDocumentExtensionContext.kind', pattern: '^(order|quote)$' },
      },
      supported: ['render-widget'],
      source: ['components/documents/SalesDocumentExtensionSpot.tsx', 'backend/sales/documents/[id]/page.tsx'],
      contextContract: 'SalesDocumentExtensionContext: kind, documentId, record, formId, resourceKind, resourceId, retryLastMutation, organizationId, tenantId',
      dataContract: 'Current sales order or quote record; onDataChange updates the in-page record only',
      scopeContract: 'organizationId and tenantId from the loaded, server-scoped document; widget writes must enforce their own authorization',
      runtimeContract: 'Rendered below document details for closure extensions; no native closure dialog or mutation lifecycle is added',
    }),
    documentDetail: injectionExtensionHost({
      family: 'detail',
      pattern: 'sales.document.detail.{kind}:{surface}',
      parameters: {
        kind: { source: 'SalesDocumentKind', pattern: '^(order|quote)$' },
        surface: { source: 'host declaration', pattern: '^(tabs|details)$' },
      },
      supported: ['render-widget'],
      source: 'backend/sales/documents/[id]/page.tsx',
    }),
  },
})

export default extensionPoints
