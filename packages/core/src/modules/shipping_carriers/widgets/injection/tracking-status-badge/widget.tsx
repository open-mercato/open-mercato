import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'

const SHIPPING_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  label_created: 'bg-slate-100 text-slate-700',
  picked_up: 'bg-sky-100 text-sky-700',
  in_transit: 'bg-blue-100 text-blue-700',
  out_for_delivery: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-green-100 text-green-700',
  returned: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
  failed_delivery: 'bg-orange-100 text-orange-700',
}

function formatShippingStatusLabel(value: string): string {
  return value.replace(/_/g, ' ')
}

const widget: InjectionColumnWidget = {
  metadata: {
    id: 'shipping_carriers.injection.tracking-status-badge',
    priority: 45,
  },
  columns: [
    {
      id: 'carrier_status_badge',
      header: 'shipping_carriers.column.shippingStatus',
      accessorKey: '_carrier.status',
      sortable: false,
      cell: ({ getValue }) => {
        const value = getValue()
        if (typeof value !== 'string' || value.length === 0) return null
        const colors = SHIPPING_STATUS_COLORS[value] ?? 'bg-gray-100 text-gray-700'
        return (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}>
            {formatShippingStatusLabel(value)}
          </span>
        )
      },
    },
  ],
}

export default widget
