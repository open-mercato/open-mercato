import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'shipping_carriers.injection.tracking-column',
    priority: 40,
  },
  columns: [
    {
      id: 'carrier_tracking_status',
      header: 'shipping_carriers.column.trackingStatus',
      accessorKey: '_carrier.status',
      sortable: false,
      cell: ({ getValue }) => {
        const value = getValue()
        return typeof value === 'string' && value.length > 0 ? value : 'unknown'
      },
    },
  ],
}

export default widget
