import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'sales.injection.payment-gateway-status-column',
    priority: 50,
    features: ['payment_gateways.view'],
    // The header key and every value this column can ever show come from
    // `payment_gateways`; without that module the column has no data source and
    // its header would degrade to the raw translation key.
    requiredModules: ['payment_gateways'],
  },
  columns: [
    {
      id: 'gateway_status',
      header: 'payment_gateways.column.gatewayStatus',
      accessorKey: '_gateway.unifiedStatus',
      size: 120,
      sortable: false,
      placement: { position: InjectionPosition.After, relativeTo: 'status' },
      cell: ({ getValue }) => {
        const value = getValue()
        return typeof value === 'string' && value.trim().length > 0 ? value : '—'
      },
    },
  ],
}

export default widget
