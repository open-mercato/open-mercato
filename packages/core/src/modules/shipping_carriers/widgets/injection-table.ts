import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'data-table:sales.shipments:columns': {
    widgetId: 'shipping_carriers.injection.tracking-column',
    priority: 40,
  },
}

export default injectionTable
