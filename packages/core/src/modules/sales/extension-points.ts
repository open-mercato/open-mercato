import { dataTableExtensionHost, defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'sales',
  hosts: {
    ordersTable: dataTableExtensionHost({ tableId: 'sales.orders', source: 'components/documents/SalesDocumentsTable.tsx' }),
    quotesTable: dataTableExtensionHost({ tableId: 'sales.quotes', source: 'components/documents/SalesDocumentsTable.tsx' }),
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
