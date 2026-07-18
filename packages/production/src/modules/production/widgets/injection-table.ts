import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Soft sales integration (spec § Sales integration): a "Production" tab
 * injected into the sales order detail's tab spot only (not the quote
 * spot — production orders only ever originate from placed orders).
 * Mirrors the shape of `sales.injection.document-history` at the same
 * spot (`packages/core/src/modules/sales/widgets/injection-table.ts`).
 */
export const injectionTable: ModuleInjectionTable = {
  'sales.document.detail.order:tabs': [
    {
      widgetId: 'production.injection.order-production-tab',
      kind: 'tab',
      groupLabel: 'production.injection.tab.label',
      priority: 60,
    },
  ],
}

export default injectionTable
