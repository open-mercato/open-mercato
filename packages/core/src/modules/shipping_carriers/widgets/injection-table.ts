import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'data-table:sales.shipments:columns': [
    {
      widgetId: 'shipping_carriers.injection.tracking-column',
      priority: 40,
    },
    {
      widgetId: 'shipping_carriers.injection.tracking-status-badge',
      priority: 45,
    },
  ],
  'data-table:sales.orders:row-actions': [
    {
      widgetId: 'shipping_carriers.injection.create-shipment-button',
      priority: 30,
    },
  ],
}

export default injectionTable
