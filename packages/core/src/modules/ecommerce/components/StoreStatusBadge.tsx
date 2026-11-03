'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { STORE_STATUS_VARIANTS, type StoreStatus } from './storeAdmin'

export const STORE_STATUS_LABELS: Record<StoreStatus, { key: string; fallback: string }> = {
  draft: { key: 'ecommerce.backend.stores.status.draft', fallback: 'Draft' },
  active: { key: 'ecommerce.backend.stores.status.active', fallback: 'Active' },
  archived: { key: 'ecommerce.backend.stores.status.archived', fallback: 'Archived' },
}

export function StoreStatusBadge({ status }: { status: StoreStatus }) {
  const t = useT()
  const label = STORE_STATUS_LABELS[status]
  return (
    <StatusBadge variant={STORE_STATUS_VARIANTS[status] ?? 'neutral'} dot>
      {label ? t(label.key, label.fallback) : status}
    </StatusBadge>
  )
}
