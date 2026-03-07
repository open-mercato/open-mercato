"use client"

import * as React from 'react'
import { ListTodo } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { DealTimelinePanel } from './DealTimelinePanel'

export type DealTimelineActionProps = {
  dealId: string
  t: TranslateFn
}

export function DealTimelineAction({ dealId, t }: DealTimelineActionProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t('customers.deals.timeline.open', 'Open timeline')}
        title={t('customers.deals.timeline.open', 'Open timeline')}
      >
        <ListTodo className="size-4" />
      </IconButton>
      <DealTimelinePanel
        dealId={dealId}
        open={open}
        onOpenChange={setOpen}
        t={t}
      />
    </>
  )
}
