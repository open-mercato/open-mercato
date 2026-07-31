'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import type { UnifiedShipmentStatus } from '../../../lib/adapter'

type ShippingStatus = UnifiedShipmentStatus | 'pending'

const shippingStatusVariantMap: StatusMap<ShippingStatus> = {
  pending: 'neutral',
  label_created: 'info',
  picked_up: 'info',
  in_transit: 'info',
  out_for_delivery: 'info',
  delivered: 'success',
  failed_delivery: 'error',
  returned: 'warning',
  cancelled: 'error',
  unknown: 'neutral',
}

export type ShippingStatusBadgeWidgetProps = {
  status: string
}

export default function ShippingStatusBadgeWidget({ status }: ShippingStatusBadgeWidgetProps) {
  const t = useT()
  const variant = shippingStatusVariantMap[status as ShippingStatus] ?? 'neutral'

  return (
    <StatusBadge variant={variant} dot>
      {t(`shipping_carriers.status.${status}`, status)}
    </StatusBadge>
  )
}
