import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'invoices.document.detail:tabs': [
    {
      widgetId: 'invoices.injection.document-generators-invoice-tab',
      kind: 'tab',
      groupLabel: 'invoices.documents.generators.tabLabel',
      priority: 40,
    },
  ],
}

export default injectionTable
