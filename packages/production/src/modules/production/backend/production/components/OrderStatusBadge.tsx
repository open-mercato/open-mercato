'use client'

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'

export type OrderStatus =
  | 'draft'
  | 'planned'
  | 'released'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'cancelled'

type Translate = (key: string, fallback?: string) => string

const VARIANT_BY_STATUS: Record<OrderStatus, 'neutral' | 'info' | 'warning' | 'success' | 'muted' | 'error'> = {
  draft: 'neutral',
  planned: 'info',
  released: 'warning',
  in_progress: 'warning',
  completed: 'success',
  closed: 'muted',
  cancelled: 'error',
}

/** Status pill for the production orders list/detail pages (task 3.4). */
export function OrderStatusBadge({ status, t }: { status: OrderStatus; t: Translate }) {
  return (
    <Badge variant={VARIANT_BY_STATUS[status] ?? 'neutral'}>
      {t(`production.orders.status.${status}`, status)}
    </Badge>
  )
}
