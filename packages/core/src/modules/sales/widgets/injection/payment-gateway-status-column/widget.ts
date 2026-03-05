import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'sales.injection.payment-gateway-status-column',
    priority: 50,
  },
  columns: [
    {
      id: 'gateway_status',
      header: 'payment_gateways.column.gatewayStatus',
      accessorKey: '_gateway.unifiedStatus',
      sortable: false,
      cell: ({ getValue }) => {
        const value = getValue()
        return typeof value === 'string' && value.trim().length > 0 ? value : 'pending'
      },
    },
  ],
}

export default widget
