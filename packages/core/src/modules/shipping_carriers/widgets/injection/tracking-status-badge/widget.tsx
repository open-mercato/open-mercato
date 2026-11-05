import * as React from 'react'
import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import ShippingStatusBadgeWidget from './widget.client'

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
        return React.createElement(ShippingStatusBadgeWidget, { status: value })
      },
    },
  ],
}

export default widget
