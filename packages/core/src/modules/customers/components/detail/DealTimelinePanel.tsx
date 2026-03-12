"use client"

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { TimelinePanel } from '@open-mercato/ui/backend/timeline/TimelinePanel'
import { dealTimelinePanelConfig } from '../../lib/timeline/config'

export type DealTimelinePanelProps = {
  dealId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  t: TranslateFn
}

export function DealTimelinePanel({ dealId, open, onOpenChange, t }: DealTimelinePanelProps) {
  return (
    <TimelinePanel
      apiUrl={`/api/customers/deals/${encodeURIComponent(dealId)}/timeline`}
      config={dealTimelinePanelConfig}
      title={t('customers.deals.timeline.title', 'Timeline')}
      open={open}
      onOpenChange={onOpenChange}
      t={t}
      i18nPrefix="customers.deals.timeline"
    />
  )
}
