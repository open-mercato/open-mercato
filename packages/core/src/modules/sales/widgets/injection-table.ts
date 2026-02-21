import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'sales.injection.document-history',
      kind: 'tab',
      groupLabel: 'sales.documents.history.tabLabel',
      priority: 50,
    },
  ],
  'sales.document.detail.quote:tabs': [
    {
      widgetId: 'sales.injection.document-history',
      kind: 'tab',
      groupLabel: 'sales.documents.history.tabLabel',
      priority: 50,
    },
  ],
}

export default injectionTable
