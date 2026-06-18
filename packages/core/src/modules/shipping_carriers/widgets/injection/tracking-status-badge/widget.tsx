'use client'

import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import type { UnifiedShipmentStatus } from '../../../lib/adapter'

const SHIPMENT_STATUS_VARIANTS: StatusMap<UnifiedShipmentStatus> = {
  label_created: 'neutral',
  picked_up: 'info',
  in_transit: 'info',
  out_for_delivery: 'info',
  delivered: 'success',
  failed_delivery: 'error',
  returned: 'warning',
  cancelled: 'error',
  unknown: 'neutral',
}

function TrackingStatusBadgeCell({ status }: { status: string }) {
  const t = useT()
  const variant = SHIPMENT_STATUS_VARIANTS[status as UnifiedShipmentStatus] ?? 'neutral'
  return (
    <StatusBadge variant={variant} dot>
      {t(`shipping_carriers.status.${status}`, status)}
    </StatusBadge>
  )
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
        return <TrackingStatusBadgeCell status={value} />
      },
    },
  ],
}

export default widget
