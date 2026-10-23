import * as React from 'react'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { PurchaseOrderStatus } from '../data/entities'

const statusMap: Record<PurchaseOrderStatus, { label: string; variant: StatusBadgeVariant }> = {
  draft_rfq: { label: 'Draft RFQ', variant: 'neutral' },
  rfq_sent: { label: 'RFQ Sent', variant: 'info' },
  to_approve: { label: 'To Approve', variant: 'warning' },
  purchase_order: { label: 'Purchase Order', variant: 'success' },
  locked: { label: 'Locked', variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'error' },
}

export function PurchaseOrderStatusBadge({ status }: { status?: string | null }) {
  const config = status ? statusMap[status as PurchaseOrderStatus] : undefined
  if (!config) {
    return <StatusBadge variant="neutral">{status ?? 'Unknown'}</StatusBadge>
  }
  return (
    <StatusBadge variant={config.variant} dot>
      {config.label}
    </StatusBadge>
  )
}
